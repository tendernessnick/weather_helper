"""Check-ins ("I played here") and the personal retrospective report."""
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import floor_hour, hk_now
from ..db import get_db
from ..models import CheckIn, Court, ForecastSnapshot, Observation

router = APIRouter(prefix="/checkins", tags=["checkins"])

CHECKIN_COOLDOWN_HOURS = 6.0


class CheckInIn(BaseModel):
    court_id: str
    duration_hours: float = Field(default=1.0, ge=0.5, le=4.0)
    played_at: str | None = None  # ISO; default now (backfill "just played")


def _valid_device(x_device_id: str) -> str:
    device_id = x_device_id.strip()
    try:
        uuid.UUID(device_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="X-Device-ID must be a UUID")
    return device_id


@router.post("")
def create_checkin(
    body: CheckInIn,
    x_device_id: str = Header(min_length=8, max_length=64),
    db: Session = Depends(get_db),
):
    device_id = _valid_device(x_device_id)
    court = db.get(Court, body.court_id)
    if court is None:
        raise HTTPException(status_code=404, detail="court not found")

    played_at = hk_now()
    if body.played_at:
        from datetime import datetime
        played_at = datetime.fromisoformat(body.played_at)

    last = db.execute(
        select(CheckIn.created_at)
        .where(CheckIn.device_id == device_id,
               CheckIn.court_id == body.court_id)
        .order_by(CheckIn.created_at.desc())
    ).scalar()
    if last is not None and hk_now() - last < timedelta(hours=CHECKIN_COOLDOWN_HOURS):
        raise HTTPException(status_code=429, detail="同球场 6 小时内已打卡过")

    row = CheckIn(court_id=court.id, device_id=device_id,
                  played_at=played_at, duration_hours=body.duration_hours,
                  created_at=hk_now())
    db.add(row)
    db.commit()
    return {"status": "ok"}


def _session_weather(db: Session, court_id: str, start, duration_h: float) -> dict:
    """Weather story of one played session, from our own archive."""
    first_hour = floor_hour(start)
    hours = [first_hour + timedelta(hours=i)
             for i in range(int(duration_h + 0.999))]
    obs = {o.observed_hour: o for o in db.query(Observation).filter(
        Observation.court_id == court_id,
        Observation.observed_hour.in_(hours)).all()}

    rain_hours = [h for h in hours if obs.get(h) and obs[h].rain]
    max_mm = max((obs[h].rainfall_mm for h in hours if h in obs), default=0.0)

    # the forecast as it stood ~1h before the session started (frozen version)
    pop = db.execute(
        select(ForecastSnapshot.precip_prob).where(
            ForecastSnapshot.court_id == court_id,
            ForecastSnapshot.target_hour == first_hour)
    ).scalar()

    if not rain_hours:
        if pop is not None and pop >= 50:
            verdict, tag = "预报说会下，你赌赢了", "win"
        else:
            verdict, tag = "全程无雨", "clean"
    else:
        if pop is not None and pop < 50:
            verdict, tag = f"遇雨 {len(rain_hours)} 小时——预报漏网之鱼", "ambush"
        else:
            verdict, tag = f"遇雨 {len(rain_hours)} 小时，预报有言在先", "hit"
    return {"rain_hours": len(rain_hours), "max_mm": round(max_mm, 1),
            "forecast_pop": pop, "verdict": verdict, "tag": tag,
            "observed": len(obs)}


@router.get("/my")
def my_checkins(
    x_device_id: str = Header(min_length=8, max_length=64),
    db: Session = Depends(get_db),
):
    device_id = _valid_device(x_device_id)
    rows = db.query(CheckIn).filter(CheckIn.device_id == device_id) \
        .order_by(CheckIn.played_at.desc()).all()
    courts = {c.id: c for c in db.query(Court).all()}
    return {"checkins": [
        {
            "court_id": r.court_id,
            "court_name": courts[r.court_id].name_sc if r.court_id in courts else r.court_id,
            "court_name_tc": courts[r.court_id].name_tc if r.court_id in courts else "",
            "court_name_en": courts[r.court_id].name_en if r.court_id in courts else "",
            "played_at": r.played_at.isoformat(),
            "duration_hours": r.duration_hours,
        } for r in rows
    ]}


@router.get("/report")
def my_report(
    x_device_id: str = Header(min_length=8, max_length=64),
    db: Session = Depends(get_db),
):
    device_id = _valid_device(x_device_id)
    rows = db.query(CheckIn).filter(CheckIn.device_id == device_id) \
        .order_by(CheckIn.played_at.desc()).all()
    courts = {c.id: c for c in db.query(Court).all()}

    sessions = []
    for r in rows:
        story = _session_weather(db, r.court_id, r.played_at, r.duration_hours)
        court = courts.get(r.court_id)
        sessions.append({
            "played_at": r.played_at.isoformat(),
            "court_name": court.name_sc if court else r.court_id,
            "court_name_tc": court.name_tc if court else "",
            "court_name_en": court.name_en if court else "",
            "duration_hours": r.duration_hours,
            **story,
        })

    rain_sessions = sum(1 for s in sessions if s["rain_hours"] > 0)
    wins = sum(1 for s in sessions if s["tag"] == "win")
    return {
        "total": len(sessions),
        "rain_sessions": rain_sessions,
        "gamble_wins": wins,
        "sessions": sessions[:30],
    }


@router.get("/peek")
def peek(code: str, db: Session = Depends(get_db)):
    """Recovery-code validation: does this device id have any data?"""
    from sqlalchemy import func

    from ..models import UserReport

    code = code.strip().lower()
    try:
        uuid.UUID(code)
    except ValueError:
        return {"exists": False, "checkins": 0, "reports": 0}
    checkins = db.query(func.count()).select_from(CheckIn) \
        .where(CheckIn.device_id == code).scalar() or 0
    reports = db.query(func.count()).select_from(UserReport) \
        .where(UserReport.device_id == code).scalar() or 0
    return {"exists": (checkins + reports) > 0, "checkins": checkins, "reports": reports}
