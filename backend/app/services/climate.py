"""10-year hourly climatology backfill from the Open-Meteo ERA5 archive.

Only aggregates land in the DB (per court x month x hour rain frequency, 1h
Markov transitions, dry-spell survival); the raw hourly series streams through
memory and is discarded. Per-court progress ("climate_last:<id>" = last
ingested month as YYYY-MM) makes backfill resumable and lets the monthly job
fold in exactly the months it has not seen - no double counting, ever.
"""
import json
import logging
import time
from datetime import datetime, timedelta

import httpx
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import hk_now
from ..models import Court, Climatology, KvCache, Persistence

logger = logging.getLogger(__name__)

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
# ERA5 has a known drizzle bias in South China (frequent spurious 0.1-0.3mm
# hours); a 0.5mm threshold both filters that and matches the smallest rain
# that actually matters for tennis. The live verification pipeline keeps the
# 0.1mm gauge threshold - these are two different questions.
RAIN_THRESHOLD = 0.5
SURVIVAL_LENGTHS = (1, 2, 3, 4)  # booking lengths in hours
BACKFILL_START = (datetime.now().year - 10, 1)  # (year, month): 10 years back
FETCH_PAUSE = 1.2  # seconds between archive requests (the archive API 429s fast)


def _last_key(court_id: str) -> str:
    return f"climate_last:{court_id}"


