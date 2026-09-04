"""Read-only database diagnostics, shared by /api/health and the admin API."""
import logging
import os
from datetime import datetime

from sqlalchemy import text

from .config import settings
from .db import SessionLocal

logger = logging.getLogger(__name__)


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
                ("feedback", "feedback"),
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
