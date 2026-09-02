"""Push subscription management and the polling-mode reminder fallback.

Web Push needs the browser to reach its vendor push service (Google FCM for
Chrome, Mozilla autopush for Firefox); on networks where those are blocked,
subscription fails client-side. In that case the frontend registers a polling
reminder instead: endpoint "poll:<uuid>" rows are delivered by
GET /api/reminders/check when the page polls, never by Web Push.
"""
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import floor_hour, hk_now, settings
from ..db import get_db
from ..models import Court, PushSubscription
from ..schemas import PollingSubscriptionIn, SubscriptionIn
from ..services import push

router = APIRouter(tags=["subscriptions"])


@router.get("/push/public-key")
def push_public_key():
    return {"enabled": push.push_enabled(), "public_key": settings.vapid_public_key or None}


@router.post("/subscriptions")
def create_subscription(
    body: SubscriptionIn,
    x_device_id: str = Header(min_length=8, max_length=64),
    db: Session = Depends(get_db),
):
    if not push.push_enabled():
        raise HTTPException(status_code=503, detail="push notifications not configured")
    if db.get(Court, body.court_id) is None:
        raise HTTPException(status_code=404, detail="court not found")
    if body.play_at <= hk_now():
        raise HTTPException(status_code=400, detail="play_at must be in the future")

    sub = db.query(PushSubscription).filter(
        PushSubscription.endpoint == body.subscription.endpoint).first()
    if sub is None:
        sub = PushSubscription(endpoint=body.subscription.endpoint)
        db.add(sub)
    sub.device_id = x_device_id.strip()
    sub.p256dh = body.subscription.keys.p256dh
    sub.auth = body.subscription.keys.auth
    sub.court_id = body.court_id
    sub.play_at = body.play_at
    sub.hours_before = body.hours_before
    sub.notified_at = None
    sub.created_at = hk_now()
    db.commit()
    return {"status": "ok", "mode": "push"}


@router.post("/subscriptions/polling")
def create_polling_subscription(
    body: PollingSubscriptionIn,
    x_device_id: str = Header(min_length=8, max_length=64),
    db: Session = Depends(get_db),
):
    if db.get(Court, body.court_id) is None:
        raise HTTPException(status_code=404, detail="court not found")
    if body.play_at <= hk_now():
        raise HTTPException(status_code=400, detail="play_at must be in the future")

    sub = PushSubscription(
        device_id=x_device_id.strip(),
        endpoint=f"poll:{uuid.uuid4()}",
        p256dh="", auth="",
        court_id=body.court_id,
        play_at=body.play_at,
        hours_before=body.hours_before,
        notified_at=None,
        created_at=hk_now(),
    )
    db.add(sub)
    db.commit()
    return {"status": "ok", "mode": "polling"}


@router.get("/reminders/check")
def check_reminders(
    x_device_id: str = Header(min_length=8, max_length=64),
    db: Session = Depends(get_db),
):
    """Deliver due polling reminders once: window is [play_at - hours_before,
    play_at + 10min]. Rain risk follows the same rule as push (PoP >= threshold
    or F3 rain); a no-risk delivery tells the user the session looks dry."""
    now = hk_now()
    subs = db.execute(
        select(PushSubscription)
        .where(PushSubscription.device_id == x_device_id.strip(),
               PushSubscription.notified_at.is_(None),
               PushSubscription.endpoint.like("poll:%"))
    ).scalars().all()

    reminders = []
    for sub in subs:
        window_open = sub.play_at - timedelta(hours=sub.hours_before) - timedelta(minutes=1)
        grace_end = sub.play_at + timedelta(minutes=10)
        if not (window_open <= now <= grace_end):
            continue
        court = db.get(Court, sub.court_id)
        if court is None:
            continue
        risky, pop = push.rain_risk(db, sub.court_id, floor_hour(sub.play_at))
        sub.notified_at = now
        reminders.append({
            "court_id": court.id,
            "court_name": court.name_sc,
            "play_hhmm": sub.play_at.strftime("%H:%M"),
            "risky": risky,
            "pop": pop,
        })
    if reminders:
        db.commit()
    return {"reminders": reminders}


@router.delete("/subscriptions")
def delete_subscription(
    endpoint: str,
    db: Session = Depends(get_db),
):
    sub = db.query(PushSubscription).filter(
        PushSubscription.endpoint == endpoint).first()
    if sub is None:
        raise HTTPException(status_code=404, detail="subscription not found")
    db.delete(sub)
    db.commit()
    return {"status": "deleted"}
