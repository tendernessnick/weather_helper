"""Web Push reminders: notify subscribers when rain risk rises before play time."""
import json
import logging
from datetime import datetime, timedelta

from pywebpush import WebPushException, webpush
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import floor_hour, hk_now, settings
from ..models import Court, ForecastSnapshot, NowcastSnapshot, PushSubscription

logger = logging.getLogger(__name__)


def push_enabled() -> bool:
    return bool(settings.vapid_private_key and settings.vapid_public_key)


def _send(subscription: PushSubscription, payload: dict) -> bool:
    """Send one push; returns False when the subscription is dead (410/404)."""
    try:
        webpush(
            subscription_info={
                "endpoint": subscription.endpoint,
                "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
            },
            data=json.dumps(payload),
            vapid_private_key=settings.vapid_private_key,
            vapid_public_key=settings.vapid_public_key,
            vapid_claims={"sub": settings.vapid_subject},
            ttl=3600,
        )
        return True
    except WebPushException as exc:
        status = exc.response.status_code if exc.response is not None else None
        if status in (404, 410):
            return False
        logger.warning("push failed (status=%s): %s", status, exc)
        return True  # transient error; keep the subscription


def rain_risk(db: Session, court_id: str, play_hour) -> tuple[bool, int | None]:
    """(risky, pop%) for the play hour: OM snapshot PoP or any F3 rain step."""
    snap = db.execute(
        select(ForecastSnapshot.precip_prob)
        .where(ForecastSnapshot.court_id == court_id,
               ForecastSnapshot.target_hour == play_hour)
    ).scalar()
    if snap is not None and snap >= settings.pop_rain_threshold:
        return True, snap

    latest = (db.query(NowcastSnapshot)
              .filter(NowcastSnapshot.court_id == court_id)
              .order_by(NowcastSnapshot.fetched_at.desc())
              .first())
    if latest is not None:
        steps = json.loads(latest.steps_json)
        for step in steps:
            if floor_hour(datetime.fromisoformat(step["ending"])) == play_hour \
                    and step["mm"] >= settings.nowcast_mm_threshold:
                return True, snap
    return False, snap


def check_and_notify(db: Session) -> int:
    """Fire due reminders. A subscription fires once, in a window ending at
    play_at - hours_before; rain risk is evaluated for the play hour."""
    if not push_enabled():
        return 0

    now = hk_now()
    # Polling-mode subscriptions ("poll:" endpoints) are delivered by the
    # frontend reminder poller, not by Web Push.
    due = db.execute(
        select(PushSubscription)
        .where(PushSubscription.notified_at.is_(None),
               ~PushSubscription.endpoint.like("poll:%"))
    ).scalars().all()

    sent = 0
    for sub in due:
        lead = sub.hours_before
        notify_from = sub.play_at - lead - timedelta(minutes=5)
        notify_until = sub.play_at - lead + timedelta(minutes=5)
        if not (notify_from <= now <= notify_until):
            continue

        court = db.get(Court, sub.court_id)
        if court is None:
            continue

        play_hour = floor_hour(sub.play_at)
        risky, pop = rain_risk(db, sub.court_id, play_hour)
        if not risky:
            if now >= notify_until:
                # reminder window fully passed without rain risk; don't retry
                sub.notified_at = now
                db.commit()
            continue

        payload = {
            "title": "球场下雨风险提醒",
            "body": (f"{court.name_sc}：{sub.play_at.strftime('%H:%M')} 前后降水概率约 "
                     f"{pop}%，出门前再看一眼临近预报"),
            "url": f"/courts/{court.id}",
        }
        if _send(sub, payload):
            sent += 1
        sub.notified_at = now
        db.commit()

    if sent:
        logger.info("sent %d rain-risk push notifications", sent)
    return sent
