"""Real PostgreSQL fencing of obsolete CloudBase versions after traffic switches."""
import hashlib
from pathlib import Path
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from scripts.pg_migration import summarise
from tests.test_pg_migration import pg, snapshot  # noqa: F401 fixtures
from tests.test_pg_migration_rpc import rpc, records, _stage, _commit  # noqa: F401 fixtures


def _acquire(call, owner, generation=None, allow_takeover=None, action="lease_acquire"):
    request = {"action": action, "owner": owner}
    if generation is not None:
        request["generation"] = generation
    if allow_takeover is not None:
        request["allow_takeover"] = allow_takeover
    return call(request)


def _expire(engine, schema):
    with engine.begin() as conn:
        conn.exec_driver_sql(f'UPDATE "{schema}"._state SET expires_at=clock_timestamp()-interval \'1 second\'')


def test_higher_routed_generation_fences_old_active_owner_and_pending_writes(rpc):
    call, engine, schema = rpc
    old_owner, candidate = str(uuid.uuid4()), str(uuid.uuid4())
    assert _acquire(call, old_owner)["release_generation"] == 0
    _stage(call, old_owner, 0, "old_pending_write", 0, [{
        "table": "kv_cache", "op": "upsert", "key": "old-generation", "row": {
            "key": "old-generation", "value_json": "{}", "updated_at": "2026-11-15T00:00:00",
        },
    }])
    assert not _acquire(call, candidate, 7)["acquired"]
    assert not _acquire(call, old_owner, 7, True, action="heartbeat")["acquired"]
    acquired = _acquire(call, candidate, 7, True)
    assert acquired["acquired"] and acquired["release_generation"] == 7
    assert acquired["revision"] == 0
    for action in ("heartbeat", "lease_acquire"):
        result = _acquire(call, old_owner, action=action)
        assert not result["acquired"] and result["release_generation"] == 7
        assert not _acquire(call, old_owner, 0, True, action=action)["acquired"]
    with pytest.raises(DBAPIError) as caught:
        _commit(call, old_owner, 0, "old_pending_write", 1)
    assert caught.value.orig.sqlstate == "42501"
    assert _acquire(call, candidate, 7, action="heartbeat")["acquired"]
    manifest = call({"action": "manifest"})
    assert manifest["revision"] == 0 and manifest["release_generation"] == 7
    assert manifest["tables"]["kv_cache"]["count"] == 0
    with engine.connect() as conn:
        assert conn.exec_driver_sql(f'SELECT count(*) FROM "{schema}"._staging').scalar_one() == 0


def test_generation_is_monotonic_after_release_expiry_and_same_owner_requests(rpc):
    call, engine, schema = rpc
    owner, replacement, legacy = (str(uuid.uuid4()) for _ in range(3))
    assert _acquire(call, owner, 7)["acquired"]
    # Same UUID does not let an outdated release/heartbeat bypass generation.
    assert not call({"action": "lease_release", "owner": owner})["released"]
    assert not call({"action": "lease_release", "owner": owner, "generation": 6})["released"]
    assert not _acquire(call, owner, 6, action="heartbeat")["acquired"]
    assert call({"action": "lease_release", "owner": owner, "generation": 7}) == {
        "released": True, "revision": 0, "release_generation": 7,
    }
    assert not _acquire(call, legacy)["acquired"]
    assert _acquire(call, replacement, 7)["acquired"]
    _expire(engine, schema)
    assert not _acquire(call, legacy, 0, True)["acquired"]
    assert not _acquire(call, replacement, 7, action="heartbeat")["acquired"]
    assert _acquire(call, owner, 7)["acquired"]
    _expire(engine, schema)
    # A legitimately expired lease does not need forced-takeover permission.
    assert _acquire(call, replacement, 8)["acquired"]
    assert not _acquire(call, owner, 7, True)["acquired"]


def test_equal_generation_cannot_force_takeover_of_an_active_peer(rpc):
    call, engine, schema = rpc
    owner, peer = str(uuid.uuid4()), str(uuid.uuid4())
    assert _acquire(call, owner, 7)["acquired"]
    assert not _acquire(call, peer, 7, True)["acquired"]
    assert _acquire(call, owner, 7, True)["acquired"]
    _expire(engine, schema)
    assert _acquire(call, peer, 7)["acquired"]


def test_initial_import_owner_cannot_be_preempted_even_by_higher_generation(rpc):
    call, engine, schema = rpc
    importing, newer = str(uuid.uuid4()), str(uuid.uuid4())
    assert _acquire(call, importing)["acquired"]
    tables = call({"action": "manifest"})["tables"]
    source = {name: {"rows": 0, "sha256": hashlib.sha256().hexdigest(), "ranges": {}, "court_counts": {}}
              for name in tables}
    begin = call({"action": "import_begin", "owner": importing, "source_sha256": "0" * 64,
                  "source_manifest": source, "rows_per_transaction": 4000})
    assert not begin["completed"]
    assert not _acquire(call, newer, 999, True)["acquired"]
    _expire(engine, schema)
    assert not _acquire(call, newer, 999, True)["acquired"]
    assert _acquire(call, importing)["acquired"]
    finish = call({"action": "import_finish", "owner": importing, "source_sha256": "0" * 64,
                   "verified_manifest": source})
    assert finish["completed"]
    acquired = _acquire(call, newer, 7, True)
    assert acquired["acquired"] and acquired["release_generation"] == 7
    assert call({"action": "manifest"})["revision"] == 0


