"""Admin dashboard aggregate endpoint, gated by the ADMIN_TOKEN env var.

Everything the /admin page shows comes from one read-only GET, so the frontend
can poll a single URL. No writes, no mutations - this is a viewing tool.
"""
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import hk_now, settings
from ..db import get_db
from ..diagnostics import db_state
from ..models import CheckIn, Court, ForecastSnapshot, KvCache, NowcastSnapshot, \
    Observation, PushSubscription, UserReport
from ..scheduler import scheduler

router = APIRouter(tags=["admin"])

REJECTION_REASONS = (
    "rejected_accuracy", "rejected_geofence", "rejected_cooldown",
    "rejected_speed", "rejected_daily_limit", "rejected_bad_data",
)

_PROCESS_STARTED = hk_now()


def require_admin(x_admin_token: str = Header(default="")) -> None:
    if not settings.admin_token:
        raise HTTPException(
            status_code=503,
            detail="ADMIN_TOKEN is not configured on the server; set it in the "
                   "environment (backend/.env locally, Railway variables in "
                   "production) and restart.")
    if not secrets.compare_digest(x_admin_token.encode("utf-8"),
                                  settings.admin_token.encode("utf-8")):
        raise HTTPException(status_code=401, detail="invalid admin token")


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat(timespec="seconds") if dt else None


def _source(key: str, last_at: datetime | None, interval_sec: int,
            now: datetime) -> dict:
    age = round((now - last_at).total_seconds()) if last_at else None
    if age is None:
        state = "missing"
    elif age <= interval_sec * 1.5:
        state = "ok"
    elif age <= interval_sec * 3:
        state = "warn"
    else:
        state = "stale"
    return {"key": key, "last_data_at": _iso(last_at), "age_sec": age,
            "interval_sec": interval_sec, "status": state}


@router.get("/admin/overview", dependencies=[Depends(require_admin)])
def admin_overview(db: Session = Depends(get_db)):
    now = hk_now()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)

    current_kv = db.get(KvCache, "current_weather")
    sources = [
        _source("nowcast", db.query(func.max(NowcastSnapshot.fetched_at)).scalar(),
                12 * 60, now),
        _source("rainfall", db.query(func.max(Observation.fetched_at)).scalar(),
                15 * 60, now),
        _source("current", current_kv.updated_at if current_kv else None,
                15 * 60, now),
        _source("forecast", db.query(func.max(ForecastSnapshot.fetched_at)).scalar(),
                60 * 60, now),
    ]

    by_status = dict(db.query(UserReport.status, func.count())
                     .filter(UserReport.created_at >= day_start)
                     .group_by(UserReport.status).all())
    reports_today = {
        "total": sum(by_status.values()),
        "accepted": by_status.get("accepted", 0),
        "by_status": {**{r: 0 for r in REJECTION_REASONS},
                      **{k: v for k, v in by_status.items() if k != "accepted"}},
    }

    per_day = dict(db.query(func.date(UserReport.created_at), func.count())
                   .filter(UserReport.created_at >= now - timedelta(days=6),
                           UserReport.status == "accepted")
                   .group_by(func.date(UserReport.created_at)).all())
    trend = [{"date": (now - timedelta(days=i)).strftime("%Y-%m-%d"),
              "count": int(per_day.get((now - timedelta(days=i)).date(), 0))}
             for i in range(6, -1, -1)]

    rows = (db.query(UserReport, Court)
            .join(Court, UserReport.court_id == Court.id)
            .order_by(UserReport.created_at.desc(), UserReport.id.desc())
            .limit(50).all())
    recent_reports = [{
        "id": r.id,
        "court_id": r.court_id,
        "court_name_en": c.name_en,
        "court_name_tc": c.name_tc,
        "court_name_sc": c.name_sc,
        "district": c.district_tc,
        "intensity": r.intensity,
        "was_raining": r.was_raining,
        "status": r.status,
        "distance_m": r.distance_m,
        "accuracy_m": r.accuracy_m,
        "device_id": r.device_id,
        "created_at": _iso(r.created_at),
    } for r, c in rows]

    checkins = {
        "today": db.query(CheckIn).filter(CheckIn.created_at >= day_start).count(),
        "week": db.query(CheckIn).filter(CheckIn.created_at >= week_ago).count(),
        "total": db.query(CheckIn).count(),
    }

    subscriptions = {
        "web_push": db.query(PushSubscription)
            .filter(~PushSubscription.endpoint.like("poll:%")).count(),
        "polling": db.query(PushSubscription)
            .filter(PushSubscription.endpoint.like("poll:%")).count(),
    }

    devices = {d for (d,) in db.query(UserReport.device_id)
               .filter(UserReport.created_at >= week_ago).all()}
    devices.update(d for (d,) in db.query(CheckIn.device_id)
                   .filter(CheckIn.created_at >= week_ago).all())

    return {
        "server_now": _iso(now),
        "uptime_sec": round((now - _PROCESS_STARTED).total_seconds()),
        "sources": sources,
        "jobs": scheduler.status(),
        "reports_today": reports_today,
        "reports_trend_7d": trend,
        "recent_reports": recent_reports,
        "checkins": checkins,
        "subscriptions": subscriptions,
        "devices_7d": len(devices),
        "db": db_state(),
    }
