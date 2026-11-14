"""CloudBase PostgreSQL authority with a disposable local SQLite query cache.

SQLAlchemy keeps its existing queries. SQLite transaction triggers capture
every business-table mutation; one remote revision-CAS commits the complete
transaction before the local commit. An uncertain outcome fences the cache
until it is rebuilt from PostgreSQL. Credentials never enter diagnostic data.
"""
from __future__ import annotations

import json
import logging
import os
import re
import socket
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import event, text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)
TABLES = (
    "courts", "forecast_snapshots", "observations", "nowcast_snapshots",
    "forecast_leads", "climatology", "persistence", "kv_cache", "user_reports",
    "checkins", "push_subscriptions", "feedback",
)
PRIMARY_KEYS = {name: "key" if name == "kv_cache" else "id" for name in TABLES}
_WRITE_SQL = re.compile(r"^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b", re.I)
_WITH_SQL = re.compile(r"^\s*WITH\b", re.I)


def detect_release_generation() -> int:
    """CloudBase names pods weather-helper-NNN-<replicaset>-<pod>.

    The optional override exists for isolated tests, not as a shared production
    setting: each actual release must retain its own monotonically increasing
    generation so a zero-traffic old pod cannot take its lease back.
    """
    override = os.environ.get("PERSISTENCE_RELEASE_GENERATION")
    if override is not None:
        return int(override) if override.isdigit() and int(override) <= 2_147_483_647 else 0
    match = re.match(r"^weather-helper-(\d+)(?:-|$)", socket.gethostname().lower())
    return int(match[1]) if match and int(match[1]) <= 2_147_483_647 else 0


class PersistenceUnavailable(RuntimeError):
    """The authoritative store/cache cannot currently serve a safe request."""


class PersistenceReadOnly(PersistenceUnavailable):
    """Another instance owns the write lease."""


class RemoteStoreError(PersistenceUnavailable):
    """An RPC failed; its detail intentionally contains no URL/token/body."""


class HttpRemoteStore:
    def __init__(self, api_url: str, api_key: str, *, timeout: float = 45,
                 client: httpx.Client | None = None):
        if not api_url or not api_key:
            raise ValueError("HTTP persistence requires its server URL and API key")
        self._url = api_url.rstrip("/") + "/v1/rdb/rest/rpc/weather_helper_sync"
        self._client = client or httpx.Client(timeout=timeout)
        self._owns_client = client is None
        self._headers = {"Authorization": f"Bearer {api_key}"}

    def request(self, action: str, **fields) -> dict:
        try:
            response = self._client.post(
                self._url, headers=self._headers,
                json={"request": {"action": action, **fields}})
            if response.status_code >= 400:
                raise RemoteStoreError(f"persistence RPC rejected ({response.status_code})")
            data = response.json()
            if not isinstance(data, dict) or data.get("error"):
                raise RemoteStoreError("persistence RPC returned an invalid result")
            return data
        except RemoteStoreError:
            raise
        except Exception:
            # httpx exceptions can contain the gateway URL. Do not propagate
            # credentials or raw server responses to logs/API error handlers.
            raise RemoteStoreError("persistence RPC unavailable or outcome unknown") from None

    def manifest(self) -> dict:
        return self.request("manifest")

    def read_page(self, table: str, after_key=None, limit: int = 2000,
                  expected_revision: int | None = None) -> dict:
        return self.request("snapshot", table=table, after=after_key, limit=limit,
                            revision=expected_revision)

    def acquire_lease(self, owner: str, ttl_seconds: int = 90, *,
                      generation: int | None = None, allow_takeover: bool = False) -> dict:
        fields = {} if generation is None else {"generation": generation,
                                                "allow_takeover": allow_takeover}
        return self.request("lease_acquire", owner=owner, ttl_seconds=ttl_seconds, **fields)

    def heartbeat(self, owner: str, ttl_seconds: int = 90, *,
                  generation: int | None = None, allow_takeover: bool = False) -> dict:
        fields = {} if generation is None else {"generation": generation,
                                                "allow_takeover": allow_takeover}
        return self.request("heartbeat", owner=owner, ttl_seconds=ttl_seconds, **fields)

    def release_lease(self, owner: str, *, generation: int | None = None) -> dict:
        fields = {} if generation is None else {"generation": generation}
        return self.request("lease_release", owner=owner, **fields)

    def stage(self, owner: str, expected_revision: int, tx_id: str,
              batch_index: int, changes: list[dict]) -> dict:
        return self.request("stage", owner=owner, expected_revision=expected_revision,
                            tx_id=tx_id, batch_index=batch_index, changes=changes)

    def commit(self, owner: str, expected_revision: int, tx_id: str,
               batch_count: int) -> dict:
        return self.request("commit", owner=owner, expected_revision=expected_revision,
                            tx_id=tx_id, batch_count=batch_count)

    def close(self) -> None:
        if self._owns_client:
            self._client.close()


