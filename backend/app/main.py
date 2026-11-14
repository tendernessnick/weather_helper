"""FastAPI application entry point."""
import logging
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api import (admin, best, checkins, courts, feedback, map as map_api,
                  reports, stats, subscriptions)
from .config import settings
from .db import SessionLocal, init_db
from .diagnostics import db_state
from .scheduler import run_job_exclusive, scheduler
from .services.lcsd import ensure_courts

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

# Same set as before, by job id: routed through the scheduler's per-job locks
# so these can't race the staggered first ticks on shared table writes.
_FIRST_BOOT_JOBS = ("ingest_current", "ingest_rainfall", "ingest_nowcast",
                    "ingest_open_meteo")


def _first_boot_ingest() -> None:
    """Kick off all sources once at startup so a fresh deploy has data immediately."""
    for job_id in _FIRST_BOOT_JOBS:
        try:
            run_job_exclusive(job_id)
        except Exception:
            logger.exception("startup ingest %s failed", job_id)


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
app.include_router(feedback.router, prefix="/api")
app.include_router(admin.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok", "db": db_state()}


# Serve the built frontend when present (single-service deployment).
_dist = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                     "frontend", "dist")


def _frontend_path(root: str, full_path: str) -> Path:
    """Resolve SPA assets inside dist, including encoded/backslash traversal.

    Only existing files within the build are candidates. Unknown API routes
    must remain 404, rather than becoming successful HTML responses.
    """
    base = Path(root).resolve()
    candidate = (base / full_path).resolve()
    if not candidate.is_relative_to(base) or full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="not found")
    return candidate


if os.path.isdir(_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(_dist, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        candidate = _frontend_path(_dist, full_path)
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(os.path.join(_dist, "index.html"))
