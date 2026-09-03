"""Import LCSD tennis courts from the official open-data JSON feed."""
import logging
import re

import httpx
from opencc import OpenCC
from sqlalchemy.orm import Session

from ..config import hk_now, settings
from ..models import Court
from .geo import distance_meters, dms_to_decimal

logger = logging.getLogger(__name__)

_tc_to_sc = OpenCC("t2s")


def _letter(name_en: str) -> str:
    match = re.match(r"[A-Za-z]", name_en.strip())
    return match.group(0).upper() if match else "#"


def _clean(html: str) -> str:
    text = re.sub(r"<[^>]+>", " ", html or "")
    return re.sub(r"\s+", " ", text).strip()


def parse_courts(records: list[dict]) -> list[Court]:
    courts: dict[str, Court] = {}
    for rec in records:
        gihs = rec["GIHS"].strip()
        if gihs in courts:
            # The feed can repeat a venue code (e.g. separate free/chargeable
            # court records); the first record wins.
            logger.info("duplicate GIHS %s (%s) skipped", gihs, rec.get("Name_en"))
            continue
        name_en = rec["Name_en"].strip()
        try:
            lat = dms_to_decimal(rec["Latitude"])
            lon = dms_to_decimal(rec["Longitude"])
        except ValueError:
            logger.warning("skipping court %s: bad coordinates %r/%r",
                           name_en, rec["Latitude"], rec["Longitude"])
            continue
        name_tc = rec["Name_cn"].strip()
        courts[gihs] = Court(
            id=gihs,
            name_en=name_en,
            name_tc=name_tc,
            name_sc=_tc_to_sc.convert(name_tc),
            district_en=rec["District_en"].strip(),
            district_tc=rec["District_cn"].strip(),
            address_en=_clean(rec.get("Address_en", "")),
            address_tc=_clean(rec.get("Address_cn", "")),
            court_no=_clean(rec.get("Court_no_en", "")),
            opening_hours=_clean(rec.get("Opening_hours_en", "")),
            phone=(rec.get("Phone") or "").strip(),
            lat=lat,
            lon=lon,
            letter=_letter(name_en),
        )
    return list(courts.values())


def import_courts(db: Session) -> int:
    """Fetch the LCSD feed and upsert all courts. Returns the number of courts."""
    resp = httpx.get(settings.lcsd_courts_url, timeout=30, follow_redirects=True)
    resp.raise_for_status()
    records = resp.json()
    if not isinstance(records, list) or not records:
        raise ValueError(f"unexpected LCSD payload: {type(records)}")

    courts = parse_courts(records)
    for court in courts:
        db.merge(court)
    db.commit()
    logger.info("imported %d courts (feed had %d records)", len(courts), len(records))
    return len(courts)


# Hand-verified public courts the LCSD open-data feed does not list: venues
# too new for the feed (Hoi Sham Park opened 2025-02) or outside LCSD
# (university / Kai Tak Sports Park). Details from each venue's official
# page; coordinates are the OpenStreetMap court-cluster centroid.
#
# Note: Joint Sports Centre's courts sit only ~125 m from Junction Road
# Park's feed marker - two genuinely distinct, adjacent venues. The clash
# guard below therefore needs distance AND name evidence, not distance alone.
EXTRA_ID_PREFIX = "x-"
EXTRA_COURT_RADIUS_M = 100

_NAME_STOPWORDS = {
    "park", "tennis", "court", "courts", "centre", "center", "sports",
    "recreation", "ground", "playground", "road", "street", "the", "and", "of",
}


def _name_tokens(name: str) -> set[str]:
    """Distinctive lowercase words of an English venue name."""
    return {tok for tok in re.split(r"[^a-z0-9]+", name.lower())
            if tok and tok not in _NAME_STOPWORDS}

EXTRA_COURTS: list[dict] = [
    {
        "id": "x-hoi-sham-park",
        "name_en": "Hoi Sham Park", "name_tc": "海心公園",
        "district_en": "Kowloon City", "district_tc": "九龍城區",
        "address_en": "Yuk Yat Street, To Kwa Wan, Kowloon.",
        "address_tc": "九龍土瓜灣旭日街",
        "court_no": "4", "opening_hours": "7 am to 11 pm daily",
        "phone": "2334 3576",
        "lat": 22.314670, "lon": 114.191055,
    },
    {
        # CityU/HKBU/PolyU joint venue; four courts inside the complex.
        # Hours vary by season - see jsc.hkbu.edu.hk.
        "id": "x-jsc",
        "name_en": "Joint Sports Centre", "name_tc": "聯校運動中心",
        "district_en": "Kowloon City", "district_tc": "九龍城區",
        "address_en": "36 Renfrew Road, Kowloon Tong, Kowloon.",
        "address_tc": "九龍九龍塘聯福道36號",
        "court_no": "4", "opening_hours": "",
        "phone": "2794 1168",
        "lat": 22.338954, "lon": 114.182698,
    },
    {
        # Outdoor hard courts run by HKCTA under Kai Tak Sports Park.
        "id": "x-ktsp-north-garden",
        "name_en": "Kai Tak Sports Park (North Garden Tennis Courts)",
        "name_tc": "啟德體育園（北斗園網球場）",
        "district_en": "Kowloon City", "district_tc": "九龍城區",
        "address_en": "38 Shing Kai Road, Kai Tak, Kowloon.",
        "address_tc": "九龍啟德承啟道38號",
        "court_no": "3", "opening_hours": "7 am to 11 pm daily",
        "phone": "3711 5050",
        "lat": 22.326271, "lon": 114.197454,
    },
]


def upsert_extra_courts(db: Session) -> int:
    """Merge EXTRA_COURTS into the table; idempotent, runs on every boot.

    An extra is skipped when a feed court is within EXTRA_COURT_RADIUS_M or
    shares at least two distinctive name tokens with it (e.g. the feed adding
    "Hoi Sham Park Tennis Court" later) - either way the venue would be
    listed twice.
    """
    existing = db.query(Court).all()
    merged = 0
    for spec in EXTRA_COURTS:
        tokens = _name_tokens(spec["name_en"])
        clash = any(
            c.id != spec["id"]
            and (distance_meters(c.lat, c.lon, spec["lat"], spec["lon"]) < EXTRA_COURT_RADIUS_M
                 or len(tokens & _name_tokens(c.name_en)) >= 2)
            for c in existing
        )
        if clash:
            logger.info("extra court %s skipped: a feed court is within %dm",
                        spec["name_en"], EXTRA_COURT_RADIUS_M)
            continue
        db.merge(Court(
            id=spec["id"],
            name_en=spec["name_en"],
            name_tc=spec["name_tc"],
            name_sc=_tc_to_sc.convert(spec["name_tc"]),
            district_en=spec["district_en"],
            district_tc=spec["district_tc"],
            address_en=spec["address_en"],
            address_tc=spec["address_tc"],
            court_no=spec["court_no"],
            opening_hours=spec["opening_hours"],
            phone=spec["phone"],
            lat=spec["lat"],
            lon=spec["lon"],
            letter=_letter(spec["name_en"]),
        ))
        merged += 1
    db.commit()
    return merged


def ensure_courts(db: Session) -> int:
    """Import the LCSD feed at first boot, then always merge extra courts."""
    feed_count = db.query(Court).filter(
        ~Court.id.startswith(EXTRA_ID_PREFIX)).count()
    if feed_count == 0:
        import_courts(db)
    upsert_extra_courts(db)
    count = db.query(Court).count()
    logger.info("courts available: %d at %s", count, hk_now().isoformat())
    return count