def _quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _check_manifest(manifest: dict) -> int:
    if manifest.get("import_in_progress"):
        raise PersistenceUnavailable("authoritative import is still in progress")
    if manifest.get("schema_version") != 1 or set(manifest.get("tables", {})) != set(TABLES):
        raise PersistenceUnavailable("authoritative table manifest is incompatible")
    revision = manifest.get("revision")
    if not isinstance(revision, int) or revision < 0:
        raise PersistenceUnavailable("authoritative revision is invalid")
    for table, info in manifest["tables"].items():
        if (info.get("pk") != PRIMARY_KEYS[table] or not isinstance(info.get("count"), int)
                or info["count"] < 0):
            raise PersistenceUnavailable("authoritative table metadata is invalid")
    return revision


def _sqlite_row(table, row: dict) -> dict:
    """PostgREST timestamps are ISO T strings; SQLite ORM stores a space.

    Always use the ORM's DateTime binding for imports, rather than producing a
    mix of timestamp encodings that would break SQLite equality/range queries.
    """
    from datetime import datetime
    from sqlalchemy import Boolean, DateTime
    converted = dict(row)
    for column in table.columns:
        value = converted.get(column.name)
        if value is not None and isinstance(column.type, DateTime):
            parsed = datetime.fromisoformat(str(value))
            if parsed.tzinfo is not None:
                raise PersistenceUnavailable("business timestamp unexpectedly has a timezone")
            converted[column.name] = parsed
        elif value is not None and isinstance(column.type, Boolean):
            if value not in (True, False, 0, 1):
                raise PersistenceUnavailable("business boolean is invalid")
            converted[column.name] = bool(value)
    if set(converted) != {column.name for column in table.columns}:
        raise PersistenceUnavailable("authoritative business columns are incompatible")
    return converted


def _batches(changes: list[dict], max_rows: int = 400,
             max_bytes: int = 180_000):
    batch, size = [], 0
    for change in changes:
        row_size = len(json.dumps(change, ensure_ascii=False,
                                  separators=(",", ":")).encode("utf-8"))
        if row_size > max_bytes:
            raise PersistenceUnavailable("single persistence mutation exceeds the RPC limit")
        if batch and (len(batch) >= max_rows or size + row_size > max_bytes):
            yield batch
            batch, size = [], 0
        batch.append(change)
        size += row_size
    if batch:
        yield batch


