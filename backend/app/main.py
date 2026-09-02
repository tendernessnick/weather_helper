"""FastAPI application entry point."""
import logging
import os
import threading
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from .api import best, checkins, courts, map as map_api, reports, stats, subscriptions
from .config import settings
from .db import SessionLocal, init_db
from .scheduler import (_job_ingest_current, _job_ingest_nowcast,
                        _job_ingest_open_meteo, _job_ingest_rainfall, create_scheduler)
from .services.lcsd import ensure_courts

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

scheduler = create_scheduler()


def db_state() -> dict:
    """Row counts + SQLite file birth time: makes volume loss visible.

    On Railway, a redeploy recreates the container filesystem unless a volume
    is mounted at /data — in that case db_file_created_at resets to the deploy
    time and all counts restart from zero. Reads only; never raises.
    """
    out: dict = {"database_url": settings.database_url}
    try:
        path = settings.database_url.split("sqlite:///", 1)[-1]
        if path and os.path.exists(path):
            st = os.stat(path)
            out["db_file"] = path
            out["db_file_created_at"] = datetime.fromtimestamp(
                st.st_ctime).isoformat(timespec="seconds")
            out["db_size_mb"] = round(st.st_size / 1e6, 1)
        with SessionLocal() as db:
            for label, table in (
                ("courts", "courts"),
                ("forecast_snapshots", "forecast_snapshots"),
                ("observations", "observations"),
                ("nowcast_snapshots", "nowcast_snapshots"),
                ("climatology_cells", "climatology"),
                ("user_reports_total", "user_reports"),
                ("checkins", "checkins"),
                ("push_subscriptions", "push_subscriptions"),
            ):
                out[label] = db.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
            out["accepted_user_reports"] = db.execute(
                text("SELECT COUNT(*) FROM user_reports WHERE status='accepted'")).scalar()
            latest = db.execute(
                text("SELECT MAX(observed_hour) FROM observations")).scalar()
            out["latest_observation"] = str(latest) if latest else None
    except Exception:  # noqa: BLE001 - diagnostics must never break health
        logger.exception("db_state failed")
        out["error"] = "unavailable"
    return out


def _first_boot_ingest() -> None:
    """Kick off all sources once at startup so a fresh deploy has data immediately."""
    for job in (_job_ingest_current, _job_ingest_rainfall, _job_ingest_nowcast,
                _job_ingest_open_meteo):
        try:
            job()
        except Exception:
            logger.exception("startup ingest %s failed", job.__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with SessionLocal() as db:
        ensure_courts(db)
    logger.info("startup db state: %s", db_state())
    scheduler.start()
    threading.Thread(target=_first_boot_ingest, daemon=True).start()
    logger.info("startup complete")
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="Weather Helper for Hong Kong Tennis", version="0.1.0",
              lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(courts.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(subscriptions.router, prefix="/api")
app.include_router(stats.router, prefix="/api")
app.include_router(best.router, prefix="/api")
app.include_router(map_api.router, prefix="/api")
app.include_router(checkins.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok", "db": db_state()}


# Serve the built frontend when present (single-service deployment).
_dist = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                     "frontend", "dist")
if os.path.isdir(_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(_dist, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        candidate = os.path.join(_dist, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(_dist, "index.html"))