def test_generation_inputs_are_strict_json_types_and_bounded(rpc):
    call, _, _ = rpc
    owner = str(uuid.uuid4())
    for generation in (-1, "7", 1.5, True, None, 2**63):
        with pytest.raises(DBAPIError):
            call({"action": "lease_acquire", "owner": owner, "generation": generation})
    for flag in ("true", 1, None):
        with pytest.raises(DBAPIError):
            call({"action": "lease_acquire", "owner": owner, "allow_takeover": flag})
    assert call({"action": "manifest"})["release_generation"] == 0


def test_minimal_upgrade_is_idempotent_and_preserves_all_business_values_revision_and_import(rpc, records):
    call, engine, schema = rpc
    owner = str(uuid.uuid4())
    assert _acquire(call, owner)["acquired"]
    _stage(call, owner, 0, "pre_upgrade_data", 0, records)
    _commit(call, owner, 0, "pre_upgrade_data", 1)
    assert _acquire(call, owner, 7, True)["acquired"]
    with engine.begin() as conn:
        before = summarise(conn, schema)
        # A completed real-world import marker must remain completed and retain
        # its immutable source identity across this lease-only upgrade.
        conn.execute(text(f'INSERT INTO "{schema}"._imports '
            '(singleton,source_sha256,source_manifest,owner,rows_per_transaction,completed,started_revision) '
            "VALUES(true,:hash,'{}'::jsonb,:owner,4000,true,0)"), {"hash": "1" * 64, "owner": owner})
        state_before = conn.exec_driver_sql(f'SELECT * FROM "{schema}"._state').one()
        import_before = conn.exec_driver_sql(f'SELECT * FROM "{schema}"._imports').one()
        transactions_before = conn.exec_driver_sql(f'SELECT * FROM "{schema}"._transactions').all()
    sql_path = Path(__file__).parents[1] / "scripts" / "sql" / "upgrade_release_generation.sql"
    upgrade = sql_path.read_text(encoding="utf-8").replace("weather_helper", schema)
    assert "CREATE TABLE" not in upgrade and "TRUNCATE" not in upgrade
    for _ in range(2):
        raw = engine.raw_connection()
        try:
            raw.cursor().execute(upgrade)
            raw.commit()
        finally:
            raw.close()
    with engine.connect() as conn:
        assert summarise(conn, schema) == before
        assert conn.exec_driver_sql(f'SELECT * FROM "{schema}"._state').one() == state_before
        assert conn.exec_driver_sql(f'SELECT * FROM "{schema}"._imports').one() == import_before
        assert conn.exec_driver_sql(f'SELECT * FROM "{schema}"._transactions').all() == transactions_before
    assert _acquire(call, str(uuid.uuid4()), 8, True)["acquired"]
    assert call({"action": "manifest"})["revision"] == 1


def test_upgrade_rpc_definition_stays_identical_to_fresh_install_definition():
    directory = Path(__file__).parents[1] / "scripts" / "sql"
    fresh = (directory / "http_persistence.sql").read_text(encoding="utf-8")
    upgrade = (directory / "upgrade_release_generation.sql").read_text(encoding="utf-8")
    marker = "CREATE OR REPLACE FUNCTION public.weather_helper_sync(request jsonb)"
    def definition(sql):
        start = sql.index(marker)
        return sql[start:sql.index("$rpc$;", start) + len("$rpc$;")]
    assert definition(fresh) == definition(upgrade)


def test_upgrade_from_legacy_state_without_generation_retains_current_writer_and_data(rpc, records):
    call, engine, schema = rpc
    owner = str(uuid.uuid4())
    assert _acquire(call, owner)["acquired"]
    _stage(call, owner, 0, "legacy_rows", 0, records)
    _commit(call, owner, 0, "legacy_rows", 1)
    with engine.begin() as conn:
        before = summarise(conn, schema)
        # Reproduce the exact pre-upgrade metadata shape on this disposable DB.
        conn.exec_driver_sql(f'ALTER TABLE "{schema}"._state DROP COLUMN generation')
        old_state = conn.exec_driver_sql(f'SELECT singleton,revision,owner,expires_at FROM "{schema}"._state').one()
    path = Path(__file__).parents[1] / "scripts" / "sql" / "upgrade_release_generation.sql"
    raw = engine.raw_connection()
    try:
        raw.cursor().execute(path.read_text(encoding="utf-8").replace("weather_helper", schema))
        raw.commit()
    finally:
        raw.close()
    with engine.connect() as conn:
        assert summarise(conn, schema) == before
        assert conn.exec_driver_sql(f'SELECT singleton,revision,owner,expires_at FROM "{schema}"._state').one() == old_state
        assert conn.exec_driver_sql(f'SELECT generation FROM "{schema}"._state').scalar_one() == 0
    assert _acquire(call, owner, action="heartbeat")["acquired"]
    assert _acquire(call, str(uuid.uuid4()), 7, True)["acquired"]
    assert call({"action": "manifest"})["revision"] == 1
