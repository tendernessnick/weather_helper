"""Real local PostgreSQL security/atomicity tests for CloudBase's HTTP RPC.

The RPC is renamed and installed into a random test schema; no production
schema or unrelated public function is modified. See test_pg_migration.py for
the common local-only connection fixture and representative 12-table snapshot.
"""
from datetime import datetime
import json
from pathlib import Path
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError

from scripts import pg_migration as migration
from tests.test_pg_migration import pg, snapshot  # noqa: F401 fixtures


@pytest.fixture
def rpc(pg):
    engine, schema = pg
    # These inert roles exist on CloudBase. Only the disposable local test DB
    # needs their creation; the production installation never creates roles.
    with engine.begin() as conn:
        for role in ("anon", "authenticated", "service_role"):
            if not conn.execute(text("SELECT 1 FROM pg_roles WHERE rolname=:name"), {"name": role}).scalar():
                conn.exec_driver_sql(f'CREATE ROLE "{role}" NOLOGIN')
    ddl = Path(__file__).parents[1] / "scripts" / "sql" / "http_persistence.sql"
    sql = ddl.read_text(encoding="utf-8").replace("weather_helper", schema)
    raw = engine.raw_connection()
    try:
        raw.cursor().execute(sql)
        raw.commit()
    finally:
        raw.close()
    function = f"public.{schema}_sync"

    def call(request, role="service_role"):
        with engine.begin() as conn:
            conn.exec_driver_sql(f'SET LOCAL ROLE "{role}"')
            return conn.execute(text(f"SELECT {function}(CAST(:request AS jsonb))"), {
                "request": json.dumps(request, default=lambda value: value.isoformat(timespec="microseconds")),
            }).scalar_one()

    try:
        yield call, engine, schema
    finally:
        with engine.begin() as conn:
            conn.exec_driver_sql(f"DROP FUNCTION IF EXISTS {function}(jsonb)")


@pytest.fixture
def records(snapshot):
    source = create_engine("sqlite:///" + snapshot.as_posix())
    result = []
    try:
        with source.connect() as conn:
            for table in migration.business_tables():
                for batch in migration._rows(conn, table):
                    for row in batch:
                        result.append({"table": table.name, "op": "upsert",
                                       "key": row[next(iter(table.primary_key)).name], "row": row})
        return result
    finally:
        source.dispose()


def _writer(call):
    owner = str(uuid.uuid4())
    result = call({"action": "lease_acquire", "owner": owner, "ttl_seconds": 90})
    assert result["acquired"]
    return owner, result["revision"]


def _stage(call, owner, revision, tx_id, batch_index, changes):
    return call({"action": "stage", "owner": owner, "expected_revision": revision,
                 "tx_id": tx_id, "batch_index": batch_index, "changes": changes})


def _commit(call, owner, revision, tx_id, batches):
    return call({"action": "commit", "owner": owner, "expected_revision": revision,
                 "tx_id": tx_id, "batch_count": batches})


def test_rpc_service_only_and_platform_tables_unreachable(rpc):
    call, engine, schema = rpc
    assert call({"action": "manifest"})["schema_version"] == 1
    for role in ("anon", "authenticated"):
        with pytest.raises(DBAPIError) as caught:
            call({"action": "manifest"}, role)
        assert caught.value.orig.sqlstate == "42501"
    with engine.connect() as conn:
        assert not conn.execute(text("SELECT has_schema_privilege('anon',:schema,'USAGE')"), {"schema": schema}).scalar_one()
    owner, revision = _writer(call)
    for table in ("auth.users", "storage.objects", "public.users", 'courts;DROP SCHEMA public CASCADE'):
        with pytest.raises(DBAPIError):
            _stage(call, owner, revision, "injection", 0, [{"table": table, "op": "delete", "key": 1}])
    with pytest.raises(DBAPIError):
        call({"action": "sql", "sql": "DROP SCHEMA public CASCADE"})


def test_rpc_all_twelve_tables_exact_restore_paging_and_idempotence(rpc, records, snapshot):
    call, engine, schema = rpc
    owner, revision = _writer(call)
    assert revision == 0
    batches = [records[:6], records[6:]]
    for index, changes in enumerate(batches):
        assert _stage(call, owner, revision, "exact_restore", index, changes)["staged"]
        assert _stage(call, owner, revision, "exact_restore", index, changes)["staged"]
    assert sum(t["count"] for t in call({"action": "manifest"})["tables"].values()) == 0
    result = _commit(call, owner, revision, "exact_restore", 2)
    assert result == {"revision": 1, "tx_id": "exact_restore", "already_applied": False}
    assert _commit(call, owner, revision, "exact_restore", 2)["already_applied"]
    assert _stage(call, owner, revision, "exact_restore", 0, batches[0])["already_applied"]
    with pytest.raises(DBAPIError):
        _stage(call, owner, revision, "exact_restore", 0, batches[1])
    with pytest.raises(DBAPIError):
        _commit(call, owner, revision, "exact_restore", 1)
    source = create_engine("sqlite:///" + snapshot.as_posix())
    try:
        with source.connect() as source_conn, engine.connect() as target:
            migration._equal(migration.summarise(source_conn), migration.summarise(target, schema))
    finally:
        source.dispose()
    manifest = call({"action": "manifest"})
    assert manifest["tables"]["observations"] == {"count": 2, "pk": "id"}
    page = call({"action": "snapshot", "table": "observations", "after": None, "limit": 1, "revision": 1})
    assert page["rows"][0]["rain"] is True and page["next_cursor"] == 53
    page = call({"action": "snapshot", "table": "observations", "after": page["next_cursor"], "limit": 1, "revision": 1})
    assert page["rows"][0]["rain"] is False and page["next_cursor"] == 57
    page = call({"action": "snapshot", "table": "observations", "after": 57, "limit": 1, "revision": 1})
    assert page["rows"] == [] and page["next_cursor"] is None
    # Lost commit responses are recoverable even after the lease expires.
    with engine.begin() as conn:
        conn.exec_driver_sql(f'UPDATE "{schema}"._state SET expires_at=clock_timestamp()-interval \'1 second\'')
    assert _commit(call, owner, revision, "exact_restore", 2)["already_applied"]