class Coordinator:
    def __init__(self, remote: HttpRemoteStore, cache_path: str | Path, metadata,
                 *, owner: str | None = None, lease_seconds: int = 90,
                 page_size: int = 2000, traffic_url: str = "",
                 release_generation: int | None = None,
                 traffic_client: httpx.Client | None = None):
        self.remote = remote
        self.cache_path = Path(cache_path).resolve()
        self.metadata = metadata
        self.owner = owner or str(uuid.uuid4())
        self.lease_seconds = lease_seconds
        self.page_size = min(max(page_size, 1), 5000)
        self.release_generation = (detect_release_generation() if release_generation is None
                                   else release_generation)
        if type(self.release_generation) is not int or not 0 <= self.release_generation <= 2_147_483_647:
            raise ValueError("release generation must be a nonnegative 32-bit integer")
        self._traffic_url = traffic_url
        self._traffic_client = (traffic_client or httpx.Client(timeout=5, follow_redirects=False)
                                if traffic_url else None)
        self._traffic_generation = None
        self._traffic_until = 0.0
        self._authority_generation = None
        # A plain lock deliberately allows a FastAPI dependency's cleanup thread
        # to release a lock acquired by its handler thread. Session info prevents
        # recursive acquisition for multiple writes within one transaction.
        self.write_lock = threading.Lock()
        self._state_lock = threading.RLock()
        self._stop = threading.Event()
        self._thread = None
        self._recovery_thread = None
        self._engine = None
        self._connections = 0
        self._drained = threading.Condition()
        self.revision = -1
        self.valid = False
        self.rebuilding = False
        self._leader = False
        self._lease_until = 0.0
        self._reason = "not_bootstrapped"

    def status(self) -> dict:
        with self._state_lock:
            return {"backend": "cloudbase_http", "revision": self.revision,
                    "cache_valid": self.valid, "rebuilding": self.rebuilding,
                    "leader": self.can_write(), "reason": self._reason,
                    "release_generation": self.release_generation,
                    "traffic_generation": self._traffic_generation,
                    "traffic_confirmed": self._traffic_confirmed(),
                    "authority_release_generation": self._authority_generation}

    def ensure_valid(self) -> None:
        if not self.valid or self.rebuilding:
            raise PersistenceUnavailable("persistent query cache is rebuilding or unavailable")

    def can_write(self) -> bool:
        return (self.valid and not self.rebuilding and self._leader
                and time.monotonic() < self._lease_until
                and self._traffic_confirmed())

    def _traffic_confirmed(self) -> bool:
        return (not self._traffic_url or (self.release_generation > 0
                and self._traffic_generation == self.release_generation
                and time.monotonic() < self._traffic_until))

    def _confirm_traffic(self) -> bool:
        """A hidden/zero-traffic revision cannot promote itself merely by booting."""
        if not self._traffic_url:
            return True
        generation = None
        if self.release_generation > 0:
            try:
                response = self._traffic_client.get(
                    self._traffic_url,
                    params={"_persistence_probe": str(time.monotonic_ns())},
                    headers={"Cache-Control": "no-store, no-cache", "Pragma": "no-cache"},
                    timeout=5, follow_redirects=False)
                if response.status_code == 200:
                    result = response.json()
                    value = result.get("generation") if isinstance(result, dict) else None
                    if type(value) is int and value >= 0:
                        generation = value
            except Exception:
                pass  # no URL, server response or credential enters diagnostics
        confirmed = generation == self.release_generation and self.release_generation > 0
        with self._state_lock:
            self._traffic_generation = generation
            self._traffic_until = time.monotonic() + 8 if confirmed else 0
            if not confirmed:
                self._leader = False
                self._lease_until = 0
        return confirmed

    def _lease_fields(self) -> dict:
        # Unconfigured local/dev deployments keep the original RPC protocol.
        return ({"generation": self.release_generation, "allow_takeover": True}
                if self._traffic_url else {})

    def invalidate(self, reason: str) -> None:
        with self._state_lock:
            self.valid = False
            self._reason = reason
        # Even if a local COMMIT failed, a marker outside that transaction makes
        # the failure visible until a complete authoritative rebuild succeeds.
        try:
            self.cache_path.with_name(self.cache_path.name + ".invalid").write_text(
                reason, encoding="utf-8")
        except OSError:
            pass

    def _record_lease(self, result: dict, requested_at: float | None = None) -> bool:
        acquired = result.get("acquired") is True
        with self._state_lock:
            self._leader = acquired
            self._authority_generation = result.get("release_generation")
            self._lease_until = ((requested_at or time.monotonic()) + self.lease_seconds - 5
                                 if acquired else 0)
        return acquired

    def try_acquire_writer(self, *, traffic_checked: bool = False) -> bool:
        if not traffic_checked and not self._confirm_traffic():
            return False
        requested_at = time.monotonic()
        result = self.remote.acquire_lease(self.owner, self.lease_seconds, **self._lease_fields())
        acquired = self._record_lease(result, requested_at)
        if result.get("revision") != self.revision:
            self.invalidate("remote_revision_changed")
        return acquired

    def bootstrap_cache(self) -> None:
        """Build a new complete cache and swap it in only after revision checks."""
        from sqlalchemy import create_engine

        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        manifest = self.remote.manifest()
        revision = _check_manifest(manifest)
        temporary = self.cache_path.with_name(self.cache_path.name + f".{uuid.uuid4().hex}.building")
        build_engine = create_engine(f"sqlite:///{temporary}")
        try:
            self.metadata.create_all(build_engine)
            counts = {}
            with build_engine.begin() as conn:
                for name in TABLES:
                    table = self.metadata.tables[name]
                    cursor = None
                    count = 0
                    while True:
                        page = self.remote.read_page(name, cursor, self.page_size, revision)
                        if page.get("revision") != revision or not isinstance(page.get("rows"), list):
                            raise PersistenceUnavailable("snapshot revision changed")
                        rows = [_sqlite_row(table, row) for row in page["rows"]]
                        if rows:
                            conn.execute(table.insert(), rows)
                            count += len(rows)
                        following = page.get("next_cursor")
                        if following is None:
                            break
                        if not rows or following == cursor:
                            raise PersistenceUnavailable("snapshot cursor did not advance")
                        cursor = following
                    if count != manifest["tables"][name]["count"]:
                        raise PersistenceUnavailable("snapshot row count changed")
                    counts[name] = count
            if _check_manifest(self.remote.manifest()) != revision:
                raise PersistenceUnavailable("snapshot revision changed after download")
            with build_engine.connect() as conn:
                if conn.exec_driver_sql("PRAGMA integrity_check").scalar() != "ok":
                    raise PersistenceUnavailable("rebuilt cache failed integrity check")
            build_engine.dispose()
            for suffix in ("-wal", "-shm"):
                self.cache_path.with_name(self.cache_path.name + suffix).unlink(missing_ok=True)
            os.replace(temporary, self.cache_path)
            self.revision = revision
            self.valid = True
            self._reason = ""
            self.cache_path.with_name(self.cache_path.name + ".invalid").unlink(missing_ok=True)
        finally:
            build_engine.dispose()
            temporary.unlink(missing_ok=True)

    def install(self, engine, *, initialize: bool = True) -> None:
        """Install capture triggers and fail-closed guards once on this engine."""
        if engine.dialect.name != "sqlite":
            raise ValueError("HTTP persistence requires a local SQLite query cache")
        self._engine = engine
        if initialize:
            self._install_tracking()

        @event.listens_for(engine, "checkout")
        def _checkout(dbapi_connection, connection_record, connection_proxy):
            connection_record.info.pop("wh_writer_session", None)
            with self._drained:
                self._connections += 1

        @event.listens_for(engine, "checkin")
        def _checkin(dbapi_connection, connection_record):
            connection_record.info.pop("wh_writer_session", None)
            with self._drained:
                self._connections -= 1
                self._drained.notify_all()

        @event.listens_for(engine, "before_cursor_execute")
        def _guard(conn, cursor, statement, parameters, context, executemany):
            if context.execution_options.get("wh_cache_internal"):
                return
            self.ensure_valid()
            if (_WRITE_SQL.match(statement) or _WITH_SQL.match(statement)) and not conn.info.get("wh_writer_session"):
                raise PersistenceUnavailable("direct query-cache writes are forbidden")

    def _install_tracking(self) -> None:
        with self._engine.connect().execution_options(wh_cache_internal=True) as conn:
            # WAL is safe here: this file is local, disposable, and never mounted
            # on a network filesystem. Readers must not block the local commit
            # after the authoritative PostgreSQL commit already succeeded.
            conn.exec_driver_sql("PRAGMA journal_mode=WAL")
            conn.exec_driver_sql("PRAGMA synchronous=FULL")
            conn.exec_driver_sql("CREATE TABLE IF NOT EXISTS _wh_http_meta ("
                                 "singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL)")
            conn.exec_driver_sql("INSERT OR REPLACE INTO _wh_http_meta VALUES (1, ?)", (self.revision,))
            conn.exec_driver_sql("CREATE TABLE IF NOT EXISTS _wh_http_outbox ("
                                 "seq INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, "
                                 "op TEXT NOT NULL, row_key TEXT NOT NULL, row_json TEXT)")
            for name in TABLES:
                table = self.metadata.tables[name]
                pk = PRIMARY_KEYS[name]
                payload = ", ".join("'" + col.name + "', NEW." + _quote(col.name)
                                    for col in table.columns)
                add = (f"INSERT INTO _wh_http_outbox(table_name,op,row_key,row_json) "
                       f"VALUES ('{name}','upsert',json_quote(NEW.{_quote(pk)}),json_object({payload}));")
                remove = (f"INSERT INTO _wh_http_outbox(table_name,op,row_key,row_json) "
                          f"VALUES ('{name}','delete',json_quote(OLD.{_quote(pk)}),NULL);")
                for suffix, operation, body in (
                    ("i", "INSERT", add),
                    ("d", "DELETE", remove),
                    ("u", "UPDATE", (
                        f"INSERT INTO _wh_http_outbox(table_name,op,row_key,row_json) "
                        f"SELECT '{name}','delete',json_quote(OLD.{_quote(pk)}),NULL "
                        f"WHERE OLD.{_quote(pk)} IS NOT NEW.{_quote(pk)};" + add)),
                ):
                    trigger = _quote(f"_wh_capture_{name}_{suffix}")
                    conn.exec_driver_sql(f"DROP TRIGGER IF EXISTS {trigger}")
                    conn.exec_driver_sql(f"CREATE TRIGGER {trigger} AFTER {operation} ON {_quote(name)} "
                                         f"BEGIN {body} END")
            conn.commit()

    def _acquire_session(self, session: Session) -> None:
        self.ensure_valid()
        if session.info.get("wh_write_lock"):
            return
        if not self.can_write():
            raise PersistenceReadOnly("this instance does not hold the persistence write lease")
        self.write_lock.acquire()
        try:
            self.ensure_valid()
            if not self.can_write():
                raise PersistenceReadOnly("the persistence write lease expired")
            session.info["wh_write_lock"] = True
            session.connection().info["wh_writer_session"] = id(session)
        except BaseException:
            session.info.pop("wh_write_lock", None)
            self.write_lock.release()
            raise

    def _release_session(self, session: Session) -> None:
        if session.info.pop("wh_write_lock", False):
            self.write_lock.release()

    def _prepare_commit(self, session: Session) -> None:
        self.ensure_valid()
        if session.in_nested_transaction():
            raise PersistenceUnavailable("nested persistence transactions are unsupported")
        # Flushing also acquires the process lock before its first INSERT.
        session.flush()
        connection = session.connection()
        rows = connection.execute(text(
            "SELECT seq,table_name,op,row_key,row_json FROM _wh_http_outbox ORDER BY seq")).all()
        if not rows:
            return
        if not session.info.get("wh_write_lock"):
            # Every supported DML path acquires before touching SQLite. Taking
            # the process lock only now could deadlock another waiting writer.
            self.invalidate("untracked_cache_write")
            raise PersistenceUnavailable("query-cache mutation bypassed the write coordinator")
        expected = connection.execute(text("SELECT revision FROM _wh_http_meta WHERE singleton=1")).scalar_one()
        if expected != self.revision:
            self.invalidate("cache_revision_inconsistent")
            raise PersistenceUnavailable("local persistence revision is inconsistent")
        latest = {}
        for seq, table, operation, key, payload in rows:
            row = json.loads(payload) if payload else None
            if row is not None:
                from sqlalchemy import Boolean
                for column in self.metadata.tables[table].columns:
                    if isinstance(column.type, Boolean) and row.get(column.name) is not None:
                        row[column.name] = bool(row[column.name])
            latest[(table, key)] = (seq, {"table": table, "op": operation,
                                         "key": json.loads(key),
                                         "row": row})
        changes = [value[1] for value in sorted(latest.values(), key=lambda item: item[0])]
        tx_id = str(uuid.uuid4())
        batches = list(_batches(changes))
        try:
            for index, batch in enumerate(batches):
                self.remote.stage(self.owner, expected, tx_id, index, batch)
            result = self.remote.commit(self.owner, expected, tx_id, len(batches))
            if result.get("revision") != expected + 1 or result.get("tx_id") != tx_id:
                raise RemoteStoreError("authoritative commit returned an inconsistent revision")
            session.info["wh_remote_applied"] = True
            session.info["wh_pending_revision"] = result["revision"]
            connection.execute(text("UPDATE _wh_http_meta SET revision=:revision WHERE singleton=1"),
                               {"revision": result["revision"]})
            connection.execute(text("DELETE FROM _wh_http_outbox WHERE seq<=:seq"), {"seq": rows[-1][0]})
        except BaseException:
            # A failed response is not proof the server rolled back. Fence all
            # reads/writes and let lease-coordinated rebuild determine the truth.
            self.invalidate("remote_commit_outcome_unknown")
            raise

    def _committed(self, session: Session) -> None:
        revision = session.info.pop("wh_pending_revision", None)
        if revision is not None:
            self.revision = revision
        session.info.pop("wh_remote_applied", None)
        self._release_session(session)

    def _rolled_back(self, session: Session) -> None:
        if session.info.pop("wh_remote_applied", False):
            self.invalidate("local_commit_failed_after_remote_commit")
        session.info.pop("wh_pending_revision", None)
        self._release_session(session)

    def recover_after_acquire(self) -> None:
        if not self._leader:
            raise PersistenceReadOnly("cannot rebuild without the persistence lease")
        with self._state_lock:
            self.rebuilding = True
            self.valid = False
        try:
            with self.write_lock:
                if self._engine is not None:
                    deadline = time.monotonic() + 120
                    with self._drained:
                        while self._connections:
                            remaining = deadline - time.monotonic()
                            if remaining <= 0:
                                raise PersistenceUnavailable("old cache sessions did not drain")
                            self._drained.wait(min(remaining, 1))
                    self._engine.dispose()
                self.bootstrap_cache()
                if self._engine is not None:
                    self._engine.dispose()
                    self._install_tracking()
        except BaseException:
            self.invalidate("cache_rebuild_failed")
            raise
        finally:
            self.rebuilding = False

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="persistence-lease", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        last_heartbeat = 0.0
        while not self._stop.wait(5):
            try:
                if not self._confirm_traffic():
                    continue
                if self._leader and time.monotonic() - last_heartbeat < 20:
                    continue
                if self._leader:
                    requested_at = time.monotonic()
                    result = self.remote.heartbeat(self.owner, self.lease_seconds, **self._lease_fields())
                    self._record_lease(result, requested_at)
                    last_heartbeat = time.monotonic()
                    # A heartbeat may overlap the short interval between the
                    # authoritative commit and local commit. Its revision must
                    # not fence our own in-flight successful transaction.
                else:
                    self.try_acquire_writer(traffic_checked=True)
                if self._stop.is_set():
                    break
                if (self._leader and not self.valid and not self.rebuilding and
                        (self._recovery_thread is None or not self._recovery_thread.is_alive())):
                    # Snapshot rebuilds can exceed a lease TTL. Renewal keeps
                    # running on this thread while a separate worker rebuilds.
                    self._recovery_thread = threading.Thread(
                        target=self._recover_background, name="persistence-rebuild", daemon=True)
                    self._recovery_thread.start()
            except Exception:
                # Temporary gateway failure does not extend an expired lease.
                # New writes fail can_write() until a server renewal succeeds.
                logger.warning("persistence lease/cache recovery is waiting for the authority")

    def _recover_background(self) -> None:
        try:
            self.recover_after_acquire()
        except Exception:
            logger.warning("persistent query cache rebuild will retry")

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
        # Do not release while an in-flight writer could still commit. Process
        # shutdown may instead leave a short lease to expire naturally.
        if self.write_lock.acquire(blocking=False):
            try:
                if self._leader:
                    fields = {"generation": self.release_generation} if self._traffic_url else {}
                    self.remote.release_lease(self.owner, **fields)
                self._leader = False
            finally:
                self.write_lock.release()

    def export_snapshot(self, path: str | Path) -> dict:
        """Checkpoint a revision-equal SQLite view while local commits pause."""
        target = Path(path).resolve()
        if target == self.cache_path or target.exists():
            raise ValueError("snapshot destination must be a new, separate file")
        with self.write_lock:
            self.ensure_valid()
            manifest = self.remote.manifest()
            revision = _check_manifest(manifest)
            if revision != self.revision:
                self.invalidate("remote_revision_changed")
                raise PersistenceUnavailable("backup cache revision is stale")
            from .services.pg_backup import export_sqlite_snapshot
            try:
                export_sqlite_snapshot(self.cache_path, target, expected_revision=revision)
                if _check_manifest(self.remote.manifest()) != revision:
                    raise PersistenceUnavailable("backup authority revision changed")
                return manifest
            except BaseException:
                target.unlink(missing_ok=True)
                raise


