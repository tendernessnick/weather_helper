"""APScheduler wiring: periodic ingest, nightly purge, push checks.

The scheduler runs inside the web process (single long-running service), so no
external cron is needed. All jobs swallow exceptions and log - one failed fetch
must never kill the loop.
"""
import logging
from datetime import timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import delete

from .config import hk_now, settings
from .db import SessionLocal
from .models import ForecastSnapshot, NowcastSnapshot, Observation, UserReport
from .services import hko, hko_nowcast, open_meteo, push

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
        db.execute(delete(NowcastSnapshot).where(NowcastSnapshot.fetched_at < cutoff))
        db.execute(delete(Observation).where(Observation.observed_hour < cutoff))
        # Keep rejected reports out of storage; accepted ones are part of the audit trail.
        db.execute(delete(UserReport).where(
            UserReport.created_at < cutoff, UserReport.status != "accepted"))
        db.commit()
    logger.info("purged rows older than %s", cutoff)


def _run(fn):
    def wrapped():
        try:
            fn()
        except Exception:  # noqa: BLE001 - scheduler jobs must never crash the app
            logger.exception("scheduled job %s failed", fn.__name__)
    return wrapped


def create_scheduler() -> BackgroundScheduler:
    sched = BackgroundScheduler(timezone="Asia/Hong_Kong")
    sched.add_job(_run(_job_ingest_nowcast), "interval", minutes=12,
                  id="ingest_nowcast")
    sched.add_job(_run(_job_ingest_rainfall), "interval", minutes=15,
                  id="ingest_rainfall")
    sched.add_job(_run(_job_ingest_current), "interval", minutes=15,
                  id="ingest_current")
    sched.add_job(_run(_job_ingest_open_meteo), "cron", hour="*", minute=5,
                  id="ingest_open_meteo")
    sched.add_job(_run(_job_push_check), "interval", minutes=5,
                  id="push_check")
    sched.add_job(_run(_job_purge), "cron", hour=3, minute=30, id="purge")
    return sched
