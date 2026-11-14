"""Copy an offline SQLite snapshot to an isolated PostgreSQL schema.

Run from backend/:
    PG_MIGRATION_DATABASE_URL=... python -m scripts.pg_migration \
        --source /private/snapshot.db --schema weather_helper --report /private/report.json

The DSN is read only from the environment, never included in reports or errors.
No existing rows are overwritten, merged, truncated or dropped. All twelve
business tables, their original IDs and naive Hong Kong timestamps are copied
in one transaction, and every value is read back and hashed before commit.
An identical rerun is a read-only no-op. Use --verify-only before starting the
application; subsequently collected rows will intentionally fail exact equality.
"""
from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import sys
from typing import Any

from sqlalchemy import (
    Boolean, Column, DateTime, Float, Integer, MetaData, String, Table, Text,
    UniqueConstraint, create_engine, func, inspect, select, text,
)
from sqlalchemy.engine import Connection, Engine, make_url

from app import models  # noqa: F401 (register every business table)
from app.db import Base


FORMAT_VERSION = 1
EXPECTED_TABLES = frozenset({
    "courts", "forecast_snapshots", "observations", "nowcast_snapshots",
    "forecast_leads", "climatology", "persistence", "kv_cache", "user_reports",
    "checkins", "push_subscriptions", "feedback",
})
MARKER_TABLE = "_weather_helper_migration"


class MigrationError(ValueError):
    """A safe operator-facing error containing no connection or row values."""


def validate_schema(schema: str) -> str:
    # A narrow application namespace prevents a typo from writing into another
    # CloudBase project's/platform's schema, even if the DSN is privileged.
    if not re.fullmatch(r"weather_helper(?:_[a-z0-9_]+)?", schema) or len(schema) > 63:
        raise MigrationError("schema must be weather_helper or weather_helper_<suffix> (max 63 characters)")
    return schema


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def business_tables() -> list[Table]:
    if set(Base.metadata.tables) != EXPECTED_TABLES:
        raise MigrationError("ORM table inventory changed; review the migration before proceeding")
    return list(Base.metadata.sorted_tables)


def _quote(conn: Connection, identifier: str) -> str:
    return conn.dialect.identifier_preparer.quote_identifier(identifier)


def _qualified(conn: Connection, table: str, schema: str | None = None) -> str:
    return ((_quote(conn, schema) + ".") if schema else "") + _quote(conn, table)


def _normalise(value: Any, column: Column) -> Any:
    """Validate SQLite's dynamic types without silently coercing bad history."""
    if value is None:
        if not column.nullable:
            raise MigrationError(f"null in required column {column.table.name}.{column.name}")
        return None
    kind = column.type
    invalid = False
    if isinstance(kind, Boolean):
        invalid = type(value) not in (bool, int) or value not in (0, 1)
        if not invalid:
            return bool(value)
    elif isinstance(kind, Integer):
        invalid = type(value) is not int or not -(2**31) <= value < 2**31
        if not invalid:
            return value
    elif isinstance(kind, Float):
        invalid = type(value) not in (float, int) or not math.isfinite(value)
        if not invalid:
            return float(value)
    elif isinstance(kind, DateTime):
        if isinstance(value, str):
            try:
                value = datetime.fromisoformat(value)
            except ValueError:
                invalid = True
        invalid = invalid or not isinstance(value, datetime) or value.tzinfo is not None
        if not invalid:
            return value
    elif isinstance(kind, String):  # includes Text
        invalid = not isinstance(value, str) or "\x00" in value
        invalid = invalid or (kind.length is not None and isinstance(value, str) and len(value) > kind.length)
        if not invalid:
            return value
    else:
        raise MigrationError(f"unsupported column type {column.table.name}.{column.name}")
    raise MigrationError(f"invalid value type/range in {column.table.name}.{column.name}")


def _canonical(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, bool):
        return ["bool", value]
    if isinstance(value, int):
        return ["int", str(value)]
    if isinstance(value, float):
        return ["float", value.hex()]
    if isinstance(value, datetime):
        return ["datetime", value.isoformat(timespec="microseconds")]
    if isinstance(value, date):
        return ["date", value.isoformat()]
    if isinstance(value, str):
        return ["str", value]
    raise MigrationError("unsupported value in row fingerprint")


