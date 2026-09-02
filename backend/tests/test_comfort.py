import os

os.environ.setdefault("DATABASE_URL", "sqlite://")

from app.services.comfort import comfort_level  # noqa: E402


def test_comfort_boundaries():
    assert comfort_level(None, None)["level"] is None

    assert comfort_level(26.0, 10)["level"] == "good"
    assert comfort_level(28.0, 10)["level"] == "fair"
    assert comfort_level(32.0, 10)["level"] == "poor"
    assert comfort_level(35.0, 10)["level"] == "severe"


def test_comfort_wind_advisory():
    r = comfort_level(26.0, 30)
    assert r["level"] == "good"
    assert "大风" in r["note"]

    r = comfort_level(36.5, 40)
    assert r["level"] == "severe"
    assert "中暑" in r["note"] and "大风" in r["note"]


def test_migration_adds_columns():
    """_migrate must upgrade an existing forecast_snapshots table in place."""
    import sqlite3
    import tempfile

    from sqlalchemy import create_engine

    from app.db import _migrate

    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    conn = sqlite3.connect(path)
    conn.execute("""CREATE TABLE forecast_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        court_id VARCHAR(32), source VARCHAR(20), target_hour DATETIME,
        precip_prob INTEGER, precip_mm FLOAT, weather_code INTEGER,
        wind_kmh FLOAT, fetched_at DATETIME)""")
    conn.commit()
    conn.close()

    tmp_engine = create_engine(f"sqlite:///{path}")
    _migrate(tmp_engine)
    _migrate(tmp_engine)  # idempotent

    conn = sqlite3.connect(path)
    cols = {row[1] for row in conn.execute("PRAGMA table_info(forecast_snapshots)")}
    conn.close()
    tmp_engine.dispose()  # release the file handle before unlink (Windows)
    assert {"apparent_temp", "humidity"} <= cols
    os.unlink(path)
