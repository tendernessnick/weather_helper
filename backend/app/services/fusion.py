"""Blend SWIRLS nowcast, calibrated Open-Meteo and climatology into one number.

The radar nowcast is the best signal for 0-2h but stops there; the Open-Meteo
hourly probability covers 48h yet is weakest exactly where the radar ends.
The fused value leans on SWIRLS inside its coverage and on the calibrated
forecast elsewhere, with the 10-year climatological prior mixed in beyond
radar reach. Derived on read from already-stored snapshots - no new tables.
"""
from datetime import datetime, timedelta

# How far ahead the fused curve reaches; beyond this the plain corrected
# probability is shown as-is.
FUSE_HOURS = 6
# Inside radar coverage the nowcast dominates: it measures actual rain
# aloft rather than modelling it, but is still not a guarantee.
SWIRLS_WEIGHT = 0.7
# Beyond radar coverage, how much weight the climatological prior gets
# against the (already calibrated) Open-Meteo probability.
CLIM_WEIGHT = 0.3
# F3 is issued every 12 minutes; older than ~2 cycles the radar curve is
# stale and must not participate.
SWIRLS_FRESH_SEC = 25 * 60


def swirls_hour_probs(steps: list[dict], now: datetime,
                      threshold_mm: float) -> dict[datetime, float]:
    """SWIRLS rain probability per hour bucket, keyed by bucket start hour.

    Each 30-minute step accumulates rainfall up to its "ending" time, so the
    bucket (T, T+1h] is described by the steps ending inside it. A bucket's
    probability is the share of its steps at or above the rain threshold;
    buckets without any step are simply absent (no radar coverage there).
    """
    buckets: dict[datetime, list[bool]] = {}
    for s in steps:
        try:
            ending = datetime.fromisoformat(s["ending"])
        except (KeyError, TypeError, ValueError):
            continue
        if ending <= now:
            continue  # already fallen
        # A step ending exactly on the hour belongs to the bucket that just
        # closes, not the one starting there - hence the 1-second nudge.
        hour = (ending - timedelta(seconds=1)).replace(minute=0, second=0,
                                                       microsecond=0)
        buckets.setdefault(hour, []).append(
            float(s.get("mm") or 0.0) >= threshold_mm)
    return {h: 100.0 * sum(wet) / len(wet) for h, wet in buckets.items()}


def fuse(p_swirls: float | None, p_corrected: float,
         p_clim: float | None) -> float:
    """One fused probability from the sources available for an hour."""
    if p_swirls is not None:
        return SWIRLS_WEIGHT * p_swirls + (1 - SWIRLS_WEIGHT) * p_corrected
    if p_clim is not None:
        return (1 - CLIM_WEIGHT) * p_corrected + CLIM_WEIGHT * p_clim
    return p_corrected


def fused_overlay(steps: list[dict], fetched_at: datetime | None,
                  hourly: list[dict], now: datetime,
                  threshold_mm: float) -> list[tuple[int, bool]]:
    """(fused_pop, used_swirls) for the first FUSE_HOURS of `hourly`.

    Each hourly item must carry "hour" (naive datetime), "corrected_pop" and
    "climatology_pop" (or None). SWIRLS participates only while its snapshot
    is fresh and a step covers the hour.
    """
    fresh = (fetched_at is not None
             and (now - fetched_at).total_seconds() <= SWIRLS_FRESH_SEC)
    probs = swirls_hour_probs(steps, now, threshold_mm) if fresh else {}

    out: list[tuple[int, bool]] = []
    for item in hourly[:FUSE_HOURS]:
        # "hour" arrives as an ISO string from the API layer; accept both.
        hour = item["hour"]
        if not isinstance(hour, datetime):
            hour = datetime.fromisoformat(hour)
        p_sw = probs.get(hour)
        clim = item.get("climatology_pop")
        fused = fuse(p_sw,
                     float(item.get("corrected_pop", item.get("pop", 0)) or 0),
                     None if clim is None else float(clim))
        out.append((round(max(0, min(100, fused))), p_sw is not None))
    return out
