import os
from datetime import datetime, timedelta

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite://")

from app.config import HK_TZ  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.models import Court, ForecastSnapshot  # noqa: E402
from app.api.subscriptions import (check_reminders,  # noqa: E402
                                   create_polling_subscription)
from app.schemas import PollingSubscriptionIn  # noqa: E402

DEVICE = "d-11111111-1111-1111-1111-111111111111"


@pytest.fixture()
def db():
    Base.metadata.create_all(engine)
    session = SessionLocal()
    session.add(Court(id="c1", name_en="Test", name_tc="測試", name_sc="测试",
                      district_en="X", district_tc="X", lat=22.28, lon=114.19,
                      letter="T"))
    session.commit()
    yield session
    session.close()
    Base.metadata.drop_all(engine)


def _subscribe(db, minutes_ahead):
    play_at = datetime.now(HK_TZ).replace(tzinfo=None, second=0, microsecond=0) \
        + timedelta(minutes=minutes_ahead)
    body = PollingSubscriptionIn(court_id="c1", play_at=play_at, hours_before=0.5)
    return play_at.replace(minute=0), body


def test_polling_reminder_delivered_once_when_risky(db):
    play_hour, body = _subscribe(db, 30)  # window opens immediately
    db.add(ForecastSnapshot(court_id="c1", source="open_meteo", target_hour=play_hour,
                            precip_prob=65, fetched_at=datetime.now(HK_TZ)))
    db.commit()

    create_polling_subscription(body, DEVICE, db)

    first = check_reminders(DEVICE, db)["reminders"]
    assert len(first) == 1
    assert first[0]["risky"] is True
    assert first[0]["pop"] == 65
    assert first[0]["court_id"] == "c1"

    # Delivered exactly once: marked as notified on delivery.
    assert check_reminders(DEVICE, db)["reminders"] == []


def test_no_risk_reminder_still_delivers_once(db):
    play_hour, body = _subscribe(db, 30)
    db.add(ForecastSnapshot(court_id="c1", source="open_meteo", target_hour=play_hour,
                            precip_prob=15, fetched_at=datetime.now(HK_TZ)))
    db.commit()
    create_polling_subscription(body, DEVICE, db)

    first = check_reminders(DEVICE, db)["reminders"]
    assert len(first) == 1
    assert first[0]["risky"] is False
    assert check_reminders(DEVICE, db)["reminders"] == []


def test_reminder_not_due_before_window(db):
    _hours_ahead = 5
    play_at = datetime.now(HK_TZ).replace(tzinfo=None, second=0, microsecond=0) \
        + timedelta(hours=_hours_ahead)
    body = PollingSubscriptionIn(court_id="c1", play_at=play_at, hours_before=0.5)
    create_polling_subscription(body, DEVICE, db)

    # Window opens at play_at - 30min, which is hours away.
    assert check_reminders(DEVICE, db)["reminders"] == []


def test_other_devices_reminders_are_invisible(db):
    play_hour, body = _subscribe(db, 30)
    create_polling_subscription(body, DEVICE, db)
    assert check_reminders("d-99999999-9999-9999-9999-999999999999", db)["reminders"] == []