def _month_str(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def _parse_month(value: str) -> tuple[int, int]:
    year, month = value.split("-")
    return int(year), int(month)


def _next_month(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


def _months_between(start: tuple[int, int], end: tuple[int, int]):
    """Inclusive list of (year, month) from start to end."""
    out = []
    cur = start
    while cur <= end:
        out.append(cur)
        cur = _next_month(*cur)
    return out


def _month_bounds(year: int, month: int) -> tuple[str, str]:
    start = datetime(year, month, 1)
    ny, nm = _next_month(year, month)
    end = datetime(ny, nm, 1) - timedelta(days=1)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def _fetch_period(client: httpx.Client, lat: float, lon: float,
                  start_date: str, end_date: str,
                  retries: int = 5) -> dict | None:
    for attempt in range(retries):
        resp = client.get(ARCHIVE_URL, params={
            "latitude": f"{lat:.4f}",
            "longitude": f"{lon:.4f}",
            "start_date": start_date,
            "end_date": end_date,
            "hourly": "precipitation",
            "timezone": "Asia/Hong_Kong",
        })
        if resp.status_code == 400:
            return None  # period not available yet (archive tail lag)
        if resp.status_code == 429:
            wait = 15 * (attempt + 1)  # rate limited: back off and retry
            logger.warning("archive 429, backing off %ss (%s~%s)", wait, start_date, end_date)
            time.sleep(wait)
            continue
        resp.raise_for_status()
        return resp.json().get("hourly", {})
    return None  # still throttled after retries; the chunk retries next pass


class Aggregates:
    """In-memory accumulators for one court over one or more periods."""

    def __init__(self) -> None:
        self.clim: dict[tuple[int, int], list[int]] = {}   # (month,hour) -> [samples, rain]
        self.trans: dict[int, list[int]] = {}               # month -> [ww, wd, dw, dd]
        self.surv_base: dict[int, int] = {}                 # month -> eligible dry starts
        self.surv_ok: dict[int, dict[int, int]] = {}        # month -> {L: all-dry count}

    def feed(self, times: list[str], mms: list) -> None:
        parsed: list[tuple[int, int, bool | None]] = []
        for t, mm in zip(times, mms):
            if mm is None:
                parsed.append((0, 0, None))
                continue
            dt = datetime.fromisoformat(t)
            parsed.append((dt.month, dt.hour, mm >= RAIN_THRESHOLD))

        for month, hour, wet in parsed:
            if wet is None:
                continue
            cell = self.clim.setdefault((month, hour), [0, 0])
            cell[0] += 1
            cell[1] += int(wet)

        # 1h transitions; a transition lands on the month of the LATER hour,
        # and gaps (missing hours) are skipped entirely.
        for (m1, _h1, w1), (m2, _h2, w2) in zip(parsed, parsed[1:]):
            if w1 is None or w2 is None:
                continue
            counts = self.trans.setdefault(m2, [0, 0, 0, 0])
            idx = (0 if w2 else 1) if w1 else (2 if w2 else 3)
            counts[idx] += 1

        # dry-spell survival: of hours that were dry, how often did the next
        # L hours stay dry (contiguously observed)?
        n = len(parsed)
        for i in range(n - 1):
            wet_now = parsed[i][2]
            if wet_now is None or wet_now:
                continue
            month = parsed[i][0]
            for L in SURVIVAL_LENGTHS:
                if i + L >= n:
                    break
                window = parsed[i + 1: i + 1 + L]
                if any(w is None for (_m, _h, w) in window):
                    break  # observation gap: this start supports no L
                if L == 1:
                    self.surv_base[month] = self.surv_base.get(month, 0) + 1
                if all(w is False for (_m, _h, w) in window):
                    ok = self.surv_ok.setdefault(month, {})
                    ok[L] = ok.get(L, 0) + 1

    def save(self, db: Session, court_id: str) -> None:
        for (month, hour), (samples, rain_count) in self.clim.items():
            row = db.query(Climatology).filter(
                Climatology.court_id == court_id,
                Climatology.month == month,
                Climatology.hour == hour).first()
            if row is None:
                row = Climatology(court_id=court_id, month=month, hour=hour,
                                  samples=0, rain_count=0)
                db.add(row)
            row.samples += samples
            row.rain_count += rain_count

        for month, (ww, wd, dw, dd) in self.trans.items():
            row = db.query(Persistence).filter(
                Persistence.court_id == court_id,
                Persistence.month == month).first()
            if row is None:
                row = Persistence(court_id=court_id, month=month,
                                  wet_to_wet=0, wet_to_dry=0,
                                  dry_to_wet=0, dry_to_dry=0,
                                  survival_json="{}")
                db.add(row)
            row.wet_to_wet += ww
            row.wet_to_dry += wd
            row.dry_to_wet += dw
            row.dry_to_dry += dd
            surv = json.loads(row.survival_json or "{}")
            base = surv.pop("_base", 0) + self.surv_base.get(month, 0)
            for L, ok in self.surv_ok.get(month, {}).items():
                surv[str(L)] = surv.get(str(L), 0) + ok
            surv["_base"] = base
            row.survival_json = json.dumps(surv)
        db.commit()


def _ingest_months(db: Session, court: Court, months: list[tuple[int, int]],
                   client: httpx.Client) -> int:
    """Fetch + aggregate months in year-sized chunks so an interruption loses
    at most one chunk; progress is committed per chunk. Chunks are fed as one
    contiguous series to keep intra-chunk transitions/survival intact."""
    done = 0
    for chunk_start in range(0, len(months), 12):
        chunk = months[chunk_start:chunk_start + 12]
        agg = Aggregates()
        times_all, mms_all = [], []
        ok = True
        for ym in chunk:
            start, end = _month_bounds(*ym)
            hourly = _fetch_period(client, court.lat, court.lon, start, end)
            if hourly is None:
                ok = False  # not available yet; retry next scheduled pass
                break
            times_all.extend(hourly.get("time", []))
            mms_all.extend(hourly.get("precipitation", []))
            time.sleep(FETCH_PAUSE)
        if not ok or not times_all:
            break
        agg.feed(times_all, mms_all)
        agg.save(db, court.id)
        db.merge(KvCache(key=_last_key(court.id),
                         value_json=_month_str(*chunk[-1]), updated_at=hk_now()))
        db.commit()
        done += len(chunk)
    return done


def backfill_court(db: Session, court: Court) -> int:
    """Bring one court up from the 10-year mark to the last complete month."""
    row = db.get(KvCache, _last_key(court.id))
    start = _parse_month(row.value_json) if row else BACKFILL_START
    now = hk_now()
    # strictly the previous month: the current one is still accumulating in
    # the ERA5 archive and a partial fetch would be frozen as "done" forever
    end = (now.year - 1, 12) if now.month == 1 else (now.year, now.month - 1)
    months = _months_between(start, end)
    if not months:
        return 0
    with httpx.Client(timeout=120) as client:
        done = _ingest_months(db, court, months, client)
    if done:
        logger.info("climatology +%d months for %s (through %s)",
                    done, court.name_en, _month_str(*start))
    return done


def backfill_all(db: Session, limit: int | None = None) -> int:
    courts = db.query(Court).order_by(Court.id).all()
    if limit:
        courts = courts[:limit]
    total = 0
    for court in courts:
        try:
            total += backfill_court(db, court)
        except Exception:  # noqa: BLE001 - one court must not kill the pass
            logger.exception("climatology failed for %s; continuing", court.name_en)
    logger.info("climatology backfill pass: %d court-months ingested", total)
    return total


def update_recent_months() -> None:
    """Scheduled monthly top-up: fold in any months not yet ingested."""
    from ..db import SessionLocal
    with SessionLocal() as db:
        done = backfill_all(db)
    logger.info("climate monthly update: %d court-months", done)


def sanity_report(db: Session) -> dict:
    """Plausibility checks on stored climatology (used in verification)."""
    total_s = db.query(func.sum(Climatology.samples)).scalar() or 0
    total_r = db.query(func.sum(Climatology.rain_count)).scalar() or 0

    def freq(month: int, hour: int) -> float | None:
        s = db.query(func.sum(Climatology.samples)).filter(
            Climatology.month == month, Climatology.hour == hour).scalar() or 0
        r = db.query(func.sum(Climatology.rain_count)).filter(
            Climatology.month == month, Climatology.hour == hour).scalar() or 0
        return round(r / s, 4) if s else None

    return {
        "courts": db.query(Court).count(),
        "cells": db.query(Climatology).count(),
        "overall_rain_hours_pct": round(100 * total_r / total_s, 2) if total_s else None,
        "july_15h_rain_pct": None if freq(7, 15) is None else round(freq(7, 15) * 100, 1),
        "feb_15h_rain_pct": None if freq(2, 15) is None else round(freq(2, 15) * 100, 1),
    }
