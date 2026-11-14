"""Strict source checks plus opt-in real, local PostgreSQL migration tests.

Set PG_MIGRATION_TEST_URL to an ephemeral localhost PostgreSQL database to run
the integration cases. Test schemas are always random and removed afterwards.
"""
from datetime import datetime, timezone
import os
from pathlib import Path
import uuid

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url

from app.db import Base
from app import models
from scripts import pg_migration as migration


AT = datetime(2026, 11, 14, 23, 59, 12, 123456)


@pytest.fixture
def snapshot(tmp_path):
    path = tmp_path / "snapshot.db"
    engine = create_engine("sqlite:///" + path.as_posix())
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(models.Court.__table__.insert(), dict(
            id="hk-court", name_en="Test court", name_tc="維多利亞球場", name_sc="维多利亚球场",
            district_en="Wan Chai", district_tc="灣仔", lat=22.2811, lon=114.1882, letter="T",
        ))
        conn.execute(models.ForecastSnapshot.__table__.insert(), dict(
            id=41, court_id="hk-court", target_hour=AT, fetched_at=AT, precip_prob=57,
            precip_mm=0.1, apparent_temp=None, humidity=82.5,
        ))
        conn.execute(models.NowcastSnapshot.__table__.insert(), dict(
            id=47, court_id="hk-court", fetched_at=AT,
            steps_json='[{"ending":"2026-11-15T00:29","mm":0.123}]',
        ))
        conn.execute(models.Observation.__table__.insert(), [dict(
            id=53, court_id="hk-court", observed_hour=AT, fetched_at=AT,
            station_name="天文台", rainfall_mm=0.1, rain=True,
        ), dict(
            id=57, court_id="hk-court", observed_hour=AT.replace(hour=22), fetched_at=AT,
            station_name="HKO", rainfall_mm=0.0, rain=False,
        )])
        conn.execute(models.UserReport.__table__.insert(), dict(
            id=59, court_id="hk-court", device_id="local-test-device", was_raining=False,
            intensity="none", lat=22.2811, lon=114.1882, accuracy_m=None, distance_m=1.25,
            created_at=AT,
        ))
        conn.execute(models.PushSubscription.__table__.insert(), dict(
            id=61, court_id="hk-court", device_id="local-test-device",
            endpoint="https://invalid.example/local-test", p256dh="test-only", auth="test-only",
            play_at=AT, notified_at=None, created_at=AT,
        ))
        conn.execute(models.ForecastLead.__table__.insert(), dict(
            id=67, court_id="hk-court", target_hour=AT, lead_bucket="l24",
            precip_prob=24, fetched_at=AT.replace(day=13),
        ))
        conn.execute(models.Climatology.__table__.insert(), dict(
            id=71, court_id="hk-court", month=11, hour=23, samples=300, rain_count=37,
        ))
        conn.execute(models.Persistence.__table__.insert(), dict(
            id=73, court_id="hk-court", month=11, wet_to_wet=21, wet_to_dry=16,
            dry_to_wet=17, dry_to_dry=246, survival_json='{"1":0.9353612167}',
        ))
        conn.execute(models.CheckIn.__table__.insert(), dict(
            id=79, court_id="hk-court", device_id="local-test-device", played_at=AT,
            duration_hours=2.5, created_at=AT,
        ))
        conn.execute(models.Feedback.__table__.insert(), dict(
            id=83, court_id=None, device_id="local-test-device", category="bug",
            message="換行\n中文🙂", page="/courts", admin_note="", created_at=AT,
        ))
        conn.execute(models.KvCache.__table__.insert(), dict(
            key="climate_last:hk-court", value_json='"2026-10"', updated_at=AT,
        ))
    engine.dispose()
    return path


def test_reject_platform_or_ambiguous_schemas():
    for schema in ("public", "auth", "storage", "pg_catalog", "information_schema",
                   "weather_helper;DROP SCHEMA public", "weather_helper.", "weather_helper" + "x" * 64):
        with pytest.raises(migration.MigrationError):
            migration.validate_schema(schema)
    assert migration.validate_schema("weather_helper") == "weather_helper"
    assert migration.validate_schema("weather_helper_test_123") == "weather_helper_test_123"


def test_strict_boolean_timezone_and_integer_validation():
    with pytest.raises(migration.MigrationError):
        migration._normalise(2, models.Observation.__table__.c.rain)
    with pytest.raises(migration.MigrationError):
        migration._normalise(AT.replace(tzinfo=timezone.utc), models.Observation.__table__.c.observed_hour)
    with pytest.raises(migration.MigrationError):
        migration._normalise(2**31, models.Observation.__table__.c.id)
    with pytest.raises(migration.MigrationError):
        migration._normalise("has\x00nul", models.Feedback.__table__.c.message)
    assert migration._normalise(0, models.Observation.__table__.c.rain) is False
    assert migration._normalise(AT.isoformat(), models.Observation.__table__.c.observed_hour) == AT


def test_source_inventory_summary_and_no_secret_values_in_manifest(snapshot):
    engine = create_engine("sqlite:///" + snapshot.as_posix())
    with engine.connect() as conn:
        migration.validate_source(conn)
        result = migration.summarise(conn)
    assert len(result) == 12
    assert result["observations"]["rows"] == 2
    assert result["forecast_snapshots"]["ranges"]["target_hour"] == [AT.isoformat()] * 2
    assert result["climatology"]["rows"] == 1
    assert "test-only" not in str(result)
    assert "local-test-device" not in str(result)
    engine.dispose()


