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
