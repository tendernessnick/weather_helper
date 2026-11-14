"""Failure/recovery tests for canonical PG transactions and disposable caches."""
from copy import deepcopy
from contextlib import closing
from datetime import datetime
import json
import sqlite3
import threading

import httpx
import pytest
from sqlalchemy import create_engine, delete, event, select, text, update
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import Court, KvCache, Observation
from app.persistence_http import (Coordinator, HttpPersistenceSession,
                                  HttpRemoteStore, PersistenceReadOnly,
                                  PersistenceUnavailable, PRIMARY_KEYS,
                                  RemoteStoreError, TABLES, _batches,
                                  detect_release_generation)


class MemoryAuthority:
    """The SQL RPC has its own real-PG tests; model its transport here."""
    def __init__(self):
        self.revision = 0
        self.rows = {name: {} for name in TABLES}
        self.owner = None
        self.staged = {}
        self.committed = {}
        self.lost_commit_response = False
        self.failed_stage = False

    def manifest(self):
        return {"schema_version": 1, "revision": self.revision, "tables": {
            name: {"count": len(rows), "pk": PRIMARY_KEYS[name]}
            for name, rows in self.rows.items()}}

    def read_page(self, table, after_key=None, limit=2000, expected_revision=None):
        if expected_revision != self.revision:
            raise RemoteStoreError("revision mismatch")
        keys = [key for key in sorted(self.rows[table]) if after_key is None or key > after_key]
        keys = keys[:limit]
        return {"revision": self.revision, "rows": [deepcopy(self.rows[table][key]) for key in keys],
                "next_cursor": keys[-1] if keys else None}

    def acquire_lease(self, owner, ttl_seconds=90):
        if self.owner is None or self.owner == owner:
            self.owner = owner
        return {"acquired": self.owner == owner, "revision": self.revision}

    def heartbeat(self, owner, ttl_seconds=90):
        return {"acquired": self.owner == owner, "revision": self.revision}

    def release_lease(self, owner):
        if self.owner == owner:
            self.owner = None
        return {"released": True}

    def stage(self, owner, expected_revision, tx_id, batch_index, changes):
        assert owner == self.owner and expected_revision == self.revision
        if self.failed_stage:
            raise RemoteStoreError("unknown staging result")
        self.staged.setdefault(tx_id, {})[batch_index] = deepcopy(changes)
        return {"staged": True}

    def commit(self, owner, expected_revision, tx_id, batch_count):
        if tx_id in self.committed:
            return self.committed[tx_id]
        assert owner == self.owner and expected_revision == self.revision
        for index in range(batch_count):
            for change in self.staged[tx_id][index]:
                target = self.rows[change["table"]]
                if change["op"] == "delete":
                    target.pop(change["key"], None)
                else:
                    target[change["key"]] = deepcopy(change["row"])
        self.revision += 1
        result = {"revision": self.revision, "tx_id": tx_id, "already_applied": False}
        self.committed[tx_id] = result
        if self.lost_commit_response:
            raise RemoteStoreError("commit response lost")
        return result


class GenerationAuthority(MemoryAuthority):
    def __init__(self):
        super().__init__()
        self.generation = 0
        self.lease_calls = []

    def acquire_lease(self, owner, ttl_seconds=90, *, generation=0, allow_takeover=False):
        self.lease_calls.append(("acquire", generation, allow_takeover))
        if generation < self.generation:
            acquired = False
        elif (self.owner is None or self.owner == owner
              or (generation > self.generation and allow_takeover)):
            self.owner, self.generation, acquired = owner, generation, True
        else:
            acquired = False
        return {"acquired": acquired, "revision": self.revision,
                "release_generation": self.generation}

    def heartbeat(self, owner, ttl_seconds=90, *, generation=0, allow_takeover=False):
        return {"acquired": owner == self.owner and generation == self.generation,
                "revision": self.revision, "release_generation": self.generation}

    def release_lease(self, owner, *, generation=0):
        if self.owner == owner and generation == self.generation:
            self.owner = None
        return {"released": self.owner is None}


