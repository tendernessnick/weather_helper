"""FastAPI application entry point."""
import logging
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import (admin, best, checkins, courts, feedback, map as map_api,
                  reports, stats, subscriptions)
from .config import settings
from .db import SessionLocal, configure_http_persistence, get_persistence, init_db
from .diagnostics import db_state
from .persistence_http import PersistenceUnavailable, detect_release_generation
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


def _ingest_after_writer_ready(stop: threading.Event) -> None:
    """A replacement container waits for the old database writer to leave."""
    while not stop.is_set():
        persistence = get_persistence()
        if persistence is None or persistence.can_write():
            try:
                if persistence is not None:
                    with SessionLocal() as db:
                        ensure_courts(db)
                _first_boot_ingest()
            except Exception:
                logger.exception("initial database writer setup failed")
            return
        stop.wait(1)


@asynccontextmanager
async def lifespan(app: FastAPI):
    persistence = configure_http_persistence()
    if persistence is None:
        init_db()
        with SessionLocal() as db:
            ensure_courts(db)
    else:
        persistence.start()
    logger.info("startup db state: %s", db_state())
    stop = threading.Event()
    if settings.scheduler_enabled:
        scheduler.start()
    if settings.first_boot_ingest_enabled:
        threading.Thread(target=_ingest_after_writer_ready, args=(stop,),
                         name="first-boot-ingest", daemon=True).start()
    logger.info("startup complete")
    try:
        yield
    finally:
        stop.set()
        scheduler.shutdown(wait=True)
        if persistence is not None:
            persistence.stop()


app = FastAPI(title="Weather Helper for Hong Kong Tennis", version="0.1.0",
              lifespan=lifespan)


@app.exception_handler(PersistenceUnavailable)
async def persistence_unavailable(_request, _exc):
    return JSONResponse(status_code=503, headers={"Retry-After": "5"},
                        content={"detail": "数据库正在同步或暂时不可用，请稍后重试。"})


@app.middleware("http")
async def persistence_ready(request, call_next):
    # Statistics also have in-process TTL caches. Fence those endpoints before
    # their handlers can return an old cached value without touching SQL.
    if (request.url.path.startswith("/api/")
            and request.url.path not in {"/api/health", "/api/instance"}):
        persistence = get_persistence()
        if persistence is not None:
            try:
                persistence.ensure_valid()
            except PersistenceUnavailable as exc:
                return await persistence_unavailable(request, exc)
    return await call_next(request)

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
    persistence = get_persistence()
    # A new container must become ready for the platform to retire its old
    # writer. Business endpoints remain 503 until the cache rebuild completes.
    state = persistence.status() if persistence is not None else None
    db = ({"database_backend": "postgresql_http", "cache_state": state["reason"]}
          if state is not None and not state["cache_valid"] else db_state())
    out = {"status": "ok", "db": db}
    if persistence is not None:
        out["persistence"] = state
    return out


@app.get("/api/instance")
async def instance_identity():
    """Identify the version receiving traffic without reading the query cache."""
    return JSONResponse({"generation": detect_release_generation()},
                        headers={"Cache-Control": "no-store"})


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
