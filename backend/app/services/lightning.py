"""HKO cloud-to-ground lightning counts (LHL open data), per region, past hour.

The feed is an hourly CSV (dataType=LHL): one row per region for
cloud-to-ground flashes plus territory-wide totals, and one cloud-to-cloud
row. Stored verbatim in kv_cache - a single row per fetch, no history needed.
"""
import csv
import io
import json
import logging

import httpx
from sqlalchemy.orm import Session

from ..config import hk_now, settings
from ..models import KvCache

logger = logging.getLogger(__name__)

# Feed region names -> stable keys used by the API and the frontend.
REGION_KEYS = {
    "New Territories West": "ntw",
    "New Territories East": "nte",
    "Hong Kong Island and Kowloon": "hki_kln",
    "Lantau": "lantau",
}


def region_for_court(lat: float, lon: float) -> str:
    """Map court coordinates onto HKO's four LLIS regions.

    Split lines tuned against the 57 court coordinates: south of 22.345 is
    HK Island/Kowloon, the north band (Sheung Shui / Fanling / Tin Shui Wai)
    splits at lon 114.10 rather than the mid-band 114.15, and Cheung Chau
    counts as Lantau - the feed has no outlying-island bucket.
    """
    if lat < 22.34 and lon < 114.05:
        return "lantau"
    if lat < 22.345:
        return "hki_kln"
    if lat >= 22.44:
        return "nte" if lon >= 114.10 else "ntw"
    return "nte" if lon >= 114.15 else "ntw"


def parse_lhl_csv(text: str) -> dict:
    """CSV rows -> {regions: {key: count}, total, cloud, period}.

    Tolerant of missing columns: a row that cannot be parsed is skipped, so
    a cosmetic upstream format change degrades to partial data, not a crash.
    """
    out: dict = {"regions": {}, "total": 0, "cloud": 0, "period": None}
    for row in csv.DictReader(io.StringIO(text.lstrip("﻿"))):
        region = (row.get("Region") or "").strip()
        try:
            count = int(float(row.get("lightning count") or 0))
        except (TypeError, ValueError):
            continue
        if out["period"] is None:
            out["period"] = (row.get("DateTime") or "").strip() or None
        kind = (row.get("Type") or "").strip()
        if kind == "Cloud-to-ground":
            key = REGION_KEYS.get(region)
            if key:
                out["regions"][key] = count
            elif region == "Hong Kong territory":
                out["total"] = count
        elif kind == "Cloud-to-cloud" and region == "Hong Kong territory":
            out["cloud"] = count
    return out


def ingest_lightning(db: Session) -> dict:
    """Fetch the LHL feed and overwrite the kv_cache row."""
    resp = httpx.get(settings.hko_lightning_url, timeout=30)
    resp.raise_for_status()
    data = parse_lhl_csv(resp.text)
    data["fetched_at"] = hk_now().isoformat(timespec="seconds")
    db.merge(KvCache(key="lightning", value_json=json.dumps(data),
                     updated_at=hk_now()))
    db.commit()
    logger.info("lightning ingested: %s", data["regions"])
    return data


def get_cached_lightning(db: Session) -> dict | None:
    row = db.get(KvCache, "lightning")
    if row is None:
        return None
    return json.loads(row.value_json)
