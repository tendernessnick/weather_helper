"""Resume-safe initial SQLite -> private PostgreSQL migration over CloudBase RPC.

Run from backend/ with PERSISTENCE_API_URL/PERSISTENCE_API_KEY in the environment,
or supply a private JSON file containing those two keys. Neither credentials nor
business row values are logged. Keep the offline snapshot and --state file until
the final full-value verification succeeds; the same state resumes an interruption.
The authoritative import marker blocks application bootstrap until verification.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
import sys
import uuid

from sqlalchemy import create_engine

from app.persistence_http import HttpRemoteStore
from scripts.pg_migration import (
    EXPECTED_TABLES, MigrationError, TableSummary, _equal, _normalise, _rows,
    business_tables, file_sha256, summarise, validate_source,
)


def _save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".writing")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def _json_row(row: dict) -> dict:
    return {key: value.isoformat(timespec="microseconds") if isinstance(value, datetime) else value
            for key, value in row.items()}


def _http_batches(changes: list[dict], max_rows: int = 400, max_bytes: int = 175000):
    batch, size = [], 0
    for change in changes:
        length = len(json.dumps(change, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) + 1
        if length > max_bytes:
            raise MigrationError("a source row exceeds the safe RPC staging request size")
        if batch and (len(batch) >= max_rows or size + length > max_bytes):
            yield batch
            batch, size = [], 0
        batch.append(change)
        size += length
    if batch:
        yield batch


def summarise_remote(remote, revision: int, *, owner: str | None = None, page_size: int = 2000) -> dict:
    """Hash every remote column in primary-key order at one immutable revision."""
    result = {}
    for table in business_tables():
        summary = TableSummary(table)
        primary_key = next(iter(table.primary_key)).name
        cursor = None
        while True:
            if owner is not None and not remote.heartbeat(owner, 300).get("acquired"):
                raise MigrationError("import lease was lost during full-value verification")
            page = remote.read_page(table.name, cursor, page_size, revision)
            if page.get("revision") != revision or not isinstance(page.get("rows"), list):
                raise MigrationError("remote snapshot revision or row structure changed")
            rows = page["rows"]
            previous = cursor
            for raw in rows:
                if not isinstance(raw, dict) or set(raw) != set(table.columns.keys()):
                    raise MigrationError(f"remote row columns differ for {table.name}")
                row = {column.name: _normalise(raw[column.name], column) for column in table.columns}
                if previous is not None and row[primary_key] <= previous:
                    raise MigrationError(f"remote snapshot is not in unique primary-key order for {table.name}")
                previous = row[primary_key]
                summary.add(row)
            next_cursor = page.get("next_cursor")
            if not rows:
                if next_cursor is not None:
                    raise MigrationError("empty remote snapshot page has a nonempty cursor")
                break
            if next_cursor != previous:
                raise MigrationError("remote snapshot cursor differs from the final primary key")
            cursor = next_cursor
        result[table.name] = summary.result()
    if remote.manifest().get("revision") != revision:
        raise MigrationError("remote revision changed during full-value verification")
    return result


def migrate_http(source_path: Path, remote, state_path: Path, *, rows_per_transaction: int = 4000,
                 page_size: int = 2000, progress=None) -> dict:
    if not 1 <= rows_per_transaction <= 10000 or not 1 <= page_size <= 5000:
        raise MigrationError("invalid transaction or snapshot page size")
    source_path = source_path.resolve(strict=True)
    if not source_path.is_file() or not source_path.stat().st_size:
        raise MigrationError("source must be a non-empty offline SQLite snapshot")
    for suffix in ("-wal", "-journal"):
        sidecar = Path(str(source_path) + suffix)
        if sidecar.exists() and sidecar.stat().st_size:
            raise MigrationError("source has an active journal/WAL; create an online-backup snapshot")
    source_hash = file_sha256(source_path)
    if state_path.exists():
        state = json.loads(state_path.read_text(encoding="utf-8"))
        if state.get("source_sha256") != source_hash or state.get("rows_per_transaction") != rows_per_transaction:
            raise MigrationError("local resume state differs from the immutable source or transaction size")
        try:
            uuid.UUID(state["owner"])
        except (ValueError, TypeError, KeyError):
            raise MigrationError("invalid import resume owner") from None
    else:
        state = {"format_version": 1, "source_sha256": source_hash, "owner": str(uuid.uuid4()),
                 "rows_per_transaction": rows_per_transaction, "table_index": 0, "offset": 0,
                 "completed": False}
        # x prevents two new operators from inventing separate owners for one state path.
        state_path.parent.mkdir(parents=True, exist_ok=True)
        with state_path.open("x", encoding="utf-8") as stream:
            json.dump(state, stream)
    owner = state["owner"]
    source_engine = create_engine("sqlite+pysqlite://", hide_parameters=True,
        creator=lambda: sqlite3.connect(source_path.as_uri() + "?mode=ro", uri=True))
    lease_acquired = False
    try:
        with source_engine.connect() as source:
            source.exec_driver_sql("PRAGMA query_only=ON")
            source.exec_driver_sql("BEGIN")
            validate_source(source)
            expected = summarise(source)
            lease = remote.acquire_lease(owner, 300)
            if not lease.get("acquired"):
                raise MigrationError("another writer/import holds the authoritative lease")
            lease_acquired = True
            begin = remote.request("import_begin", owner=owner, source_sha256=source_hash,
                                   source_manifest=expected, rows_per_transaction=rows_per_transaction)
            revision = begin["revision"]
            tables = business_tables()
            if not 0 <= state["table_index"] <= len(tables) or state["offset"] < 0:
                raise MigrationError("invalid resume table/row offset")
            if not begin.get("completed"):
                for index, table in enumerate(tables):
                    if index < state["table_index"]:
                        continue
                    offset = state["offset"] if index == state["table_index"] else 0
                    if offset > expected[table.name]["rows"] or (offset % rows_per_transaction and offset != expected[table.name]["rows"]):
                        raise MigrationError("invalid resume transaction boundary")
                    chunk, seen = [], 0

                    def commit_chunk(rows: list[dict], starting_offset: int) -> None:
                        nonlocal revision
                        if not remote.heartbeat(owner, 300).get("acquired"):
                            raise MigrationError("import lease was lost")
                        tx_id = f"import_{source_hash}_{table.name}_{starting_offset}"
                        # Full 64-digit source hash is important; tx IDs fit the
                        # server's 128-character limit even for forecast_snapshots.
                        changes = [{"table": table.name, "op": "upsert", "key": row[next(iter(table.primary_key)).name],
                                    "row": _json_row(row)} for row in rows]
                        batches = list(_http_batches(changes))
                        for batch_index, changes_batch in enumerate(batches):
                            remote.stage(owner, revision, tx_id, batch_index, changes_batch)
                        committed = remote.commit(owner, revision, tx_id, len(batches))
                        revision = max(revision, committed["revision"])
                        state.update(table_index=index, offset=starting_offset + len(rows))
                        _save_json(state_path, state)
                        if progress:
                            progress(table.name, state["offset"], expected[table.name]["rows"], revision)

                    for batch in _rows(source, table):
                        for row in batch:
                            if seen < offset:
                                seen += 1
                                continue
                            chunk.append(row)
                            seen += 1
                            if len(chunk) == rows_per_transaction:
                                commit_chunk(chunk, seen - len(chunk))
                                chunk = []
                    if chunk:
                        commit_chunk(chunk, seen - len(chunk))
                    state.update(table_index=index + 1, offset=0)
                    _save_json(state_path, state)
            # A completed import also verifies exact values on a rerun. It never
            # overwrites newer runtime data just to make an old snapshot match.
            actual = summarise_remote(remote, revision, owner=owner, page_size=page_size)
            _equal(expected, actual)
            if file_sha256(source_path) != source_hash:
                raise MigrationError("source file changed; import remains fenced pending operator review")
            finish = remote.request("import_finish", owner=owner, source_sha256=source_hash,
                                    verified_manifest=actual)
            if not finish.get("completed"):
                raise MigrationError("authoritative import completion was not confirmed")
            state.update(completed=True, revision=revision)
            _save_json(state_path, state)
            return {"format_version": 1, "status": "already_imported" if begin.get("completed") else "imported",
                    "source_sha256": source_hash, "revision": revision, "table_count": len(EXPECTED_TABLES),
                    "exact_values_match": True, "verified_at_utc": datetime.now(timezone.utc).isoformat(),
                    "tables": actual}
    finally:
        source_engine.dispose()
        if lease_acquired:
            try:
                remote.release_lease(owner)
            except Exception:
                pass  # Its bounded expiry permits safe resume; retain the private state.


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--runtime-env-file", type=Path)
    parser.add_argument("--rows-per-transaction", type=int, default=4000)
    parser.add_argument("--page-size", type=int, default=2000)
    args = parser.parse_args(argv)
    remote = None
    try:
        private = json.loads(args.runtime_env_file.read_text(encoding="utf-8")) if args.runtime_env_file else os.environ
        remote = HttpRemoteStore(private.get("PERSISTENCE_API_URL", ""), private.get("PERSISTENCE_API_KEY", ""), timeout=120)
        result = migrate_http(args.source, remote, args.state, rows_per_transaction=args.rows_per_transaction,
                              page_size=args.page_size,
                              progress=lambda table, rows, total, revision: print(
                                  json.dumps({"table": table, "rows": rows, "total": total, "revision": revision}), flush=True))
        _save_json(args.report, result)
        print(json.dumps({k: result[k] for k in ("status", "table_count", "exact_values_match", "revision")}))
        return 0
    except MigrationError as error:
        print(f"Migration refused: {error}", file=sys.stderr)
        return 1
    except Exception as error:
        print(f"HTTP migration interrupted ({type(error).__name__}); details withheld. "
              "Resume with the same immutable snapshot and private state file.", file=sys.stderr)
        return 1
    finally:
        if remote is not None:
            remote.close()


if __name__ == "__main__":
    raise SystemExit(main())
