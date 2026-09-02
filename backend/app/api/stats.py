"""Statistics API endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Court
from ..services import analytics

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/overview")
def stats_overview(db: Session = Depends(get_db)):
    return analytics.overview(db)


@router.get("/lead-decay")
def stats_lead_decay(db: Session = Depends(get_db)):
    return analytics.lead_decay(db)


@router.get("/hourly-profile")
def stats_hourly_profile(db: Session = Depends(get_db)):
    return analytics.hourly_profile(db)


@router.get("/courts")
def stats_courts(db: Session = Depends(get_db)):
    return analytics.courts_ranking(db)
