"""Web Push reminders: notify subscribers when rain risk rises before play time."""
import json
import logging
from datetime import datetime, timedelta

from pywebpush import WebPushException, webpush
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import floor_hour, hk_now, settings
from ..models import Court, ForecastSnapshot, NowcastSnapshot, PushSubscription
from .freshness import FORECAST_FRESH_SEC, NOWCAST_FRESH_SEC, is_fresh

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


def rain_risk(db: Session, court_id: str, play_hour) -> tuple[bool | None, int | None]:
    """(risky, pop%) from fresh evidence; None means unable to judge.

    Missing or stale forecasts must not be delivered as a reassuring dry
    reminder. A fresh wet radar step can still warn when OM is unavailable.
    """
    now = hk_now()
    snap = db.execute(
        select(ForecastSnapshot)
        .where(ForecastSnapshot.court_id == court_id,
               ForecastSnapshot.target_hour == play_hour)
    ).scalar_one_or_none()
    pop = (snap.precip_prob if snap is not None
           and is_fresh(snap.fetched_at, now, FORECAST_FRESH_SEC) else None)
    if pop is not None and pop >= settings.pop_rain_threshold:
        return True, pop

    latest = (db.query(NowcastSnapshot)
              .filter(NowcastSnapshot.court_id == court_id)
              .order_by(NowcastSnapshot.fetched_at.desc())
              .first())
    if latest is not None and is_fresh(latest.fetched_at, now, NOWCAST_FRESH_SEC):
        steps = json.loads(latest.steps_json)
        for step in steps:
            ending = datetime.fromisoformat(step["ending"])
            # Accumulation ending exactly at T closes the preceding hour.
            bucket = floor_hour(ending - timedelta(seconds=1))
            if ending > now and bucket == play_hour \
                    and step["mm"] >= settings.nowcast_mm_threshold:
                return True, pop
    return (False, pop) if pop is not None else (None, None)


def _reminder_payload(court: Court, sub: PushSubscription,
                      risky: bool | None, pop: int | None) -> dict:
    time = sub.play_at.strftime('%H:%M')
    if risky is None:
        titles = ["球场天气待确认", "球場天氣待確認", "Court weather unavailable"]
        bodies = [
            f"{court.name_sc}：香港时间 {time} 的预报缺失或已过期，暂时无法判断，请出门前刷新确认",
            f"{court.name_tc}：香港時間 {time} 的預報缺失或已過期，暫時無法判斷，請出門前重新整理確認",
            f"{court.name_en}: forecast missing or out of date for {time} HKT. Refresh before leaving; rain risk is unknown.",
        ]
    else:
        titles = ["球场下雨风险提醒", "球場下雨風險提醒", "Court rain-risk reminder"]
        evidence = ([f"官方降水概率约 {pop}%", f"官方降水概率約 {pop}%", f"official rain chance ~{pop}%"]
                    if pop is not None else ["雷达临近预报有雨", "雷達臨近預報有雨", "radar nowcast indicates rain"])
        bodies = [
            f"{court.name_sc}：香港时间 {time} 前后{evidence[0]}，出门前再看一眼临近预报",
            f"{court.name_tc}：香港時間 {time} 前後{evidence[1]}，出門前再看一眼臨近預報",
            f"{court.name_en}: {evidence[2]} around {time} HKT. Check the nowcast before leaving.",
        ]
    variants = {lang: {"title": title, "body": body}
                for lang, title, body in zip(("hans", "hant", "en"), titles, bodies)}
    return {**variants["hans"], "url": f"/courts/{court.id}", "variants": variants}


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
        # hours_before is a float column; datetime arithmetic needs a timedelta.
        lead = timedelta(hours=sub.hours_before)
        notify_from = sub.play_at - lead - timedelta(minutes=5)
        notify_until = sub.play_at - lead + timedelta(minutes=5)
        if not (notify_from <= now <= notify_until):
            continue

        court = db.get(Court, sub.court_id)
        if court is None:
            continue

        play_hour = floor_hour(sub.play_at)
        risky, pop = rain_risk(db, sub.court_id, play_hour)
        if risky is False:
            if now >= notify_until:
                # reminder window fully passed without rain risk; don't retry
                sub.notified_at = now
                db.commit()
            continue

        payload = _reminder_payload(court, sub, risky, pop)
        if _send(sub, payload):
            sent += 1
        sub.notified_at = now
        db.commit()

    if sent:
        logger.info("sent %d rain-risk push notifications", sent)
    return sent