def test_rpc_cas_lease_and_batch_retry_validation(rpc, records):
    call, engine, schema = rpc
    owner, revision = _writer(call)
    another = str(uuid.uuid4())
    assert not call({"action": "lease_acquire", "owner": another})["acquired"]
    assert not call({"action": "heartbeat", "owner": another})["acquired"]
    assert call({"action": "heartbeat", "owner": owner})["acquired"]
    with pytest.raises(DBAPIError):
        _stage(call, another, revision, "bad_owner", 0, records[:1])
    with pytest.raises(DBAPIError):
        _stage(call, owner, revision + 1, "bad_revision", 0, records[:1])
    _stage(call, owner, revision, "retry", 0, records[:1])
    with pytest.raises(DBAPIError):
        _stage(call, owner, revision, "retry", 0, records[1:2])
    with pytest.raises(DBAPIError):
        _commit(call, owner, revision, "retry", 2)
    assert call({"action": "manifest"})["revision"] == 0
    assert call({"action": "lease_release", "owner": owner})["released"]
    assert call({"action": "lease_acquire", "owner": another})["acquired"]
    with engine.connect() as conn:
        assert conn.exec_driver_sql(f'SELECT count(*) FROM "{schema}"._staging').scalar_one() == 0


def test_rpc_complete_columns_strict_booleans_naive_time_and_key_match(rpc, records):
    call, _, _ = rpc
    owner, revision = _writer(call)
    observation = next(r for r in records if r["table"] == "observations")
    import copy
    bad_changes = []
    wrong_bool = copy.deepcopy(observation)
    wrong_bool["row"]["rain"] = 1
    bad_changes.append(wrong_bool)
    wrong_time = copy.deepcopy(observation)
    wrong_time["row"]["observed_hour"] = "2026-11-14T15:59:12Z"
    bad_changes.append(wrong_time)
    missing = copy.deepcopy(observation)
    del missing["row"]["fetched_at"]
    bad_changes.append(missing)
    unknown = copy.deepcopy(observation)
    unknown["row"]["injected"] = "bad"
    bad_changes.append(unknown)
    mismatched = copy.deepcopy(observation)
    mismatched["key"] = 999
    bad_changes.append(mismatched)
    fractional = copy.deepcopy(observation)
    fractional["key"] = 53.5
    bad_changes.append(fractional)
    for change in bad_changes:
        with pytest.raises(DBAPIError):
            _stage(call, owner, revision, "bad_row", 0, [change])
    assert call({"action": "manifest"})["revision"] == 0


def test_rpc_unique_failure_rolls_back_all_batches_and_revision(rpc, records):
    call, engine, schema = rpc
    owner, revision = _writer(call)
    import copy
    original = next(r for r in records if r["table"] == "forecast_snapshots")
    duplicate = copy.deepcopy(original)
    duplicate["key"] = duplicate["row"]["id"] = 999
    _stage(call, owner, revision, "rollback", 0, [original])
    _stage(call, owner, revision, "rollback", 1, [duplicate])
    with pytest.raises(DBAPIError) as caught:
        _commit(call, owner, revision, "rollback", 2)
    assert caught.value.orig.sqlstate == "23505"
    with engine.connect() as conn:
        assert conn.exec_driver_sql(f'SELECT count(*) FROM "{schema}".forecast_snapshots').scalar_one() == 0
        assert conn.exec_driver_sql(f'SELECT count(*) FROM "{schema}"._staging').scalar_one() == 2
        assert conn.exec_driver_sql(f'SELECT count(*) FROM "{schema}"._transactions').scalar_one() == 0
    assert call({"action": "manifest"})["revision"] == 0


