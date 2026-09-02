"""Rain map endpoints (self-drawn from the F3 grid we already ingest)."""
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import KvCache

router = APIRouter(prefix="/map", tags=["map"])


@router.get("/rain")
def rain_map(db: Session = Depends(get_db)):
    row = db.get(KvCache, "f3_grid")
    if row is None:
        raise HTTPException(status_code=503, detail="rain map not ingested yet")
    return json.loads(row.value_json)