@pytest.fixture
def mirror(tmp_path):
    remote = MemoryAuthority()
    path = tmp_path / "cache.db"
    coordinator = Coordinator(remote, path, Base.metadata, page_size=1)
    coordinator.bootstrap_cache()
    assert coordinator.try_acquire_writer()
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False, "timeout": 2})
    coordinator.install(engine)
    sessions = sessionmaker(bind=engine, class_=HttpPersistenceSession,
                            persistence_coordinator=coordinator, expire_on_commit=False)
    yield coordinator, remote, engine, sessions
    coordinator.stop()
    engine.dispose()


def kv(key="entry", value="{}"):
    return KvCache(key=key, value_json=value, updated_at=datetime(2026, 11, 15, 12, 30))


def raw_count(coordinator, table):
    with closing(sqlite3.connect(coordinator.cache_path)) as conn:
        return conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]


def test_insert_update_bulk_delete_and_rollback_capture(mirror):
    coordinator, remote, _, sessions = mirror
    with sessions() as db:
        db.add(kv())
        db.commit()
        assert remote.rows["kv_cache"]["entry"]["value_json"] == "{}"
        db.execute(update(KvCache).values(value_json='{"x":1}'))
        db.commit()
        assert remote.rows["kv_cache"]["entry"]["value_json"] == '{"x":1}'
        db.add(kv("rolled-back"))
        db.flush()
        db.rollback()
        assert "rolled-back" not in remote.rows["kv_cache"]
        db.execute(delete(KvCache))
        db.commit()
    assert not remote.rows["kv_cache"]
    assert coordinator.revision == remote.revision == 3
    assert raw_count(coordinator, "_wh_http_outbox") == 0


def test_raw_session_sql_captured_and_direct_engine_writes_rejected(mirror):
    coordinator, remote, engine, sessions = mirror
    with sessions() as db:
        db.execute(text("INSERT INTO kv_cache VALUES ('raw','{}','2026-11-15 12:30:00.000000')"))
        db.commit()
    assert "raw" in remote.rows["kv_cache"]
    with engine.begin() as conn, pytest.raises(PersistenceUnavailable, match="direct"):
        conn.execute(text("DELETE FROM kv_cache"))
    assert raw_count(coordinator, "kv_cache") == 1


def test_boolean_and_primary_key_update_are_preserved(mirror):
    coordinator, remote, _, sessions = mirror
    with sessions() as db:
        db.add(Observation(court_id="c1", observed_hour=datetime(2026, 11, 15, 12),
                           station_name="Station", rainfall_mm=1.2, rain=True,
                           fetched_at=datetime(2026, 11, 15, 12, 15)))
        db.add(kv("old"))
        db.commit()
        assert remote.rows["observations"][1]["rain"] is True
        db.execute(update(KvCache).where(KvCache.key == "old").values(key="new"))
        db.commit()
    assert "old" not in remote.rows["kv_cache"]
    assert "new" in remote.rows["kv_cache"]
    assert coordinator.valid


def test_readonly_standby_never_mutates_local_cache(mirror):
    coordinator, _, _, sessions = mirror
    coordinator._leader = False
    with sessions() as db:
        assert db.scalars(select(KvCache)).all() == []
        db.add(kv())
        with pytest.raises(PersistenceReadOnly):
            db.commit()
    assert raw_count(coordinator, "kv_cache") == 0


def test_remote_stage_failure_rolls_back_and_fences_reads(mirror):
    coordinator, remote, engine, sessions = mirror
    remote.failed_stage = True
    with sessions() as db:
        db.add(kv())
        with pytest.raises(RemoteStoreError):
            db.commit()
        with pytest.raises(PersistenceUnavailable):
            db.scalars(select(KvCache)).all()
    assert raw_count(coordinator, "kv_cache") == 0
    assert not coordinator.valid
    assert coordinator.cache_path.with_name("cache.db.invalid").is_file()
    with engine.connect() as conn, pytest.raises(PersistenceUnavailable):
        conn.execute(text("SELECT 1"))
    assert not coordinator.write_lock.locked()


