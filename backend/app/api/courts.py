"""Court list/detail endpoints."""
import json
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import hk_now, settings
from ..db import get_db
from ..models import Court, ForecastSnapshot, NowcastSnapshot
from ..services import hko_nowcast, verification
from ..services.hko import get_cached_current_weather

router = APIRouter(tags=["courts"])


def court_to_dict(court: Court) -> dict:
    return {
        "id": court.id,
        "name_en": court.name_en,
        "name_tc": court.name_tc,
        "name_sc": court.name_sc,
        "district_en": court.district_en,
        "district_tc": court.district_tc,
        "address_en": court.address_en,
        "address_tc": court.address_tc,
        "court_no": court.court_no,
        "opening_hours": court.opening_hours,
        "phone": court.phone,
        "lat": court.lat,
        "lon": court.lon,
        "letter": court.letter,
    }


def _nowcast_badges(db: Session) -> dict[str, dict]:
    """Next-2h rain summary per court from the freshest F3 snapshot."""
    latest_fetch = (db.query(NowcastSnapshot.fetched_at)
                    .order_by(NowcastSnapshot.fetched_at.desc())
                    .first())
    badges: dict[str, dict] = {}
    if latest_fetch is None:
        return badges
    since = latest_fetch[0]
    now = hk_now()
    rows = db.execute(
        select(NowcastSnapshot)
        .where(NowcastSnapshot.fetched_at >= since)
    ).scalars().all()
    for snap in rows:
        steps = json.loads(snap.steps_json)
        future = [
            s for s in steps
            if now <= datetime.fromisoformat(s["ending"]) <= now + timedelta(hours=2)
        ]
        if not future:
            continue
        max_mm = max(s["mm"] for s in future)
        badges[snap.court_id] = {
            "fetched_at": snap.fetched_at.isoformat(),
            "max_mm": max_mm,
            "rain": max_mm >= settings.nowcast_mm_threshold,
        }
    return badges


@router.get("/courts")
def list_courts(
    search: str = Query(default="", max_length=50),
    prefix: str = Query(default="", pattern="^[A-Za-z#]?$"),
    db: Session = Depends(get_db),
):
    query = db.query(Court)
    if prefix:
        query = query.filter(Court.letter == prefix.upper())
    if search:
        term = search.strip()
        needle = f"%{term.lower()}%"
        query = query.filter(
            func.lower(Court.name_en).like(needle)
            | Court.name_tc.like(f"%{term}%")
            | Court.name_sc.like(f"%{term}%")
            | func.lower(Court.district_en).like(needle)
            | Court.district_tc.like(f"%{term}%")
        )
    courts = query.order_by(Court.name_en).all()

    badges = _nowcast_badges(db)
    summaries = verification.all_court_summaries(db)

    return {
        "total": len(courts),
        "courts": [
            {
                **court_to_dict(c),
                "nowcast": badges.get(c.id),
                "score": summaries.get(c.id),
            }
            for c in courts
        ],
    }


@router.get("/courts/{court_id}")
def court_detail(court_id: str, db: Session = Depends(get_db)):
    court = db.get(Court, court_id)
    if court is None:
        raise HTTPException(status_code=404, detail="court not found")
    return {**court_to_dict(court), "scores": verification.compute_court_scores(db, court_id)}


@router.get("/courts/{court_id}/scores")
def court_scores(court_id: str, window_days: int | None = Query(default=None, ge=1, le=365),
                 db: Session = Depends(get_db)):
    if db.get(Court, court_id) is None:
        raise HTTPException(status_code=404, detail="court not found")
    return verification.compute_court_scores(db, court_id, window_days)


@router.get("/courts/{court_id}/weather")
def court_weather(court_id: str, db: Session = Depends(get_db)):
    court = db.get(Court, court_id)
    if court is None:
        raise HTTPException(status_code=404, detail="court not found")

    now = hk_now()
    nowcast = hko_nowcast.latest_steps(db, court_id)
    hourly = db.execute(
        select(ForecastSnapshot)
        .where(ForecastSnapshot.court_id == court_id,
               ForecastSnapshot.target_hour >= now.replace(minute=0, second=0, microsecond=0))
        .order_by(ForecastSnapshot.target_hour)
        .limit(48)
    ).scalars().all()

    current = get_cached_current_weather(db)
    warnings = (current or {}).get("warningMessage") or []

    return {
        "court_id": court_id,
        "nowcast": {
            "fetched_at": nowcast[0].isoformat() if nowcast else None,
            "steps": nowcast[1] if nowcast else [],
        },
        "hourly": [
            {
                "hour": s.target_hour.isoformat(),
                "pop": s.precip_prob,
                "mm": s.precip_mm,
                "weather_code": s.weather_code,
                "wind_kmh": s.wind_kmh,
            }
            for s in hourly
        ],
        "current": current,
        "warnings": warnings,
        "sources": {
            "nowcast": "HKO SWIRLS gridded rainfall nowcast (0-2h, per 30 min)",
            "hourly": "Open-Meteo ensemble (hourly probability, up to 48h)",
        },
    }
