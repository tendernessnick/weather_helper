import os
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

os.environ.setdefault("DATABASE_URL", "sqlite://")  # in-memory for tests
os.environ.setdefault("ADMIN_TOKEN", "test-token")

from app.config import HK_TZ, settings  # noqa: E402
from app.api.admin import require_admin, update_feedback  # noqa: E402
from app.api.feedback import feedback_status, submit_feedback  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.models import Court, Feedback  # noqa: E402
from app.schemas import FeedbackIn, FeedbackUpdateIn  # noqa: E402

DEVICE = "11111111-1111-1111-1111-111111111111"
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


def _submit(db, message="这个建议希望能支持深色模式", category="suggestion",
            device=DEVICE, court_id=None):
    return submit_feedback(
        FeedbackIn(category=category, message=message, court_id=court_id),
        x_device_id=device, db=db)


def test_submit_and_status(db):
    assert _submit(db) == {"status": "ok"}
    status = feedback_status(x_device_id=DEVICE, db=db)
    assert status["feedback_today"] == 1
    assert status["daily_limit"] == settings.feedback_daily_limit
    assert status["cooldown_remaining_sec"] > 0


def test_message_is_stripped_and_page_capped(db):
    _submit(db, message="    " + "x" * 20 + "   ")
    row = db.query(Feedback).one()
    assert row.message == "x" * 20
    assert row.status == "new"


def test_too_short_after_strip(db):
    # 10 raw characters but only 8 once stripped: pydantic passes, the
    # endpoint's stripped-length check must still catch it.
    with pytest.raises(HTTPException) as e:
        _submit(db, message="aaaaaaaa  ")
    assert e.value.status_code == 422
    assert db.query(Feedback).count() == 0


def test_cooldown_blocks_second(db):
    _submit(db)
    with pytest.raises(HTTPException) as e:
        _submit(db)
    assert e.value.status_code == 429
    assert e.value.detail["reason"] == "cooldown"
    assert db.query(Feedback).count() == 1  # rejected spam is not stored


def test_daily_limit(db, monkeypatch):
    monkeypatch.setattr(settings, "feedback_daily_limit", 2)
    for _ in range(2):
        _submit(db)
        # Backdate past the cooldown so the daily cap is what trips.
        db.query(Feedback).update(
            {"created_at": hk(datetime.now(HK_TZ)) - timedelta(hours=1)})
        db.commit()
    with pytest.raises(HTTPException) as e:
        _submit(db)
    assert e.value.status_code == 429
    assert e.value.detail["reason"] == "daily_limit"


def test_unknown_court_rejected(db):
    with pytest.raises(HTTPException) as e:
        _submit(db, court_id="nope")
    assert e.value.status_code == 404


def test_device_must_be_uuid(db):
    with pytest.raises(HTTPException) as e:
        submit_feedback(FeedbackIn(category="bug", message="x" * 20),
                        x_device_id="not-a-uuid", db=db)
    assert e.value.status_code == 400


def test_schema_validation():
    with pytest.raises(ValidationError):
        FeedbackIn(category="spam", message="x" * 20)
    with pytest.raises(ValidationError):
        FeedbackIn(category="bug", message="short")


def test_require_admin(monkeypatch):
    monkeypatch.setattr(settings, "admin_token", "tok")
    assert require_admin(x_admin_token="tok") is None
    with pytest.raises(HTTPException) as e:
        require_admin(x_admin_token="wrong")
    assert e.value.status_code == 401
    monkeypatch.setattr(settings, "admin_token", "")
    with pytest.raises(HTTPException) as e:
        require_admin(x_admin_token="tok")
    assert e.value.status_code == 503


def test_patch_status_flow(db):
    _submit(db)
    row = db.query(Feedback).one()
    out = update_feedback(row.id, FeedbackUpdateIn(status="ack"), db=db)
    assert out["status"] == "ack"
    out = update_feedback(row.id,
                          FeedbackUpdateIn(status="resolved", admin_note="done"),
                          db=db)
    assert out["status"] == "resolved"
    assert out["admin_note"] == "done"
    with pytest.raises(HTTPException) as e:
        update_feedback(999, FeedbackUpdateIn(status="ack"), db=db)
    assert e.value.status_code == 404
    with pytest.raises(ValidationError):
        FeedbackUpdateIn(status="deleted")
