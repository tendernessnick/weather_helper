"""Read-only database diagnostics, shared by /api/health and the admin API."""
import logging
import os
from contextlib import nullcontext
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from .db import SessionLocal, engine, engine_schema

logger = logging.getLogger(__name__)


def db_state(db: Session | None = None) -> dict:
    """Public-safe row counts and storage diagnostics; reads only, never raises.

    Connection URLs contain credentials for PostgreSQL, so neither health nor
    startup logging returns them. PostgreSQL sizes include this app's tables
    only, without exposing other platform schemas or full-instance sizes.
    """
    out: dict = {"database_backend": engine.dialect.name}
    try:
        if engine.dialect.name == "sqlite":
            path = engine.url.database
            if path and os.path.isfile(path):
                st = os.stat(path)
                out["db_file"] = path
                out["db_file_created_at"] = datetime.fromtimestamp(
                    st.st_ctime).isoformat(timespec="seconds")
                out["db_size_mb"] = round(st.st_size / 1e6, 1)
        else:
            out["database_schema"] = engine_schema(engine)
        # Admin handlers already hold a connection. Reuse that session so two
        # simultaneous admin reads cannot each wait for a second pool slot.
        with (nullcontext(db) if db is not None else SessionLocal()) as session:
            if engine.dialect.name == "postgresql":
                size = session.execute(text(
                    "SELECT COALESCE(SUM(pg_total_relation_size(c.oid)), 0) "
                    "FROM pg_class AS c JOIN pg_namespace AS n ON n.oid=c.relnamespace "
                    "WHERE n.nspname=:schema AND c.relkind IN ('r', 'm')"
                ), {"schema": engine_schema(engine)}).scalar()
                out["db_size_mb"] = round(int(size) / 1e6, 1)
            for label, table in (
                ("courts", "courts"),
                ("forecast_snapshots", "forecast_snapshots"),
                ("observations", "observations"),
                ("nowcast_snapshots", "nowcast_snapshots"),
                ("forecast_leads", "forecast_leads"),
                ("climatology_cells", "climatology"),
                ("persistence", "persistence"),
                ("kv_cache", "kv_cache"),
                ("user_reports_total", "user_reports"),
                ("checkins", "checkins"),
                ("push_subscriptions", "push_subscriptions"),
                ("feedback", "feedback"),
            ):
                out[label] = session.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
            out["accepted_user_reports"] = session.execute(
                text("SELECT COUNT(*) FROM user_reports WHERE status='accepted'")).scalar()
            latest = session.execute(
                text("SELECT MAX(observed_hour) FROM observations")).scalar()
            out["latest_observation"] = str(latest) if latest else None
    except Exception:  # noqa: BLE001 - diagnostics must never break health
        logger.exception("db_state failed")
        out["error"] = "unavailable"
    return out