def test_rpc_upsert_delete_and_snapshot_revision_conflict(rpc, records):
    call, _, _ = rpc
    owner, revision = _writer(call)
    court = next(r for r in records if r["table"] == "courts")
    _stage(call, owner, revision, "insert", 0, [court])
    _commit(call, owner, revision, "insert", 1)
    with pytest.raises(DBAPIError) as caught:
        call({"action": "snapshot", "table": "courts", "revision": 0})
    assert caught.value.orig.sqlstate == "40001"
    court["row"]["name_en"] = "Changed without duplicating the record"
    _stage(call, owner, 1, "update", 0, [court])
    _commit(call, owner, 1, "update", 1)
    assert call({"action": "manifest"})["tables"]["courts"]["count"] == 1
    assert call({"action": "snapshot", "table": "courts", "revision": 2})["rows"][0]["name_en"] == court["row"]["name_en"]
    _stage(call, owner, 2, "delete", 0, [{"table": "courts", "op": "delete", "key": court["key"]}])
    _commit(call, owner, 2, "delete", 1)
    assert call({"action": "manifest"})["tables"]["courts"]["count"] == 0


def test_rpc_repeated_primary_key_keeps_sequential_last_mutation(rpc, records):
    import copy
    call, _, _ = rpc
    owner, revision = _writer(call)
    court = next(r for r in records if r["table"] == "courts")
    changed = copy.deepcopy(court)
    changed["row"]["name_en"] = "The final upsert wins"
    _stage(call, owner, revision, "same_pk", 0, [court, changed])
    _commit(call, owner, revision, "same_pk", 1)
    rows = call({"action": "snapshot", "table": "courts", "revision": 1})["rows"]
    assert len(rows) == 1 and rows[0]["name_en"] == changed["row"]["name_en"]


def test_http_import_full_fingerprints_resume_and_import_fence(rpc, snapshot, tmp_path):
    from scripts.pg_http_migration import migrate_http
    call, _, _ = rpc

    class LocalRemote:
        fail_after_commit = True

        def request(self, action, **fields):
            return call({"action": action, **fields})

        def manifest(self):
            return self.request("manifest")

        def read_page(self, table, after_key=None, limit=2000, expected_revision=None):
            return self.request("snapshot", table=table, after=after_key, limit=limit, revision=expected_revision)

        def acquire_lease(self, owner, ttl_seconds=90):
            return self.request("lease_acquire", owner=owner, ttl_seconds=ttl_seconds)

        def heartbeat(self, owner, ttl_seconds=90):
            return self.request("heartbeat", owner=owner, ttl_seconds=ttl_seconds)

        def release_lease(self, owner):
            return self.request("lease_release", owner=owner)

        def stage(self, owner, expected_revision, tx_id, batch_index, changes):
            return self.request("stage", owner=owner, expected_revision=expected_revision,
                                tx_id=tx_id, batch_index=batch_index, changes=changes)

        def commit(self, owner, expected_revision, tx_id, batch_count):
            result = self.request("commit", owner=owner, expected_revision=expected_revision,
                                  tx_id=tx_id, batch_count=batch_count)
            if self.fail_after_commit:
                self.fail_after_commit = False
                raise RuntimeError("simulated lost commit response before journal save")
            return result

    remote = LocalRemote()
    state = tmp_path / "import-state.private.json"
    with pytest.raises(RuntimeError, match="lost commit"):
        migrate_http(snapshot, remote, state, rows_per_transaction=2, page_size=1)
    assert remote.manifest()["import_in_progress"]
    assert not remote.acquire_lease(str(uuid.uuid4()))["acquired"]
    result = migrate_http(snapshot, remote, state, rows_per_transaction=2, page_size=1)
    assert result["exact_values_match"] and result["table_count"] == 12
    assert not remote.manifest()["import_in_progress"]
    assert migrate_http(snapshot, remote, state, rows_per_transaction=2, page_size=1)["status"] == "already_imported"
    # All twelve RPC snapshots are compared, including feedback.page, which
    # previously collided with a SQL row alias and returned just a string.
    assert result["tables"]["feedback"]["rows"] == 1


def test_rpc_string_key_cursor_uses_sqlite_binary_order_across_pg_locales(rpc):
    call, engine, schema = rpc
    with engine.begin() as conn:
        collation = conn.execute(text(
            "SELECT collname FROM pg_collation WHERE collprovider='i' "
            "AND collname IN ('en-US-x-icu','en-US') LIMIT 1"
        )).scalar_one_or_none()
        if collation is None:
            pytest.skip("local PostgreSQL has no English ICU collation")
        quoted = conn.dialect.identifier_preparer.quote_identifier(collation)
        conn.exec_driver_sql(f'ALTER TABLE "{schema}".kv_cache ALTER COLUMN key TYPE varchar(50) COLLATE {quoted}')
    owner, revision = _writer(call)
    changes = [{"table": "kv_cache", "op": "upsert", "key": key, "row": {
        "key": key, "value_json": "{}", "updated_at": "2026-11-14T23:00:00",
    }} for key in ("a", "B", "á")]
    _stage(call, owner, revision, "mixed_keys", 0, changes)
    _commit(call, owner, revision, "mixed_keys", 1)
    keys, cursor = [], None
    while True:
        page = call({"action": "snapshot", "table": "kv_cache", "after": cursor, "limit": 1, "revision": 1})
        if not page["rows"]:
            break
        keys.append(page["rows"][0]["key"])
        cursor = page["next_cursor"]
    assert keys == ["B", "a", "á"]
