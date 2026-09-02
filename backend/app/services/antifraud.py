"""Anti-abuse checks for community reports: geofence, cooldown, caps, speed."""
import logging
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import hk_now, settings
from ..models import Court, UserReport
from .geo import distance_meters

logger = logging.getLogger(__name__)

REASON_GEOFENCE = "rejected_geofence"
REASON_ACCURACY = "rejected_accuracy"
REASON_COOLDOWN = "rejected_cooldown"
REASON_DAILY = "rejected_daily_limit"
REASON_SPEED = "rejected_speed"


def check_report(db: Session, court: Court, device_id: str,
                 lat: float, lon: float, accuracy_m: float | None,
                 now: datetime | None = None) -> str | None:
    """Return a rejection reason constant, or None when the report is allowed."""
    now = now or hk_now()

    if accuracy_m is not None and accuracy_m > settings.max_gps_accuracy_meters:
        return REASON_ACCURACY

    distance = distance_meters(lat, lon, court.lat, court.lon)
    if distance > settings.geofence_meters:
        return REASON_GEOFENCE

    last_accepted = db.execute(
        select(UserReport)
        .where(UserReport.device_id == device_id,
               UserReport.status == "accepted")
        .order_by(UserReport.created_at.desc())
    ).scalars().first()

    if last_accepted is not None:
        if (last_accepted.court_id == court.id
                and now - last_accepted.created_at < timedelta(hours=settings.cooldown_hours)):
            return REASON_COOLDOWN

        gap_hours = (now - last_accepted.created_at).total_seconds() / 3600.0
        if gap_hours > 0.01:  # avoid divide-by-zero on identical timestamps
            kmh = distance_meters(lat, lon, last_accepted.lat, last_accepted.lon) / 1000.0 / gap_hours
            if kmh > settings.max_speed_kmh:
                return REASON_SPEED

    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    daily_count = db.execute(
        select(func.count()).select_from(UserReport)
        .where(UserReport.device_id == device_id,
               UserReport.status == "accepted",
               UserReport.created_at >= day_start)
    ).scalar() or 0
    if daily_count >= settings.daily_report_limit:
        return REASON_DAILY

    return None


def cooldown_remaining(db: Session, court_id: str, device_id: str,
                       now: datetime | None = None) -> int:
    """Seconds left until this device may report at this court again (0 = free)."""
    now = now or hk_now()
    last = db.execute(
        select(UserReport.created_at)
        .where(UserReport.device_id == device_id,
               UserReport.court_id == court_id,
               UserReport.status == "accepted")
        .order_by(UserReport.created_at.desc())
    ).scalar()
    if last is None:
        return 0
    deadline = last + timedelta(hours=settings.cooldown_hours)
    return max(0, int((deadline - now).total_seconds()))