@dataclass
class TableSummary:
    table: Table
    count: int = 0
    digest: Any = field(default_factory=hashlib.sha256)
    ranges: dict = field(default_factory=dict)
    court_counts: Counter = field(default_factory=Counter)

    def add(self, row: dict) -> None:
        values = [row[column.name] for column in self.table.columns]
        encoded = json.dumps([_canonical(v) for v in values], ensure_ascii=False,
                             separators=(",", ":")).encode("utf-8")
        self.digest.update(len(encoded).to_bytes(8, "big"))
        self.digest.update(encoded)
        self.count += 1
        for column in self.table.columns:
            value = row[column.name]
            if value is not None and (isinstance(column.type, DateTime) or column.name == "id"):
                old = self.ranges.setdefault(column.name, [value, value])
                old[0], old[1] = min(old[0], value), max(old[1], value)
        if row.get("court_id") is not None:
            self.court_counts[row["court_id"]] += 1

    def result(self) -> dict:
        return {
            "rows": self.count,
            "sha256": self.digest.hexdigest(),
            "ranges": {k: [v.isoformat(timespec="microseconds") if isinstance(v, datetime) else v
                           for v in bounds] for k, bounds in sorted(self.ranges.items())},
            "court_counts": dict(sorted(self.court_counts.items())),
        }


def _rows(conn: Connection, table: Table, schema: str | None = None, batch_size: int = 1000):
    # Read raw SQLite values (Boolean's result processor would hide 2 -> True).
    columns = ", ".join(_quote(conn, column.name) for column in table.columns)
    keys = ", ".join(_quote(conn, column.name) + (
        ' COLLATE "C"' if conn.dialect.name == "postgresql" and isinstance(column.type, String) else ""
    ) for column in table.primary_key)
    result = conn.exec_driver_sql(
        f"SELECT {columns} FROM {_qualified(conn, table.name, schema)} ORDER BY {keys}"
    ).mappings()
    try:
        while batch := result.fetchmany(batch_size):
            yield [{column.name: _normalise(row[column.name], column) for column in table.columns}
                   for row in batch]
    finally:
        result.close()


def summarise(conn: Connection, schema: str | None = None) -> dict:
    result = {}
    for table in business_tables():
        summary = TableSummary(table)
        for batch in _rows(conn, table, schema):
            for row in batch:
                summary.add(row)
        result[table.name] = summary.result()
    return result


def validate_source(conn: Connection) -> None:
    if conn.exec_driver_sql("PRAGMA integrity_check").scalars().all() != ["ok"]:
        raise MigrationError("SQLite integrity_check failed")
    inventory = inspect(conn)
    actual = set(inventory.get_table_names()) - {"sqlite_sequence"}
    if actual != EXPECTED_TABLES:
        raise MigrationError("SQLite table inventory differs from the twelve expected business tables")
    for table in business_tables():
        if {c["name"] for c in inventory.get_columns(table.name)} != set(table.columns.keys()):
            raise MigrationError(f"SQLite column inventory differs for {table.name}")
        if "court_id" in table.c:
            name = _qualified(conn, table.name)
            missing = conn.exec_driver_sql(
                f'SELECT COUNT(*) FROM {name} t LEFT JOIN "courts" c ON c.id=t.court_id '
                'WHERE t.court_id IS NOT NULL AND c.id IS NULL'
            ).scalar_one()
            if missing:
                raise MigrationError(f"orphan court references in {table.name}")


def _target_metadata(schema: str) -> tuple[MetaData, Table]:
    metadata = MetaData()
    for table in business_tables():
        table.to_metadata(metadata, schema=schema)
    marker = Table(
        MARKER_TABLE, metadata,
        Column("source_sha256", String(64), primary_key=True),
        Column("format_version", Integer, nullable=False),
        Column("imported_at", DateTime(timezone=True), nullable=False),
        Column("manifest_json", Text, nullable=False),
        schema=schema,
    )
    return metadata, marker


