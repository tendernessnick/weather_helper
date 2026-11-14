"""Database boundaries and calendar aggregates work on both supported dialects."""
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app import diagnostics
from app.api import admin
from app.db import Base, create_database_engine, engine_schema, validate_database_schema
from app.models import CheckIn, Court, UserReport


@pytest.mark.parametrize("schema", ["public", "auth", "storage", "pg_catalog",
                                   "pg_temp", "information_schema", "", "a,b",
                                   'test";DROP SCHEMA auth;', "a.b", "x" * 64])
def test_rejects_platform_or_unsafe_schema(schema):
    with pytest.raises(ValueError, match="dedicated application schema"):
        validate_database_schema(schema)


@pytest.mark.parametrize("scheme", ["postgres", "postgresql", "postgresql+psycopg2"])
def test_postgres_engine_uses_bounded_pool_and_transaction_schema(scheme):
    # Engine construction must not connect, so these are inert sample values.
    engine = create_database_engine(f"{scheme}://example:example@localhost/example",
                                    database_schema="weather_test")
    try:
        assert engine.dialect.driver == "psycopg"
        assert engine_schema(engine) == "weather_test"
        assert engine.pool.size() == 2
        assert engine.pool._max_overflow == 0
        connection = MagicMock()
        connection.dialect = engine.dialect
        for listener in engine.dispatch.begin:
            listener(connection)
        connection.exec_driver_sql.assert_called_once_with(
            'SET LOCAL search_path TO "weather_test"')
        sql = str(select(Court).compile(
            engine, schema_translate_map={None: "weather_test"},
            render_schema_translate=True))
        assert "weather_test.courts" in sql
    finally:
        engine.dispose()


@pytest.mark.parametrize("pool_size,overflow", [(0, 0), (11, 0), (2, -1), (2, 6)])
def test_postgres_rejects_unbounded_or_large_pool(pool_size, overflow):
    with pytest.raises(ValueError, match="pool_size"):
        create_database_engine("postgresql://localhost/test",
                               pool_size=pool_size, max_overflow=overflow)


def test_admin_calendar_counts_use_hong_kong_naive_hours_and_iso_days(monkeypatch):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    now = datetime(2026, 11, 14, 10)
    monkeypatch.setattr(admin, "hk_now", lambda: now)
    monkeypatch.setattr(admin, "db_state", lambda **_: {})
    with Session(engine) as db:
        db.add(Court(id="c1", name_en="Court", name_tc="場", name_sc="场",
                     district_en="District", district_tc="區", lat=22.3,
                     lon=114.2, letter="C"))
        for device, created, status in (
            ("one", now.replace(hour=7), "accepted"),
            ("two", now.replace(hour=8), "rejected_cooldown"),
            # The first displayed day includes its early morning, rather than
            # accidentally starting at the current time-of-day six days ago.
            ("three", now.replace(hour=2) - timedelta(days=6), "accepted"),
        ):
            db.add(UserReport(court_id="c1", device_id=device, was_raining=False,
                              intensity="none", lat=22.3, lon=114.2,
                              status=status, created_at=created))
        db.add(CheckIn(court_id="c1", device_id="one", played_at=now,
                       created_at=now, duration_hours=1))
        db.commit()
        overview = admin.admin_overview(db=db)
        assert overview["reports_trend_7d"][0] == {"date": "2026-11-08", "count": 1}
        assert overview["reports_trend_7d"][-1] == {"date": "2026-11-14", "count": 1}
        activity = admin.admin_activity(days=7, db=db)
        assert activity["dau"][-1] == {"date": "2026-11-14", "devices": 2}
        assert activity["reports_by_hour"][2] == 1
        assert activity["reports_by_hour"][7] == 1
        assert activity["reports_by_hour"][8] == 1
        assert sum(activity["reports_by_hour"]) == 3
    engine.dispose()


def test_postgres_diagnostics_never_returns_connection_secrets(monkeypatch):
    engine = create_database_engine(
        "postgresql://private-account:private-password@private-host/private-db",
        database_schema="weather_test")
    monkeypatch.setattr(diagnostics, "engine", engine)
    db = MagicMock()
    statements = []

    def execute(statement, parameters=None):
        sql = str(statement)
        statements.append((sql, parameters))
        result = MagicMock()
        result.scalar.return_value = (2_500_000 if "pg_total_relation_size" in sql
                                      else None if "MAX(" in sql else 42)
        return result

    db.execute.side_effect = execute
    factory = MagicMock()
    factory.return_value.__enter__.return_value = db
    monkeypatch.setattr(diagnostics, "SessionLocal", factory)
    try:
        state = diagnostics.db_state()
        assert state["database_backend"] == "postgresql"
        assert state["database_schema"] == "weather_test"
        assert state["db_size_mb"] == 2.5
        assert state["forecast_leads"] == state["persistence"] == state["kv_cache"] == 42
        assert "database_url" not in state
        assert "db_file" not in state
        assert "private-" not in str(state)
        assert statements[0][1] == {"schema": "weather_test"}
        assert all("pg_database_size" not in sql for sql, _ in statements)
    finally:
        engine.dispose()
