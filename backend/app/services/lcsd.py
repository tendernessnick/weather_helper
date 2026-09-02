"""Import LCSD tennis courts from the official open-data JSON feed."""
import logging
import re

import httpx
from opencc import OpenCC
from sqlalchemy.orm import Session

from ..config import hk_now, settings
from ..models import Court
from .geo import dms_to_decimal

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


def ensure_courts(db: Session) -> int:
    """Import courts at first boot when the table is empty."""
    count = db.query(Court).count()
    if count == 0:
        count = import_courts(db)
    logger.info("courts available: %d at %s", count, hk_now().isoformat())
    return count