def _check_target_structure(conn: Connection, schema: str) -> None:
    inventory = inspect(conn)
    if set(inventory.get_table_names(schema=schema)) - EXPECTED_TABLES - {MARKER_TABLE}:
        raise MigrationError("target schema contains unrelated tables; refusing to touch it")
    if inventory.get_view_names(schema=schema) or inventory.get_materialized_view_names(schema=schema):
        raise MigrationError("target schema contains views; use an isolated application schema")
    for table in business_tables():
        if not inventory.has_table(table.name, schema=schema):
            continue
        actual = {c["name"]: c for c in inventory.get_columns(table.name, schema=schema)}
        if set(actual) != set(table.columns.keys()):
            raise MigrationError(f"target column inventory differs for {table.name}")
        for column in table.columns:
            found = actual[column.name]
            kind = column.type
            # REAL/FLOAT4 would lose precision; TIMESTAMPTZ would shift HK local times.
            if isinstance(kind, Float):
                ok = isinstance(found["type"], Float) and getattr(found["type"], "precision", 53) in (None, 53)
            elif isinstance(kind, DateTime):
                ok = isinstance(found["type"], DateTime) and not found["type"].timezone
            elif isinstance(kind, String):
                ok = isinstance(found["type"], String) and found["type"].length == kind.length
            else:
                ok = isinstance(found["type"], type(kind))
            if not ok or found["nullable"] != column.nullable:
                raise MigrationError(f"target column definition differs for {table.name}.{column.name}")
        primary = inventory.get_pk_constraint(table.name, schema=schema)["constrained_columns"]
        if set(primary) != {c.name for c in table.primary_key}:
            raise MigrationError(f"target primary key differs for {table.name}")
        expected_unique = {tuple(sorted(c.name for c in constraint.columns))
                           for constraint in table.constraints if isinstance(constraint, UniqueConstraint)}
        found_unique = {tuple(sorted(c["column_names"]))
                        for c in inventory.get_unique_constraints(table.name, schema=schema)}
        if expected_unique != found_unique:
            raise MigrationError(f"target unique constraints differ for {table.name}")


def _copy_tables(source: Connection, target: Connection, schema: str, metadata: MetaData,
                 batch_size: int = 1000) -> dict:
    """Caller owns the transaction. Exact copies, never additive aggregation."""
    summaries = {}
    for table in business_tables():
        summary = TableSummary(table)
        for batch in _rows(source, table, batch_size=batch_size):
            target.execute(metadata.tables[f"{schema}.{table.name}"].insert(), batch)
            for row in batch:
                summary.add(row)
        summaries[table.name] = summary.result()
    return summaries


def _reset_sequences(conn: Connection, schema: str) -> None:
    for table in business_tables():
        if "id" not in table.c or not isinstance(table.c.id.type, Integer):
            continue
        qualified = _qualified(conn, table.name, schema)
        sequence = conn.execute(text(
            "SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
            "WHERE c.oid=pg_get_serial_sequence(:qualified, 'id')::regclass"
        ), {"qualified": qualified}).one_or_none()
        if sequence is None or sequence[0] != schema:
            raise MigrationError(f"missing or foreign auto-increment sequence for {table.name}")
        next_id = conn.exec_driver_sql(f"SELECT COALESCE(MAX(id), 0) + 1 FROM {qualified}").scalar_one()
        if not 1 <= next_id < 2**31:
            raise MigrationError(f"auto-increment sequence exhausted for {table.name}")
        # Unlike setval(), ALTER SEQUENCE RESTART is transactional: a failed
        # import cannot advance a previously existing sequence outside rollback.
        seq_name = _qualified(conn, sequence[1], sequence[0])
        conn.exec_driver_sql(f"ALTER SEQUENCE {seq_name} RESTART WITH {next_id}")


def _equal(source: dict, target: dict) -> None:
    for table in sorted(EXPECTED_TABLES):
        if source[table] != target[table]:
            raise MigrationError(f"exact row/count/range fingerprint mismatch for {table}")


