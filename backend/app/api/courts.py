"""Court list/detail endpoints."""
import json
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import hk_now, settings
from ..db import get_db
from ..models import (Climatology, Court, ForecastSnapshot, NowcastSnapshot,
                      UserReport)
from ..services import analytics, comfort, fusion, hko_nowcast, verification
from ..services import lightning as lightning_svc
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


@router.get("/courts/{court_id}/reports/recent")
def recent_reports(court_id: str, db: Session = Depends(get_db)):
    """Crowd reports at this court within the last 3 hours (newest first)."""
    if db.get(Court, court_id) is None:
        raise HTTPException(status_code=404, detail="court not found")
    since = hk_now() - timedelta(hours=3)
    rows = db.query(UserReport).filter(
        UserReport.court_id == court_id,
        UserReport.status == "accepted",
        UserReport.created_at >= since,
    ).order_by(UserReport.created_at.desc()).all()
    return {
        "reports": [
            {
                "reported_at": r.created_at.isoformat(),
                "intensity": r.intensity,
                "was_raining": r.was_raining,
            }
            for r in rows
        ]
    }


@router.get("/courts/{court_id}/calibration")
def court_calibration(court_id: str, db: Session = Depends(get_db)):
    if db.get(Court, court_id) is None:
        raise HTTPException(status_code=404, detail="court not found")
    return analytics.court_calibration(db, court_id)


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

    # Statistics enrichments: corrected probability (pooled calibration),
    # climatological base rate per hour, decision zone, persistence card.
    calib_f, calib_n = analytics.pooled_calibration(db)
    clim_rows = db.execute(
        select(Climatology.month, Climatology.hour,
               Climatology.rain_count, Climatology.samples)
        .where(Climatology.court_id == court_id)
    ).all()
    clim = {(m, h): (r / s if s else None) for m, h, r, s in clim_rows}

    hourly_out = []
    for s in hourly:
        corrected = calib_f(s.precip_prob / 100.0)
        clim_p = clim.get((s.target_hour.month, s.target_hour.hour))
        hourly_out.append({
            "hour": s.target_hour.isoformat(),
            "pop": s.precip_prob,
            "corrected_pop": round(corrected * 100),
            "climatology_pop": round(clim_p * 100) if clim_p is not None else None,
            "zone": analytics.decision_zone(corrected),
            "mm": s.precip_mm,
            "weather_code": s.weather_code,
            "wind_kmh": s.wind_kmh,
            "apparent_temp": s.apparent_temp,
            "humidity": s.humidity,
            "comfort": comfort.comfort_level(s.apparent_temp, s.wind_kmh),
        })

    # Fused 0-6h curve: SWIRLS-weighted inside radar coverage, calibrated
    # Open-Meteo + climatology beyond it (see services/fusion.py).
    fused = fusion.fused_overlay(
        steps=nowcast[1] if nowcast else [], fetched_at=nowcast[0] if nowcast else None,
        hourly=hourly_out, now=now, threshold_mm=settings.nowcast_mm_threshold)
    for item, (fused_pop, used_swirls) in zip(hourly_out, fused):
        item["fused_pop"] = fused_pop
        item["fused_swirls"] = used_swirls

    # Past-hour lightning for the court's region; the feed is hourly, so a
    # cached row older than 2h is treated as no data rather than "no flashes".
    lightning_out = None
    light = lightning_svc.get_cached_lightning(db)
    if light:
        try:
            light_age = now - datetime.fromisoformat(light["fetched_at"])
        except (KeyError, TypeError, ValueError):
            light_age = None
        if light_age is not None and light_age <= timedelta(hours=2):
            region = lightning_svc.region_for_court(court.lat, court.lon)
            lightning_out = {
                "region": region,
                "cg_count": (light.get("regions") or {}).get(region, 0),
                "total_cg": light.get("total", 0),
                "cloud_count": light.get("cloud", 0),
                "period": light.get("period"),
                "fetched_at": light.get("fetched_at"),
            }

    return {
        "court_id": court_id,
        "nowcast": {
            "fetched_at": nowcast[0].isoformat() if nowcast else None,
            "steps": nowcast[1] if nowcast else [],
        },
        "hourly": hourly_out,
        "calibration": {"basis_n": calib_n},
        "persistence": analytics.persistence_card(db, court_id),
        "current": current,
        "warnings": warnings,
        "lightning": lightning_out,
        "sources": {
            "nowcast": "HKO SWIRLS gridded rainfall nowcast (0-2h, per 30 min)",
            "hourly": "Open-Meteo ensemble (hourly probability, up to 48h)",
            "fused": "SWIRLS-weighted blend with calibrated forecast + climatology (0-6h)",
            "lightning": "HKO cloud-to-ground flash counts, past hour by region",
        },
    }
