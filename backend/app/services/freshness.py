"""Shared freshness policy for decision-facing weather data.

Stored datetimes are naive Hong Kong local time. Freshness is intentionally
independent of rain risk: an old 0% forecast is unavailable evidence, not a
reason to recommend a dry session.
"""
from datetime import datetime

from ..config import HK_TZ

FORECAST_FRESH_SEC = 3 * 3600  # hourly ingestion, allow two missed cycles
NOWCAST_FRESH_SEC = 25 * 60  # SWIRLS updates every 12 minutes


def hk_local(value: datetime) -> datetime:
    """Normalize aware instants; naive values already represent Hong Kong."""
    if value.tzinfo is not None:
        return value.astimezone(HK_TZ).replace(tzinfo=None)
    return value


def hk_iso(value: datetime | None) -> str | None:
    return hk_local(value).replace(tzinfo=HK_TZ).isoformat() if value else None


def is_fresh(fetched_at: datetime | None, now: datetime, max_age_sec: int) -> bool:
    if fetched_at is None:
        return False
    age = (hk_local(now) - hk_local(fetched_at)).total_seconds()
    # Future data cannot be treated as live evidence (including clock errors).
    return 0 <= age <= max_age_sec


def source_status(fetched_at: datetime | None, now: datetime, max_age_sec: int,
                  *, available: bool = True) -> dict:
    age = ((hk_local(now) - hk_local(fetched_at)).total_seconds()
           if fetched_at is not None else None)
    status = ("missing" if fetched_at is None else
              "fresh" if available and is_fresh(fetched_at, now, max_age_sec)
              else "stale")
    return {
        "status": status,
        "fetched_at": hk_iso(fetched_at),
        "age_minutes": round(age / 60, 1) if age is not None else None,
        "max_age_minutes": max_age_sec // 60,
    }