def test_lost_remote_commit_response_recovers_authoritative_success(mirror):
    coordinator, remote, _, sessions = mirror
    remote.lost_commit_response = True
    with sessions() as db:
        db.add(kv())
        with pytest.raises(RemoteStoreError):
            db.commit()
    assert remote.revision == 1
    assert "entry" in remote.rows["kv_cache"]
    assert raw_count(coordinator, "kv_cache") == 0
    assert not coordinator.valid
    remote.lost_commit_response = False
    coordinator.recover_after_acquire()
    with sessions() as db:
        assert db.get(KvCache, "entry").updated_at == datetime(2026, 11, 15, 12, 30)
        db.add(kv("next"))
        db.commit()
    assert coordinator.revision == 2


def test_local_commit_failure_fences_and_rebuilds(mirror):
    coordinator, remote, engine, sessions = mirror
    fail = {"once": True}

    def fail_commit(connection):
        if fail.pop("once", False):
            raise OSError("simulated disk failure")

    event.listen(engine, "commit", fail_commit)
    with sessions() as db:
        db.add(kv())
        with pytest.raises(OSError):
            db.commit()
    event.remove(engine, "commit", fail_commit)
    assert remote.revision == 1
    assert not coordinator.valid
    assert not coordinator.write_lock.locked()
    coordinator.recover_after_acquire()
    assert raw_count(coordinator, "kv_cache") == 1


def test_two_writer_threads_serialize_before_sqlite_write(mirror):
    coordinator, remote, _, sessions = mirror
    barrier = threading.Barrier(2)
    errors = []

    def worker(key):
        try:
            with sessions() as db:
                db.add(kv(key))
                barrier.wait(timeout=5)
                db.commit()
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(f"entry-{i}",)) for i in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)
    assert not errors
    assert all(not thread.is_alive() for thread in threads)
    assert coordinator.revision == remote.revision == 2
    assert raw_count(coordinator, "kv_cache") == 2


def test_dependency_cleanup_on_another_thread_rolls_back_and_releases(mirror):
    coordinator, remote, _, sessions = mirror
    db = sessions()
    db.add(kv("abandoned"))
    db.flush()
    assert coordinator.write_lock.locked()
    errors = []

    def cleanup():
        try:
            db.close()
        except Exception as error:
            errors.append(error)

    thread = threading.Thread(target=cleanup)
    thread.start()
    thread.join(timeout=5)
    assert not errors
    assert not thread.is_alive()
    assert not coordinator.write_lock.locked()
    assert raw_count(coordinator, "kv_cache") == 0
    assert remote.revision == 0
    with sessions() as next_session:
        next_session.add(kv("next-request"))
        next_session.commit()
    assert coordinator.revision == 1


def test_transaction_context_manager_uses_the_same_remote_commit_hooks(mirror):
    coordinator, remote, _, sessions = mirror
    with sessions.begin() as db:
        db.add(kv())
    assert remote.revision == coordinator.revision == 1
    assert not coordinator.write_lock.locked()


def test_bootstrap_rejects_inconsistent_snapshot(tmp_path):
    remote = MemoryAuthority()
    original = remote.read_page

    def changing(*args, **kwargs):
        page = original(*args, **kwargs)
        remote.revision += 1
        return page

    remote.read_page = changing
    coordinator = Coordinator(remote, tmp_path / "new.db", Base.metadata)
    with pytest.raises(RemoteStoreError):
        coordinator.bootstrap_cache()
    assert not coordinator.cache_path.exists()
    assert not list(tmp_path.glob("*.building"))


def test_bootstrap_rejects_partial_authoritative_import(tmp_path):
    remote = MemoryAuthority()
    manifest = remote.manifest
    remote.manifest = lambda: {**manifest(), "import_in_progress": True}
    coordinator = Coordinator(remote, tmp_path / "new.db", Base.metadata)
    with pytest.raises(PersistenceUnavailable, match="import"):
        coordinator.bootstrap_cache()
    assert not coordinator.cache_path.exists()


def test_stale_standby_must_rebuild_after_acquiring_lease(mirror):
    coordinator, remote, _, sessions = mirror
    coordinator._leader = False
    remote.owner = None
    remote.rows["kv_cache"]["other"] = {
        "key": "other", "value_json": "{}", "updated_at": "2026-11-15T12:30:00"}
    remote.revision += 1
    assert coordinator.try_acquire_writer()
    assert not coordinator.can_write()
    with sessions() as db, pytest.raises(PersistenceUnavailable):
        db.scalars(select(KvCache)).all()
    coordinator.recover_after_acquire()
    with sessions() as db:
        assert db.get(KvCache, "other") is not None
    assert coordinator.can_write()


