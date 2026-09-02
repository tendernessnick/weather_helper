"""HKO open-data clients: current weather cache and station rainfall observations."""
import json
import logging
from datetime import datetime

import httpx
from sqlalchemy.orm import Session

from ..config import floor_hour, hk_now, settings
from ..models import Court, KvCache, Observation
from .geo import haversine_km
from . import stations

logger = logging.getLogger(__name__)


def fetch_current_weather(db: Session) -> dict:
    """Fetch rhrread and cache the raw payload for the frontend."""
    resp = httpx.get(settings.hko_rhrread_url, timeout=30)
    resp.raise_for_status()
    payload = resp.json()
    db.merge(KvCache(key="current_weather", value_json=json.dumps(payload),
                     updated_at=hk_now()))
    db.commit()
    return payload


def get_cached_current_weather(db: Session) -> dict | None:
    row = db.get(KvCache, "current_weather")
    if row is None:
        return None
    return json.loads(row.value_json)


def _nearest_station_with_value(court_lat: float, court_lon: float,
                                values: dict[str, float]) -> tuple[str, float] | None:
    """(station_name, rainfall_mm) of the closest gauge that reported a value."""
    best: tuple[str, float] | None = None
    best_dist = float("inf")
    for name in values:
        coords = stations.station_coords(name)
        if coords is None:
            continue
        dist = haversine_km(court_lat, court_lon, *coords)
        if dist < best_dist:
            best_dist = dist
            best = (name, values[name])
    return best


def ingest_station_rainfall(db: Session) -> int:
    """Fetch hourly rainfall per station and upsert per-court hour observations.

    Each court is mapped to its nearest gauge; rain=True means the gauge caught
    >= rain_mm_threshold mm in that hour.
    """
    from ..models import Court

    resp = httpx.get(settings.hko_hourly_rainfall_url, timeout=30)
    resp.raise_for_status()
    payload = resp.json()

    obs_time = datetime.fromisoformat(payload["obsTime"]).replace(tzinfo=None)
    observed_hour = floor_hour(obs_time)
    fetched_at = hk_now()

    values: dict[str, float] = {}
    for row in payload.get("hourlyRainfall", []):
        try:
            values[row["automaticWeatherStation"]] = float(row["value"] or 0)
        except (TypeError, ValueError):
            continue

    courts = db.query(Court).all()
    n = 0
    # merge() cannot upsert by the composite unique key (court, observed_hour);
    # a fresh 15-min run within the same hour must update the existing row.
    existing = {
        row.court_id: row
        for row in db.query(Observation)
        .filter(Observation.observed_hour == observed_hour).all()
    }
    for court in courts:
        nearest = _nearest_station_with_value(court.lat, court.lon, values)
        if nearest is None:
            continue
        station_name, mm = nearest
        row = existing.get(court.id)
        if row is None:
            row = Observation(court_id=court.id, observed_hour=observed_hour)
            db.add(row)
            existing[court.id] = row
        row.station_name = station_name
        row.rainfall_mm = mm
        row.rain = mm >= settings.rain_mm_threshold
        row.fetched_at = fetched_at
        n += 1
    db.commit()
    logger.info("station rainfall ingested for %d courts, hour=%s", n, observed_hour)
    return n