def migrate(source_path: Path, target_engine: Engine, schema: str, *, verify_only: bool = False,
            batch_size: int = 1000) -> dict:
    schema = validate_schema(schema)
    source_path = source_path.resolve(strict=True)
    if not source_path.is_file() or source_path.stat().st_size == 0:
        raise MigrationError("source must be a non-empty offline SQLite snapshot")
    for suffix in ("-wal", "-journal"):
        sidecar = Path(str(source_path) + suffix)
        if sidecar.exists() and sidecar.stat().st_size:
            raise MigrationError("source has a live journal/WAL; create an SQLite online-backup snapshot first")
    if target_engine.dialect.name != "postgresql":
        raise MigrationError("target must use PostgreSQL")
    if not 1 <= batch_size <= 10000:
        raise MigrationError("batch_size must be between 1 and 10000")
    source_hash = file_sha256(source_path)
    source_engine = create_engine(
        "sqlite+pysqlite://", hide_parameters=True,
        creator=lambda: sqlite3.connect(source_path.as_uri() + "?mode=ro", uri=True),
    )
    metadata, marker = _target_metadata(schema)
    try:
        with source_engine.connect() as source, target_engine.begin() as target:
            source.exec_driver_sql("PRAGMA query_only=ON")
            source.exec_driver_sql("BEGIN")
            validate_source(source)
            if verify_only:
                target.exec_driver_sql("SET TRANSACTION READ ONLY")
                if not inspect(target).has_schema(schema):
                    raise MigrationError("target schema is absent")
            else:
                # Protect concurrent operators. Table locks also block a running
                # application's writers; callers must stop its scheduler first.
                locked = target.execute(text("SELECT pg_try_advisory_xact_lock(hashtext(:name))"),
                                        {"name": "weather-helper-migration:" + schema}).scalar_one()
                if not locked:
                    raise MigrationError("another migration is active for this schema")
                target.exec_driver_sql("SET LOCAL lock_timeout='15s'")
                if not inspect(target).has_schema(schema):
                    target.exec_driver_sql(f"CREATE SCHEMA {_quote(target, schema)}")
            _check_target_structure(target, schema)
            if verify_only:
                actual = summarise(target, schema)
                expected = summarise(source)
                _equal(expected, actual)
                status = "verified"
            else:
                metadata.create_all(target)
                for table in business_tables():
                    target.exec_driver_sql(f"LOCK TABLE {_qualified(target, table.name, schema)} IN ACCESS EXCLUSIVE MODE")
                existing_markers = target.execute(select(marker)).mappings().all()
                if existing_markers:
                    if len(existing_markers) != 1 or existing_markers[0]["source_sha256"] != source_hash:
                        raise MigrationError("target was imported from another snapshot; refusing overwrite")
                    if existing_markers[0]["format_version"] != FORMAT_VERSION:
                        raise MigrationError("migration format differs; review before rerunning")
                    expected = summarise(source)
                    actual = summarise(target, schema)
                    _equal(expected, actual)
                    status = "already_imported"
                else:
                    for table in business_tables():
                        if target.execute(select(func.count()).select_from(
                                metadata.tables[f"{schema}.{table.name}"])).scalar_one():
                            raise MigrationError(f"target table {table.name} is non-empty; refusing overwrite")
                    expected = _copy_tables(source, target, schema, metadata, batch_size)
                    actual = summarise(target, schema)
                    _equal(expected, actual)
                    _reset_sequences(target, schema)
                    target.execute(marker.insert().values(
                        source_sha256=source_hash, format_version=FORMAT_VERSION,
                        imported_at=datetime.now(timezone.utc),
                        manifest_json=json.dumps(expected, ensure_ascii=False, sort_keys=True),
                    ))
                    status = "imported"
            # Do this before target commit; never commit a snapshot that changed
            # underneath the read transaction (including accidental live files).
            if file_sha256(source_path) != source_hash:
                raise MigrationError("source file changed during migration; target rolled back")
            return {
                "format_version": FORMAT_VERSION, "status": status,
                "source_sha256": source_hash, "schema": schema,
                "verified_at_utc": datetime.now(timezone.utc).isoformat(),
                "table_count": len(expected), "exact_values_match": True,
                "tables": expected,
            }
    finally:
        source_engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--schema", required=True)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--batch-size", type=int, default=1000)
    args = parser.parse_args(argv)
    engine = None
    try:
        validate_schema(args.schema)
        dsn = os.environ.get("PG_MIGRATION_DATABASE_URL", "")
        if not dsn or make_url(dsn).get_backend_name() not in {"postgres", "postgresql"}:
            raise MigrationError("set PG_MIGRATION_DATABASE_URL to the verified PostgreSQL connection")
        url = make_url(dsn).set(drivername="postgresql+psycopg")
        engine = create_engine(url, pool_size=1, max_overflow=0, hide_parameters=True,
                               connect_args={"connect_timeout": 15})
        # Validate output accessibility before committing a potentially long import.
        args.report.parent.mkdir(parents=True, exist_ok=True)
        if args.report.exists():
            raise MigrationError("report path already exists; select a new private path")
        with args.report.open("x", encoding="utf-8") as report:
            report.write("{}\n")
        result = migrate(args.source, engine, args.schema, verify_only=args.verify_only,
                         batch_size=args.batch_size)
        args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({k: result[k] for k in ("status", "schema", "table_count", "exact_values_match")}))
        return 0
    except MigrationError as error:
        print(f"Migration refused: {error}", file=sys.stderr)
        return 1
    except Exception as error:
        # Driver exception messages can include hosts, SQL parameters or user data.
        print(f"Migration failed ({type(error).__name__}); connection details withheld. "
              "An uncommitted import is rolled back.", file=sys.stderr)
        return 1
    finally:
        if engine is not None:
            engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