def test_same_transaction_multiple_updates_coalesce_into_final_value(mirror):
    coordinator, remote, _, sessions = mirror
    with sessions() as db:
        db.add(kv())
        db.flush()
        db.execute(update(KvCache).values(value_json='{"final":true}'))
        db.commit()
    staged = next(iter(remote.staged.values()))
    assert sum(len(batch) for batch in staged.values()) == 1
    assert remote.rows["kv_cache"]["entry"]["value_json"] == '{"final":true}'
    assert coordinator.revision == 1


def test_chunking_bounds_rpc_requests_without_splitting_remote_transaction():
    changes = [{"table": "kv_cache", "op": "upsert", "key": str(i),
                "row": {"key": str(i), "value_json": "x" * 1000}} for i in range(1000)]
    chunks = list(_batches(changes))
    assert len(chunks) > 2
    assert sum(map(len, chunks)) == 1000
    assert all(len(chunk) <= 400 for chunk in chunks)
    assert all(len(json.dumps(chunk, ensure_ascii=False).encode()) < 200_000 for chunk in chunks)


def test_http_transport_shape_and_sanitized_errors():
    received = []

    def handle(request):
        received.append(json.loads(request.content))
        assert request.headers["Authorization"] == "Bearer inert-token"
        return httpx.Response(200, json={"revision": 0})

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        remote = HttpRemoteStore("https://example.invalid", "inert-token", client=client)
        assert remote.manifest() == {"revision": 0}
    assert received == [{"request": {"action": "manifest"}}]

    def rejected(request):
        return httpx.Response(403, json={"secret": "must never escape"})

    with httpx.Client(transport=httpx.MockTransport(rejected)) as client:
        remote = HttpRemoteStore("https://example.invalid", "inert-token", client=client)
        with pytest.raises(RemoteStoreError) as error:
            remote.manifest()
        assert "must never escape" not in str(error.value)
        assert "inert-token" not in str(error.value)


def test_export_snapshot_revision_matches_authority(mirror, tmp_path):
    coordinator, _, _, sessions = mirror
    with sessions() as db:
        db.add(kv())
        db.commit()
    target = tmp_path / "backup.db"
    manifest = coordinator.export_snapshot(target)
    assert manifest["revision"] == 1
    assert manifest["tables"]["kv_cache"]["count"] == 1
    with closing(sqlite3.connect(target)) as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert conn.execute("SELECT COUNT(*) FROM kv_cache").fetchone()[0] == 1


def test_install_unbootstrapped_cache_registers_guard_without_creating_tables(tmp_path):
    path = tmp_path / "not-created.db"
    coordinator = Coordinator(MemoryAuthority(), path, Base.metadata)
    engine = create_engine(f"sqlite:///{path}")
    coordinator.install(engine, initialize=False)
    assert not path.exists()
    with engine.connect() as conn, pytest.raises(PersistenceUnavailable):
        conn.execute(text("SELECT 1"))
    assert not coordinator.can_write()
    assert coordinator.try_acquire_writer()
    coordinator.recover_after_acquire()
    assert coordinator.can_write()
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM courts")).scalar() == 0
    coordinator.stop()
    engine.dispose()


@pytest.mark.parametrize("hostname,generation", [
    ("weather-helper-007-abc-def", 7), ("weather-helper-123", 123),
    ("weather-helper-0-abc", 0), ("some-other-service-007", 0),
    ("weather-helper-malformed", 0),
])
def test_detects_platform_release_generation(monkeypatch, hostname, generation):
    monkeypatch.delenv("PERSISTENCE_RELEASE_GENERATION", raising=False)
    monkeypatch.setattr("app.persistence_http.socket.gethostname", lambda: hostname)
    assert detect_release_generation() == generation


