"""Full ORM→SQLite outbox→HTTP shape→real PostgreSQL RPC→cache rebuild."""
from datetime import datetime
import json
import uuid

import httpx
from sqlalchemy import create_engine, delete
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import KvCache, Observation
from app.persistence_http import Coordinator, HttpPersistenceSession, HttpRemoteStore
from scripts import pg_migration as migration
from tests.test_pg_migration import pg, snapshot  # noqa: F401
from tests.test_pg_migration_rpc import records, rpc  # noqa: F401


def _remote(call):
    def handle(request):
        try:
            result = call(json.loads(request.content)["request"])
            return httpx.Response(200, json=result)
        except Exception:
            return httpx.Response(409, json={"error": "RPC rejected"})
    return HttpRemoteStore("https://local-test.invalid", "inert-key",
                           client=httpx.Client(transport=httpx.MockTransport(handle)))


def test_full_twelve_table_rebuild_and_real_rpc_commit(rpc, records, snapshot, tmp_path):
    call, _, _ = rpc
    owner = str(uuid.uuid4())
    call({"action": "lease_acquire", "owner": owner, "ttl_seconds": 90})
    tx_id = str(uuid.uuid4())
    call({"action": "stage", "owner": owner, "expected_revision": 0,
          "tx_id": tx_id, "batch_index": 0, "changes": records})
    call({"action": "commit", "owner": owner, "expected_revision": 0,
          "tx_id": tx_id, "batch_count": 1})
    call({"action": "lease_release", "owner": owner})

    remote = _remote(call)
    path = tmp_path / "first-cache.db"
    coordinator = Coordinator(remote, path, Base.metadata, page_size=1)
    coordinator.bootstrap_cache()
    assert coordinator.try_acquire_writer()
    cache = create_engine(f"sqlite:///{path}")
    source = create_engine(f"sqlite:///{snapshot}")
    with source.connect() as conn:
        original = migration.summarise(conn)
    with cache.connect() as conn:
        rebuilt = migration.summarise(conn)
    assert original == rebuilt  # every value/date/boolean/JSON hashes identically
    source.dispose()

    coordinator.install(cache)
    sessions = sessionmaker(bind=cache, class_=HttpPersistenceSession,
                            persistence_coordinator=coordinator)
    try:
        with sessions() as db:
            db.add(KvCache(key="http-test", value_json='{"安全":true}',
                           updated_at=datetime(2026, 11, 15, 14, 15, 16, 123456)))
            db.add(Observation(court_id="hk-court", observed_hour=datetime(2026, 11, 15, 14),
                               station_name="HKO", rainfall_mm=1.23, rain=True,
                               fetched_at=datetime(2026, 11, 15, 14, 15)))
            db.commit()
            db.execute(delete(Observation).where(Observation.rain.is_(False)))
            db.commit()
        assert coordinator.revision == 3
        before = remote.manifest()
        assert before["tables"]["observations"]["count"] == 2
        assert before["tables"]["kv_cache"]["count"] == 2
        # Delete the entire first cache after closing it. The next process has
        # only the HTTP API and obtains the same business-table hashes.
        with cache.connect() as conn:
            current = migration.summarise(conn)
        coordinator.stop()
        cache.dispose()
        path.unlink()
        next_coordinator = Coordinator(remote, tmp_path / "second-cache.db", Base.metadata)
        next_coordinator.bootstrap_cache()
        second = create_engine(f"sqlite:///{next_coordinator.cache_path}")
        try:
            with second.connect() as conn:
                assert migration.summarise(conn) == current
            assert next_coordinator.revision == 3
        finally:
            second.dispose()
    finally:
        coordinator.stop()
        cache.dispose()
        remote._client.close()
