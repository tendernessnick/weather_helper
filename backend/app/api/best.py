"""Where-to-play ranking: fresh forecasts, sorted by corrected rain risk."""
from datetime import datetime, timedelta
from statistics import median

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import floor_hour, hk_now
from ..db import get_db
from ..models import Court, ForecastSnapshot
from ..services import analytics
from ..services.freshness import (FORECAST_FRESH_SEC, hk_iso, hk_local,
                                 is_fresh, source_status)

router = APIRouter(tags=["best"])


def _city_median(ranked: list[dict]) -> float | None:
    """The midpoint for even samples, not the lower middle court."""
    return median(r["corrected_pop"] for r in ranked) if ranked else None


def _parse_hour(raw: str | None, now: datetime) -> datetime:
    first = floor_hour(now) + timedelta(hours=1)
    if raw is None:
        return first
    try:
        hour = hk_local(datetime.fromisoformat(raw))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="hour must be an ISO date-time in Hong Kong time") from None
    if hour != floor_hour(hour):
        raise HTTPException(status_code=422, detail="hour must be a whole hour")
    if not first <= hour < first + timedelta(hours=24):
        raise HTTPException(status_code=422, detail="hour must be within the next 24 whole hours (Hong Kong time)")
    return hour


@router.get("/best")
def best_hours(
    hour: str | None = Query(default=None, description="ISO whole hour, HK local or with an offset", max_length=40),
    db: Session = Depends(get_db),
):
    now = hk_now()
    base = _parse_hour(hour, now)
    first = floor_hour(now) + timedelta(hours=1)
    # One join for the entire profile, including metadata. This prevents
    # orphaned rows from skewing city statistics and uses the same population
    # and median definition in both the time chips and selected-hour ranking.
    rows = db.execute(
        select(Court, ForecastSnapshot)
        .join(ForecastSnapshot, ForecastSnapshot.court_id == Court.id)
        .where(ForecastSnapshot.target_hour >= first,
               ForecastSnapshot.target_hour < first + timedelta(hours=24))
    ).all()
    calib_f, _ = analytics.pooled_calibration(db)
    by_hour: dict[datetime, list[dict]] = {}
    selected_issues = []
    for court, snap in rows:
        if snap.target_hour == base:
            selected_issues.append(snap.fetched_at)
        # Stale low values must never win a "where should I play" ranking.
        if not is_fresh(snap.fetched_at, now, FORECAST_FRESH_SEC):
            continue
        corrected = calib_f(snap.precip_prob / 100.0)
        by_hour.setdefault(snap.target_hour, []).append({
            "court_id": court.id,
            "name_sc": court.name_sc, "name_tc": court.name_tc,
            "name_en": court.name_en, "district_tc": court.district_tc,
            "district_en": court.district_en, "lat": court.lat, "lon": court.lon,
            "pop": snap.precip_prob, "corrected_pop": round(corrected * 100),
            "zone": analytics.decision_zone(corrected),
            "fetched_at": hk_iso(snap.fetched_at),
        })
    ranked = sorted(by_hour.get(base, []), key=lambda r: (
        r["corrected_pop"], r["pop"], r["name_en"], r["court_id"]))
    # Age of the oldest included row; if every row was excluded, show the
    # newest stale issue so the UI can distinguish an outage from no history.
    included_issues = [datetime.fromisoformat(r["fetched_at"]) for r in ranked]
    issued = (min(included_issues) if included_issues else
              max(selected_issues, default=None))
    return {
        "hour": base.isoformat(),
        "timezone": "Asia/Hong_Kong",
        "generated_at": hk_iso(now),
        "data_status": source_status(issued, now, FORECAST_FRESH_SEC),
        "available_courts": len(ranked),
        "total_courts": db.query(Court).count(),
        "city_median_pop": _city_median(ranked),
        "courts": ranked,
        "hours": [
            {"hour": h.isoformat(), "city_median_pop": _city_median(by_hour[h]),
             "available_courts": len(by_hour[h])}
            for h in sorted(by_hour)
        ],
    }