def test_source_rejects_orphans_and_unaccounted_tables(snapshot):
    engine = create_engine("sqlite:///" + snapshot.as_posix())
    with engine.begin() as conn:
        conn.execute(text("UPDATE observations SET court_id='missing'"))
    with engine.connect() as conn, pytest.raises(migration.MigrationError, match="orphan"):
        migration.validate_source(conn)
    with engine.begin() as conn:
        conn.execute(text("UPDATE observations SET court_id='hk-court'"))
        conn.execute(text("CREATE TABLE unexpected_business_data(id INTEGER)"))
    with engine.connect() as conn, pytest.raises(migration.MigrationError, match="inventory"):
        migration.validate_source(conn)
    engine.dispose()


@pytest.fixture
def pg():
    dsn = os.environ.get("PG_MIGRATION_TEST_URL")
    if not dsn:
        pytest.skip("PG_MIGRATION_TEST_URL not configured (real local PostgreSQL integration)")
    parsed = make_url(dsn)
    if parsed.host not in {"127.0.0.1", "localhost", "::1"}:
        pytest.fail("integration tests require a disposable localhost database")
    engine = create_engine(parsed.set(drivername="postgresql+psycopg"), hide_parameters=True)
    schema = "weather_helper_test_" + uuid.uuid4().hex[:16]
    try:
        yield engine, schema
    finally:
        with engine.begin() as conn:
            # schema consists only of the generated safe identifier above.
            conn.exec_driver_sql(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        engine.dispose()


def test_pg_exact_import_repeat_verify_and_sequences(snapshot, pg):
    engine, schema = pg
    report = migration.migrate(snapshot, engine, schema, batch_size=1)
    assert report["status"] == "imported"
    assert report["table_count"] == 12 and report["exact_values_match"]
    assert migration.migrate(snapshot, engine, schema)["status"] == "already_imported"
    assert migration.migrate(snapshot, engine, schema, verify_only=True)["status"] == "verified"
    with engine.begin() as conn:
        found = conn.execute(text(f'SELECT observed_hour, rain FROM "{schema}".observations WHERE id=53')).one()
        assert found == (AT, True)
        assert found.observed_hour.tzinfo is None
        new_id = conn.execute(text(
            f'INSERT INTO "{schema}".observations '
            '(court_id, observed_hour, fetched_at, station_name, rainfall_mm, rain) '
            "VALUES ('hk-court', :at, :at, 'HKO', 0.0, false) RETURNING id"
        ), {"at": AT.replace(day=15)}).scalar_one()
        assert new_id == 58
        assert conn.execute(text(f'SELECT samples FROM "{schema}".climatology')).scalar_one() == 300
    # Runtime changes make an exact rerun fail safely; it cannot erase new rows.
    with pytest.raises(migration.MigrationError, match="mismatch"):
        migration.migrate(snapshot, engine, schema)
    with engine.connect() as conn:
        assert conn.execute(text(f'SELECT COUNT(*) FROM "{schema}".observations')).scalar_one() == 3


def test_pg_nonempty_target_refused_without_changing_data(snapshot, pg):
    engine, schema = pg
    metadata, _ = migration._target_metadata(schema)
    with engine.begin() as conn:
        conn.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        metadata.create_all(conn)
        conn.execute(metadata.tables[f"{schema}.kv_cache"].insert(), {
            "key": "do-not-touch", "value_json": "123", "updated_at": AT,
        })
    with pytest.raises(migration.MigrationError, match="non-empty"):
        migration.migrate(snapshot, engine, schema)
    with engine.connect() as conn:
        assert conn.execute(text(f'SELECT key FROM "{schema}".kv_cache')).scalar_one() == "do-not-touch"
        assert conn.execute(text(f'SELECT COUNT(*) FROM "{schema}".courts')).scalar_one() == 0


def test_pg_late_failure_rolls_back_rows_schema_and_sequences(snapshot, pg, monkeypatch):
    engine, schema = pg
    original = migration._reset_sequences

    def fail_after_reset(conn, selected_schema):
        original(conn, selected_schema)
        raise RuntimeError("injected failure after copying and sequence restart")

    monkeypatch.setattr(migration, "_reset_sequences", fail_after_reset)
    with pytest.raises(RuntimeError, match="injected"):
        migration.migrate(snapshot, engine, schema)
    with engine.connect() as conn:
        assert not inspect(conn).has_schema(schema)
    monkeypatch.setattr(migration, "_reset_sequences", original)
    assert migration.migrate(snapshot, engine, schema)["status"] == "imported"


def test_pg_changed_source_file_refused_before_commit(snapshot, pg, monkeypatch):
    engine, schema = pg
    real_hash = migration.file_sha256
    calls = 0

    def changed_hash(path):
        nonlocal calls
        calls += 1
        return real_hash(path) if calls == 1 else "0" * 64

    monkeypatch.setattr(migration, "file_sha256", changed_hash)
    with pytest.raises(migration.MigrationError, match="changed"):
        migration.migrate(snapshot, engine, schema)
    with engine.connect() as conn:
        assert not inspect(conn).has_schema(schema)


def test_pg_corrupt_boolean_source_fails_without_partial_data(snapshot, pg):
    engine, schema = pg
    source = create_engine("sqlite:///" + snapshot.as_posix())
    with source.begin() as conn:
        conn.execute(text("UPDATE observations SET rain=2 WHERE id=53"))
    source.dispose()
    with pytest.raises(migration.MigrationError, match="invalid value"):
        migration.migrate(snapshot, engine, schema, batch_size=1)
    with engine.connect() as conn:
        assert not inspect(conn).has_schema(schema)


def test_cli_refuses_missing_secret_and_preserves_existing_report(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("PG_MIGRATION_DATABASE_URL", raising=False)
    report = tmp_path / "report.json"
    assert migration.main(["--source", "not-used", "--schema", "weather_helper",
                           "--report", str(report)]) == 1
    assert not report.exists()
    assert "PG_MIGRATION_DATABASE_URL" in capsys.readouterr().err
