"""Where-to-play ranking: courts sorted by corrected rain risk per hour."""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import floor_hour, hk_now
from ..db import get_db
from ..models import Court, ForecastSnapshot
from ..services import analytics

router = APIRouter(tags=["best"])


def _rank_hour(db: Session, hour: datetime) -> list[dict]:
    calib_f, _ = analytics.pooled_calibration(db)
    courts = {c.id: c for c in db.query(Court).all()}
    rows = db.execute(
        select(ForecastSnapshot.court_id, ForecastSnapshot.precip_prob)
        .where(ForecastSnapshot.target_hour == hour)
    ).all()

    out = []
    for court_id, pop in rows:
        court = courts.get(court_id)
        if court is None:
            continue
        corrected = calib_f(pop / 100.0)
        out.append({
            "court_id": court_id,
            "name_sc": court.name_sc,
            "name_tc": court.name_tc,
            "name_en": court.name_en,
            "district_tc": court.district_tc,
            "district_en": court.district_en,
            "lat": court.lat,
            "lon": court.lon,
            "pop": pop,
            "corrected_pop": round(corrected * 100),
            "zone": analytics.decision_zone(corrected),
        })
    out.sort(key=lambda r: r["corrected_pop"])
    return out


def _city_median(ranked: list[dict]) -> int | None:
    pops = sorted(r["corrected_pop"] for r in ranked)
    if not pops:
        return None
    m = len(pops) // 2
    return pops[m - 1] if len(pops) % 2 == 0 else pops[m]


@router.get("/best")
def best_hours(
    hour: str | None = Query(default=None, description="YYYY-MM-DDTHH, HK local"),
    db: Session = Depends(get_db),
):
    base = floor_hour(hk_now()) + timedelta(hours=1)
    if hour:
        try:
            base = datetime.fromisoformat(hour)
        except ValueError:
            base = floor_hour(hk_now()) + timedelta(hours=1)

    ranked = _rank_hour(db, base)

    # next 24h city-median risk profile, for "better hour" suggestions
    hours = []
    for i in range(24):
        h = floor_hour(hk_now()) + timedelta(hours=i + 1)
        rows = db.execute(
            select(ForecastSnapshot.precip_prob)
            .where(ForecastSnapshot.target_hour == h)
        ).scalars().all()
        if rows:
            calib_f, _ = analytics.pooled_calibration(db)
            pops = sorted(calib_f(p / 100.0) * 100 for p in rows)
            m = len(pops) // 2
            hours.append({
                "hour": h.isoformat(),
                "city_median_pop": int(pops[m - 1] if len(pops) % 2 == 0 else pops[m]),
            })

    return {
        "hour": base.isoformat(),
        "city_median_pop": _city_median(ranked),
        "courts": ranked,
        "hours": hours,
    }
