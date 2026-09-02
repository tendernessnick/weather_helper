"""HKO F3 gridded rainfall nowcast: CSV download, nearest-grid-point extraction.

The CSV covers a ~2km grid over Hong Kong and the Pearl River Estuary with four
30-minute accumulated-rainfall steps (up to +2h), refreshed every 12 minutes.
For each court we keep the value of the grid cell nearest to the court.
"""
import csv
import io
import json
import logging
from datetime import datetime

import httpx
from sqlalchemy.orm import Session

from ..config import hk_now, settings
from ..models import Court, NowcastSnapshot

logger = logging.getLogger(__name__)

# CSV column headers of the F3 product.
COL_UPDATED = "Updated Date and Time (in Hong Kong Time)"
COL_ENDING = "Ending Date and Time (in Hong Kong Time)"
COL_LAT = "Latitude (degree)"
COL_LON = "Longitude (degree)"
COL_MM = "Half-hourly Nowcast Accumulated Rainfall (mm)"


def parse_grid(text: str) -> dict[datetime, list[tuple[float, float, float]]]:
    """Group CSV rows by ending time -> [(lat, lon, mm), ...]."""
    reader = csv.DictReader(io.StringIO(text))
    grids: dict[datetime, list[tuple[float, float, float]]] = {}
    for row in reader:
        try:
            ending = datetime.strptime(row[COL_ENDING], "%Y%m%d%H%M")
            lat = float(row[COL_LAT])
            lon = float(row[COL_LON])
            mm = float(row[COL_MM])
        except (KeyError, TypeError, ValueError):
            continue
        grids.setdefault(ending, []).append((lat, lon, mm))
    return grids


def _nearest_mm(points: list[tuple[float, float, float]],
                lat: float, lon: float) -> float:
    """mm of the grid cell nearest to (lat, lon). Minimises squared distance."""
    best = points[0]
    best_d = (points[0][0] - lat) ** 2 + (points[0][1] - lon) ** 2
    for p in points[1:]:
        d = (p[0] - lat) ** 2 + (p[1] - lon) ** 2
        if d < best_d:
            best_d, best = d, p
    return best[2]


def ingest_nowcast(db: Session) -> int:
    """Download the F3 file and upsert one snapshot per court."""
    resp = httpx.get(settings.hko_nowcast_csv_url, timeout=60)
    resp.raise_for_status()
    grids = parse_grid(resp.text)
    if not grids:
        raise ValueError("F3 CSV contained no usable rows")

    courts = db.query(Court).all()
    fetched_at = hk_now()
    n = 0
    # fetched_at is fresh on every run, so (court_id, fetched_at) never
    # collides; plain inserts keep the full 12-minute history.
    for court in courts:
        steps = []
        for ending in sorted(grids):
            mm = _nearest_mm(grids[ending], court.lat, court.lon)
            steps.append({"ending": ending.isoformat(), "mm": mm})
        db.add(NowcastSnapshot(
            court_id=court.id,
            fetched_at=fetched_at,
            steps_json=json.dumps(steps),
        ))
        n += 1
    db.commit()
    logger.info("F3 nowcast ingested for %d courts, %d steps, fetched_at=%s",
                n, len(grids), fetched_at)
    return n


def latest_steps(db: Session, court_id: str) -> tuple[datetime, list[dict]] | None:
    """(fetched_at, steps) of the most recent nowcast snapshot for a court."""
    row = (db.query(NowcastSnapshot)
           .filter(NowcastSnapshot.court_id == court_id)
           .order_by(NowcastSnapshot.fetched_at.desc())
           .first())
    if row is None:
        return None
    return row.fetched_at, json.loads(row.steps_json)
