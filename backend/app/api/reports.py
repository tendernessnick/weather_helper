"""Community rain report endpoint with anti-abuse enforcement."""
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from ..config import hk_now, settings
from ..db import get_db
from ..models import Court, UserReport
from ..schemas import ReportIn, ReportOut
from ..services.antifraud import check_report, cooldown_remaining
from ..services.geo import distance_meters

router = APIRouter(tags=["reports"])


@router.post("/reports", response_model=ReportOut)
def submit_report(
    report: ReportIn,
    x_device_id: str = Header(min_length=8, max_length=64),
    db: Session = Depends(get_db),
):
    court = db.get(Court, report.court_id)
    if court is None:
        raise HTTPException(status_code=404, detail="court not found")

    device_id = x_device_id.strip()
    try:
        uuid.UUID(device_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="X-Device-ID must be a UUID")

    reason = check_report(db, court, device_id,
                          report.lat, report.lon, report.accuracy_m)
    was_raining = report.intensity != "none"
    distance = distance_meters(report.lat, report.lon, court.lat, court.lon)

    row = UserReport(
        court_id=court.id,
        device_id=device_id,
        was_raining=was_raining,
        intensity=report.intensity,
        lat=report.lat,
        lon=report.lon,
        accuracy_m=report.accuracy_m,
        distance_m=round(distance, 1),
        status=reason or "accepted",
        created_at=hk_now(),
    )
    db.add(row)
    db.commit()

    if reason:
        status_code = 403 if reason in ("rejected_geofence", "rejected_accuracy") else 429
        raise HTTPException(
            status_code=status_code,
            detail={
                "reason": reason,
                "message": {
                    "rejected_geofence": "You must be within "
                        f"{int(settings.geofence_meters)}m of the court to report.",
                    "rejected_accuracy": "GPS accuracy too low - try again outdoors.",
                    "rejected_cooldown": "You already reported at this court recently.",
                    "rejected_daily_limit": "Daily report limit reached.",
                    "rejected_speed": "Location change implausible; report dropped.",
                }[reason],
            },
        )

    return ReportOut(status="accepted",
                     cooldown_remaining_sec=cooldown_remaining(db, court.id, device_id))


@router.get("/reports/latest")
def latest_reports(limit: int = Query(default=5, ge=1, le=20),
                   db: Session = Depends(get_db)):
    """Community pulse for the landing page: latest accepted reports across all
    courts (last 6 hours). No device ids, no coordinates - same exposure level
    as the per-court recent endpoint."""
    since = hk_now() - timedelta(hours=6)
    rows = (db.query(UserReport, Court)
            .join(Court, UserReport.court_id == Court.id)
            .filter(UserReport.status == "accepted",
                    UserReport.created_at >= since)
            .order_by(UserReport.created_at.desc(), UserReport.id.desc())
            .limit(limit).all())
    return {"reports": [{
        "court_id": r.court_id,
        "court_name_sc": c.name_sc,
        "court_name_tc": c.name_tc,
        "court_name_en": c.name_en,
        "intensity": r.intensity,
        "was_raining": r.was_raining,
        "created_at": r.created_at.isoformat(timespec="seconds"),
    } for r, c in rows]}


@router.get("/reports/status")
def report_status(
    court_id: str = Query(),
    x_device_id: str = Header(min_length=8, max_length=64),
    db: Session = Depends(get_db),
):
    if db.get(Court, court_id) is None:
        raise HTTPException(status_code=404, detail="court not found")
    now = hk_now()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today = (db.query(UserReport)
             .filter(UserReport.device_id == x_device_id,
                     UserReport.status == "accepted",
                     UserReport.created_at >= day_start)
             .count())
    return {
        "cooldown_remaining_sec": cooldown_remaining(db, court_id, x_device_id),
        "reports_today": today,
        "daily_limit": settings.daily_report_limit,
    }
