"""User feedback endpoint: an inbox for suggestions, bugs and data fixes.

No GPS or geofence here - feedback is text, so the only abuse surface is
spam: a per-device cooldown plus a daily cap, mirroring the report rules.
Rejected submissions are not stored; the admin inbox stays readable.
"""
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..config import hk_now, settings
from ..db import get_db
from ..models import Court, Feedback
from ..schemas import FeedbackIn

router = APIRouter(tags=["feedback"])


def _cooldown_remaining_sec(db: Session, device_id: str) -> int:
    latest = (db.query(Feedback)
              .filter(Feedback.device_id == device_id)
              .order_by(Feedback.created_at.desc(), Feedback.id.desc())
              .first())
    if latest is None:
        return 0
    elapsed = (hk_now() - latest.created_at).total_seconds()
    return max(0, int(settings.feedback_cooldown_minutes * 60 - elapsed))


def _daily_count(db: Session, device_id: str) -> int:
    now = hk_now()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return (db.query(Feedback)
            .filter(Feedback.device_id == device_id,
                    Feedback.created_at >= day_start)
            .count())


@router.post("/feedback")
def submit_feedback(
    feedback: FeedbackIn,
    x_device_id: str = Header(min_length=8, max_length=64),
    db: Session = Depends(get_db),
):
    device_id = x_device_id.strip()
    try:
        uuid.UUID(device_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="X-Device-ID must be a UUID")

    if feedback.court_id is not None and db.get(Court, feedback.court_id) is None:
        raise HTTPException(status_code=404, detail="court not found")

    message = feedback.message.strip()
    if len(message) < 10:
        raise HTTPException(status_code=422, detail={
            "reason": "too_short",
            "message": "Feedback must be at least 10 characters.",
        })

    cooldown = _cooldown_remaining_sec(db, device_id)
    if cooldown > 0:
        raise HTTPException(status_code=429, detail={
            "reason": "cooldown",
            "cooldown_remaining_sec": cooldown,
            "message": "You just sent feedback - try again in a few minutes.",
        })
    if _daily_count(db, device_id) >= settings.feedback_daily_limit:
        raise HTTPException(status_code=429, detail={
            "reason": "daily_limit",
            "message": "Daily feedback limit reached.",
        })

    db.add(Feedback(
        device_id=device_id,
        court_id=feedback.court_id,
        category=feedback.category,
        message=message,
        page=(feedback.page or "")[:200],
        status="new",
        created_at=hk_now(),
    ))
    db.commit()
    return {"status": "ok"}


@router.get("/feedback/status")
def feedback_status(
    x_device_id: str = Header(min_length=8, max_length=64),
    db: Session = Depends(get_db),
):
    return {
        "cooldown_remaining_sec": _cooldown_remaining_sec(db, x_device_id.strip()),
        "feedback_today": _daily_count(db, x_device_id.strip()),
        "daily_limit": settings.feedback_daily_limit,
    }
