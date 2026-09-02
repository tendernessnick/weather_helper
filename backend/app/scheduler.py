"""Tiny in-process scheduler: one daemon thread, per-job fixed intervals.

Deliberately replaces APScheduler: on this stack (Python 3.14) its executor
thread was observed to stop silently a few minutes after start. A plain loop
with monotonic clocks is fully predictable, has no dependency, and matches the
single long-running-service deployment. Job exceptions are logged and swallowed.
"""
import logging
import threading
import time
from datetime import timedelta

from sqlalchemy import delete

from .config import hk_now, settings
from .db import SessionLocal
from .models import (Climatology, ForecastLead, ForecastSnapshot, NowcastSnapshot,
                     Observation, Persistence, UserReport)
from .services import climate, hko, hko_nowcast, open_meteo, push

logger = logging.getLogger(__name__)


def _job_ingest_nowcast():
    with SessionLocal() as db:
        hko_nowcast.ingest_nowcast(db)


def _job_ingest_rainfall():
    with SessionLocal() as db:
        hko.ingest_station_rainfall(db)


def _job_ingest_current():
    with SessionLocal() as db:
        hko.fetch_current_weather(db)


def _job_ingest_open_meteo():
    with SessionLocal() as db:
        open_meteo.ingest_open_meteo(db)


def _job_push_check():
    with SessionLocal() as db:
        push.check_and_notify(db)


def _job_purge():
    cutoff = hk_now() - timedelta(days=settings.window_days + 2)
    with SessionLocal() as db:
        db.execute(delete(ForecastSnapshot).where(ForecastSnapshot.target_hour < cutoff))
        db.execute(delete(ForecastLead).where(ForecastLead.target_hour < cutoff))
        db.execute(delete(NowcastSnapshot).where(NowcastSnapshot.fetched_at < cutoff))
        db.execute(delete(Observation).where(Observation.observed_hour < cutoff))
        # Keep accepted reports as an audit trail; drop rejected ones with the window.
        db.execute(delete(UserReport).where(
            UserReport.created_at < cutoff, UserReport.status != "accepted"))
        db.commit()
    logger.info("purged rows older than %s", cutoff)


JOBS = [
    # (id, callable, interval_seconds)
    ("ingest_nowcast", _job_ingest_nowcast, 12 * 60),
    ("ingest_rainfall", _job_ingest_rainfall, 15 * 60),
    ("ingest_current", _job_ingest_current, 15 * 60),
    ("ingest_open_meteo", _job_ingest_open_meteo, 60 * 60),
    ("push_check", _job_push_check, 5 * 60),
    ("purge", _job_purge, 24 * 3600),
    # monthly climatology top-up (ERA5 archive lags a few days; daily tries
    # would mostly 404 on the incomplete tail, monthly is plenty)
    # daily climatology top-up: idempotent (per-court progress keys mean only
    # missing months are fetched) and heals courts skipped by archive 429s
    # within a day instead of waiting a month
    ("climate_update", climate.update_recent_months, 24 * 3600),
]


class SimpleScheduler:
    def __init__(self) -> None:
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._next: dict[str, float] = {}

    def start(self) -> None:
        now = time.monotonic()
        # First run of every job shortly after boot, staggered to spread load.
        for i, (job_id, _fn, _interval) in enumerate(JOBS):
            self._next[job_id] = now + 5 + i * 3
        self._thread = threading.Thread(target=self._loop, name="scheduler", daemon=True)
        self._thread.start()

    def shutdown(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)

    def _loop(self) -> None:
        logger.info("simple scheduler started: %s", {j[0]: j[2] for j in JOBS})
        while not self._stop.wait(timeout=1.0):
            try:
                self._tick()
            except Exception:  # noqa: BLE001 - the loop itself must survive
                logger.exception("scheduler tick failed")
        logger.info("simple scheduler stopped")

    def _tick(self) -> None:
        now = time.monotonic()
        for job_id, fn, interval in JOBS:
            if now >= self._next[job_id]:
                try:
                    fn()
                except Exception:  # noqa: BLE001
                    logger.exception("job %s failed", job_id)
                self._next[job_id] = time.monotonic() + interval


def create_scheduler() -> SimpleScheduler:
    return SimpleScheduler()
