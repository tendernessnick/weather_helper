"""Database engine and session management (SQLAlchemy 2.x style)."""
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


# SQLite needs check_same_thread=False because FastAPI may touch the DB from
# scheduler threads as well as request handlers; timeout lets concurrent
# writers wait for the lock instead of failing with "database is locked".
engine_kwargs = {}
if settings.database_url.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}

engine = create_engine(settings.database_url, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from . import models  # noqa: F401  (register tables before create_all)
    Base.metadata.create_all(engine)
    _migrate(engine)


def _migrate(target_engine) -> None:
    """Idempotent column additions for existing SQLite databases.

    create_all never alters an existing table, so columns added after a
    deployment need explicit ALTER TABLE with a PRAGMA guard.
    """
    from sqlalchemy import text

    wanted = {
        "forecast_snapshots": [
            ("apparent_temp", "FLOAT"),
            ("humidity", "FLOAT"),
        ],
    }
    with target_engine.begin() as conn:
        for table, columns in wanted.items():
            existing = {row[1] for row in conn.execute(
                text(f"PRAGMA table_info({table})"))}
            for name, decl in columns:
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {decl}"))
