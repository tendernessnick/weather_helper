"""Push subscription management."""
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..config import hk_now, settings
from ..db import get_db
from ..models import Court, PushSubscription
from ..schemas import SubscriptionIn
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

    sub = PushSubscription(
        device_id=x_device_id.strip(),
        endpoint=body.subscription.endpoint,
        p256dh=body.subscription.keys.p256dh,
        auth=body.subscription.keys.auth,
        court_id=body.court_id,
        play_at=body.play_at,
        hours_before=body.hours_before,
        notified_at=None,
        created_at=hk_now(),
    )
    db.merge(sub)  # endpoint is the unique key: resubscribe updates in place
    db.commit()
    return {"status": "ok"}


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
