"""Visit logging for acquisition-source tracking (partner-app referrals).

One row per page load, tagged with the campaign source when the URL carries
one (?from= or ?utm_source=). Deliberately permissive: no cooldowns, unknown
values fall back to "direct" - the client fires this fire-and-forget and any
failure must stay invisible to users. Volume is bounded by one row per page
load and the 180-day purge.
"""
import re
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..config import hk_now
from ..db import get_db
from ..models import VisitLog
from ..schemas import VisitIn

router = APIRouter(tags=["visits"])

_SOURCE_RE = re.compile(r"[^a-z0-9_-]")


def _clean_source(raw: str | None) -> str:
    source = _SOURCE_RE.sub("", (raw or "").strip().lower())[:40]
    return source or "direct"


def _clean_path(raw: str | None) -> str:
    path = (raw or "").strip()
    if not path.startswith("/"):
        return "/"
    return path[:200]


@router.post("/visits")
def record_visit(
    visit: VisitIn,
    x_device_id: str = Header(min_length=8, max_length=64),
    db: Session = Depends(get_db),
):
    device_id = x_device_id.strip()
    try:
        uuid.UUID(device_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="X-Device-ID must be a UUID")

    db.add(VisitLog(
        device_id=device_id,
        source=_clean_source(visit.source),
        path=_clean_path(visit.path),
        created_at=hk_now(),
    ))
    db.commit()
    return {"status": "ok"}