class HttpPersistenceSession(Session):
    def __init__(self, *args, persistence_coordinator: Coordinator | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        self.persistence_coordinator = persistence_coordinator

    def commit(self) -> None:
        try:
            super().commit()
        except BaseException:
            self.rollback()
            raise


@event.listens_for(HttpPersistenceSession, "before_flush")
def _before_flush(session, flush_context, instances):
    if session.persistence_coordinator is not None:
        session.persistence_coordinator._acquire_session(session)


@event.listens_for(HttpPersistenceSession, "do_orm_execute")
def _before_execute(state):
    coordinator = state.session.persistence_coordinator
    if coordinator is not None:
        coordinator.ensure_valid()
        if (state.is_insert or state.is_update or state.is_delete
                or _WRITE_SQL.match(str(state.statement))
                or (not state.is_select and _WITH_SQL.match(str(state.statement)))):
            coordinator._acquire_session(state.session)


@event.listens_for(HttpPersistenceSession, "before_commit")
def _before_commit(session):
    if session.persistence_coordinator is not None:
        session.persistence_coordinator._prepare_commit(session)


@event.listens_for(HttpPersistenceSession, "after_commit")
def _after_commit(session):
    if session.persistence_coordinator is not None:
        session.persistence_coordinator._committed(session)


@event.listens_for(HttpPersistenceSession, "after_rollback")
def _after_rollback(session):
    if session.persistence_coordinator is not None:
        session.persistence_coordinator._rolled_back(session)


@event.listens_for(HttpPersistenceSession, "after_transaction_end")
def _after_transaction_end(session, transaction):
    if session.persistence_coordinator is not None and transaction.parent is None:
        session.persistence_coordinator._rolled_back(session)


@event.listens_for(HttpPersistenceSession, "after_begin")
def _after_begin(session, transaction, connection):
    if session.info.get("wh_write_lock"):
        connection.info["wh_writer_session"] = id(session)


@event.listens_for(HttpPersistenceSession, "after_soft_rollback")
def _after_soft_rollback(session, previous_transaction):
    if session.persistence_coordinator is not None and not session.in_transaction():
        session.persistence_coordinator._rolled_back(session)


def export_snapshot(path: str | Path) -> dict:
    from .db import get_persistence
    coordinator = get_persistence()
    if coordinator is None:
        raise PersistenceUnavailable("HTTP persistence is not configured")
    return coordinator.export_snapshot(path)
