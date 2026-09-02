"""Open-Meteo hourly forecast ingest for all courts (batched multi-location calls)."""
import logging
from datetime import datetime

import httpx
from sqlalchemy.orm import Session

from ..config import floor_hour, hk_now, settings
from ..models import Court, ForecastSnapshot

logger = logging.getLogger(__name__)

HOURLY_VARS = "precipitation_probability,precipitation,weather_code,wind_speed_10m"
BATCH_SIZE = 20  # locations per request; Open-Meteo returns results in input order
FORECAST_DAYS = 3


def _upsert_court(db: Session, court_id: str, hourly: dict, fetched_at) -> int:
    times = hourly.get("time", [])
    n = 0
    now_hour = floor_hour(hk_now())
    kept = [t for t in times if t > now_hour]
    if not kept:
        return 0

    # merge() cannot upsert by the composite unique key (court, target_hour),
    # so load the existing rows for this fetch range and update in place.
    existing = {
        row.target_hour: row
        for row in db.query(ForecastSnapshot)
        .filter(ForecastSnapshot.court_id == court_id,
                ForecastSnapshot.target_hour >= min(kept),
                ForecastSnapshot.target_hour <= max(kept))
        .all()
    }
    for i, target in enumerate(times):
        # Freeze hours that already started: each hour keeps the forecast issued
        # ~1h before it began - that is the version a user saw when deciding,
        # and the version verification later scores against reality.
        if target <= now_hour:
            continue
        prob = hourly.get("precipitation_probability", [None] * len(times))[i]
        if prob is None:
            continue
        mm = hourly.get("precipitation", [0.0] * len(times))[i] or 0.0
        code = hourly.get("weather_code", [0] * len(times))[i] or 0
        wind = hourly.get("wind_speed_10m", [0.0] * len(times))[i] or 0.0
        row = existing.get(target)
        if row is None:
            row = ForecastSnapshot(
                court_id=court_id, source="open_meteo", target_hour=target)
            db.add(row)
            existing[target] = row
        row.precip_prob = int(prob)
        row.precip_mm = float(mm)
        row.weather_code = int(code)
        row.wind_kmh = float(wind)
        row.fetched_at = fetched_at
        n += 1
    return n


def ingest_open_meteo(db: Session) -> int:
    """Fetch hourly forecasts for every court and upsert snapshots."""
    courts = db.query(Court).order_by(Court.id).all()
    if not courts:
        return 0

    fetched_at = hk_now()
    total = 0
    with httpx.Client(timeout=60) as client:
        for start in range(0, len(courts), BATCH_SIZE):
            batch = courts[start:start + BATCH_SIZE]
            params = {
                "latitude": ",".join(f"{c.lat:.4f}" for c in batch),
                "longitude": ",".join(f"{c.lon:.4f}" for c in batch),
                "hourly": HOURLY_VARS,
                "forecast_days": FORECAST_DAYS,
                "timezone": "Asia/Hong_Kong",
            }
            resp = client.get(settings.open_meteo_url, params=params)
            resp.raise_for_status()
            data = resp.json()
            results = data if isinstance(data, list) else [data]
            for court, result in zip(batch, results):
                hourly = result.get("hourly", {})
                # Parse "YYYY-MM-DDTHH:MM" strings into naive datetimes.
                hourly["time"] = [
                    datetime.fromisoformat(t) for t in hourly.get("time", [])
                ]
                total += _upsert_court(db, court.id, hourly, fetched_at)
            db.commit()
    logger.info("Open-Meteo ingested %d snapshot hours for %d courts", total, len(courts))
    return total