def test_release_generation_test_override_fails_closed_on_invalid(monkeypatch):
    monkeypatch.setenv("PERSISTENCE_RELEASE_GENERATION", "17")
    assert detect_release_generation() == 17
    for invalid in ("unknown", "-1", "2147483648"):
        monkeypatch.setenv("PERSISTENCE_RELEASE_GENERATION", invalid)
        assert detect_release_generation() == 0


def test_only_current_public_route_can_take_over_old_running_version(tmp_path):
    authority = GenerationAuthority()
    authority.owner = "still-running-old-version"
    routed = {"generation": 6}
    requests = []

    def traffic(request):
        requests.append(request)
        return httpx.Response(200, json=routed)

    with httpx.Client(transport=httpx.MockTransport(traffic)) as client:
        coordinator = Coordinator(
            authority, tmp_path / "new-version.db", Base.metadata,
            owner="new-version", traffic_url="https://example.invalid/api/instance",
            release_generation=7, traffic_client=client)
        coordinator.bootstrap_cache()
        # A 0% canary sees the old 100% public route and must leave its lease alone.
        assert not coordinator.try_acquire_writer()
        assert authority.owner == "still-running-old-version"
        assert not authority.lease_calls
        routed["generation"] = 7
        assert coordinator.try_acquire_writer()
        assert coordinator.can_write()
        assert authority.owner == "new-version"
        assert authority.generation == 7
        assert authority.lease_calls == [("acquire", 7, True)]
        assert not authority.heartbeat("still-running-old-version")["acquired"]
        assert not authority.acquire_lease("lower-version", generation=6, allow_takeover=True)["acquired"]
        state = coordinator.status()
        assert state["release_generation"] == state["traffic_generation"] == 7
        assert state["authority_release_generation"] == 7
        assert state["traffic_confirmed"]
        # Public route changes cancel new local writes immediately.
        routed["generation"] = 8
        assert not coordinator._confirm_traffic()
        assert not coordinator.can_write()
        assert all("no-store" in request.headers["Cache-Control"] for request in requests)
        assert all("_persistence_probe" in request.url.params for request in requests)
        assert all("Authorization" not in request.headers for request in requests)
        assert len({str(request.url) for request in requests}) == len(requests)


@pytest.mark.parametrize("response", [
    httpx.Response(503), httpx.Response(200, json={}),
    httpx.Response(200, json={"generation": "7"}),
    httpx.Response(200, json={"generation": True}),
])
def test_route_probe_failure_never_acquires_or_renews(response, tmp_path):
    authority = GenerationAuthority()
    with httpx.Client(transport=httpx.MockTransport(lambda _: response)) as client:
        coordinator = Coordinator(authority, tmp_path / "cache.db", Base.metadata,
                                  release_generation=7, traffic_url="https://example.invalid/api/instance",
                                  traffic_client=client)
        coordinator._leader, coordinator._lease_until, coordinator.valid = True, float("inf"), True
        assert not coordinator.try_acquire_writer()
        assert not coordinator.can_write()
        assert not authority.lease_calls
        assert coordinator.valid  # a valid cache can remain read-only


def test_unknown_own_generation_never_uses_a_routed_generation_as_its_identity(tmp_path):
    authority = GenerationAuthority()
    with httpx.Client(transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json={"generation": 7}))) as client:
        coordinator = Coordinator(authority, tmp_path / "cache.db", Base.metadata,
                                  release_generation=0, traffic_url="https://example.invalid/api/instance",
                                  traffic_client=client)
        assert not coordinator.try_acquire_writer()
        assert not authority.lease_calls


def test_http_generation_fields_and_release_are_sent_only_explicitly():
    received = []

    def handle(request):
        received.append(json.loads(request.content)["request"])
        return httpx.Response(200, json={"acquired": True})

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        remote = HttpRemoteStore("https://example.invalid", "inert", client=client)
        remote.acquire_lease("owner")
        remote.acquire_lease("owner", generation=7, allow_takeover=True)
        remote.heartbeat("owner", generation=7, allow_takeover=True)
        remote.release_lease("owner", generation=7)
    assert "generation" not in received[0]
    assert received[1]["generation"] == received[2]["generation"] == received[3]["generation"] == 7
    assert received[1]["allow_takeover"] is True
