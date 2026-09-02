import os
from datetime import datetime, timedelta

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite://")

from app.config import HK_TZ  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.models import CheckIn, Court, ForecastSnapshot, Observation  # noqa: E402
from app.api.checkins import CheckInIn, _session_weather, create_checkin  # noqa: E402

NOW = datetime.now(HK_TZ).replace(tzinfo=None)
DEV = "c1111111-2222-3333-4444-555555555555"


@pytest.fixture()
def db():
    Base.metadata.create_all(engine)
    session = SessionLocal()
    session.add(Court(id="c1", name_en="T", name_tc="T", name_sc="测试场",
                      district_en="D", district_tc="D", lat=22.3, lon=114.2, letter="T"))
    session.commit()
    yield session
    session.close()
    Base.metadata.drop_all(engine)


def _hour(base, i):
    return (base + timedelta(hours=i)).replace(minute=0, second=0, microsecond=0)


def test_session_dry_gamble_win(db):
    """Forecast said rain (>=50%), session stayed dry -> 赌赢."""
    start = _hour(NOW, -5)
    db.add(ForecastSnapshot(court_id="c1", source="open_meteo", target_hour=start,
                            precip_prob=65, fetched_at=start - timedelta(hours=1)))
    db.add(Observation(court_id="c1", observed_hour=start, station_name="S",
                       rainfall_mm=0.0, rain=False, fetched_at=start))
    db.add(Observation(court_id="c1", observed_hour=_hour(NOW, -4), station_name="S",
                       rainfall_mm=0.0, rain=False, fetched_at=start))
    db.commit()

    story = _session_weather(db, "c1", start, 2.0)
    assert story["tag"] == "win"
    assert story["rain_hours"] == 0
    assert story["forecast_pop"] == 65
    assert "赌赢" in story["verdict"]


def test_session_ambush(db):
    """Forecast said dry (<50%), rain arrived -> 漏网之鱼."""
    start = _hour(NOW, -5)
    db.add(ForecastSnapshot(court_id="c1", source="open_meteo", target_hour=start,
                            precip_prob=20, fetched_at=start - timedelta(hours=1)))
    db.add(Observation(court_id="c1", observed_hour=start, station_name="S",
                       rainfall_mm=0.0, rain=False, fetched_at=start))
    db.add(Observation(court_id="c1", observed_hour=_hour(NOW, -4), station_name="S",
                       rainfall_mm=2.5, rain=True, fetched_at=start))
    db.commit()

    story = _session_weather(db, "c1", start, 2.0)
    assert story["tag"] == "ambush"
    assert story["rain_hours"] == 1
    assert story["max_mm"] == 2.5
    assert "漏网之鱼" in story["verdict"]


def test_checkin_cooldown(db):
    body = CheckInIn(court_id="c1", duration_hours=2.0)
    create_checkin(body, DEV, db)
    db.flush()
    assert db.query(CheckIn).count() == 1
    with pytest.raises(Exception) as exc:
        create_checkin(body, DEV, db)
    assert exc.value.status_code == 429
