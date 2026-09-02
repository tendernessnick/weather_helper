import os
from datetime import datetime, timedelta

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite://")  # in-memory for tests

from app.config import HK_TZ  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.models import Court, UserReport  # noqa: E402
from app.services.antifraud import REASON_COOLDOWN, REASON_DAILY, \
    REASON_GEOFENCE, REASON_SPEED, check_report, cooldown_remaining  # noqa: E402

COURT = Court(id="c1", name_en="Test Court", name_tc="測試", name_sc="测试",
              district_en="Wan Chai", district_tc="灣仔",
              lat=22.2800, lon=114.1900, letter="T")


def hk(dt: datetime) -> datetime:
    return dt.replace(tzinfo=None)


@pytest.fixture()
def db():
    Base.metadata.create_all(engine)
    session = SessionLocal()
    session.add(COURT)
    session.commit()
    yield session
    session.close()
    Base.metadata.drop_all(engine)


def _report(device, lat=22.2800, lon=114.1900, court_id="c1", at=None):
    return UserReport(
        court_id=court_id, device_id=device, was_raining=True, intensity="moderate",
        lat=lat, lon=lon, status="accepted",
        created_at=at or hk(datetime.now(HK_TZ)),
    )


def test_geofence_rejects_far_away(db):
    at = hk(datetime.now(HK_TZ))
    reason = check_report(db, COURT, "d-11111111-1111-1111-1111-111111111111",
                          22.35, 114.20, None, now=at)
    assert reason == REASON_GEOFENCE


def test_geofence_accepts_on_site(db):
    at = hk(datetime.now(HK_TZ))
    reason = check_report(db, COURT, "d-11111111-1111-1111-1111-111111111111",
                          22.2810, 114.1905, 30.0, now=at)
    assert reason is None


def test_accuracy_gate(db):
    at = hk(datetime.now(HK_TZ))
    reason = check_report(db, COURT, "d-11111111-1111-1111-1111-111111111111",
                          22.2800, 114.1900, 5000.0, now=at)
    assert reason == "rejected_accuracy"


def test_cooldown_blocks_same_court(db):
    at = hk(datetime.now(HK_TZ))
    db.add(_report("d-1", at=at - timedelta(minutes=30)))
    db.commit()
    reason = check_report(db, COURT, "d-1", 22.2800, 114.1900, None, now=at)
    assert reason == REASON_COOLDOWN
    assert cooldown_remaining(db, "c1", "d-1", now=at) > 0


def test_cooldown_expires(db):
    at = hk(datetime.now(HK_TZ))
    db.add(_report("d-1", at=at - timedelta(hours=3)))
    db.commit()
    reason = check_report(db, COURT, "d-1", 22.2800, 114.1900, None, now=at)
    assert reason is None
    assert cooldown_remaining(db, "c1", "d-1", now=at) == 0


def test_speed_check_rejects_teleport(db):
    at = hk(datetime.now(HK_TZ))
    # Last report 1 minute ago at a far-away "court".
    db.add(_report("d-1", lat=22.50, lon=114.10, court_id="c2",
                   at=at - timedelta(minutes=1)))
    db.commit()
    reason = check_report(db, COURT, "d-1", 22.2800, 114.1900, None, now=at)
    assert reason == REASON_SPEED


def test_daily_limit(db):
    at = hk(datetime.now(HK_TZ))
    # The cap is per device: 10 accepted reports earlier today from the same
    # device (different courts, near-identical spots so the speed check passes).
    for i in range(10):
        db.add(UserReport(
            court_id=f"c{i}", device_id="d-1", was_raining=False, intensity="none",
            lat=22.28 + i * 1e-5, lon=114.19, status="accepted",
            created_at=at - timedelta(minutes=60 + i),
        ))
    db.commit()
    reason = check_report(db, COURT, "d-1", 22.2800, 114.1900, None, now=at)
    assert reason == REASON_DAILY
