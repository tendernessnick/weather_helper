"""Database engines and isolated business-schema sessions (SQLAlchemy 2.x)."""
import re

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings
from .persistence_http import HttpPersistenceSession


class Base(DeclarativeBase):
    pass


def validate_database_schema(schema: str) -> str:
    """Only a dedicated, simple identifier may own application data."""
    if (not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", schema)
            or schema in {"public", "auth", "storage", "information_schema"}
            or schema.startswith("pg_")):
        raise ValueError("DATABASE_SCHEMA must be a dedicated application schema")
    return schema


def create_database_engine(url: str, *, database_schema: str = "weather_helper",
                           pool_size: int = 2, max_overflow: int = 0) -> Engine:
    parsed = make_url(url)
    backend = parsed.get_backend_name()
    if backend == "sqlite":
        # Scheduler threads and request handlers share the engine. Concurrent
        # SQLite writers wait for a lock rather than failing immediately.
        return create_engine(parsed, connect_args={"check_same_thread": False,
                                                  "timeout": 30})
    if backend not in {"postgres", "postgresql"}:
        raise ValueError("DATABASE_URL must use SQLite or PostgreSQL")

    schema = validate_database_schema(database_schema)
    if not 1 <= pool_size <= 10 or not 0 <= max_overflow <= 5:
        raise ValueError("database pool_size must be 1..10 and max_overflow 0..5")
    # Explicit psycopg v3 works with both postgres:// and postgresql:// URLs.
    # Disable automatic prepared statements for transaction-pool compatibility.
    pg_engine = create_engine(
        parsed.set(drivername="postgresql+psycopg"),
        pool_size=pool_size, max_overflow=max_overflow,
        pool_timeout=30, pool_recycle=300, pool_pre_ping=True,
        connect_args={"connect_timeout": 10, "prepare_threshold": None,
                      "application_name": "weather_helper"},
        execution_options={"schema_translate_map": {None: schema}},
    )

    @event.listens_for(pg_engine, "begin")
    def _business_search_path(connection):
        # SET LOCAL scopes raw SQL to the same schema for every transaction,
        # including after a transaction pool assigns a different server session.
        # ORM tables are also explicitly qualified by schema_translate_map.
        quoted = connection.dialect.identifier_preparer.quote_identifier(schema)
        connection.exec_driver_sql(f"SET LOCAL search_path TO {quoted}")

    return pg_engine


def engine_schema(target_engine: Engine) -> str | None:
    return target_engine.get_execution_options().get(
        "schema_translate_map", {}).get(None)


engine = create_database_engine(
    settings.database_url, database_schema=settings.database_schema,
    pool_size=settings.database_pool_size,
    max_overflow=settings.database_max_overflow,
)
SessionLocal = sessionmaker(bind=engine, class_=HttpPersistenceSession,
                            autoflush=False, expire_on_commit=False)
_persistence = None


def get_persistence():
    return _persistence


def configure_http_persistence(*, bootstrap_sync: bool = False):
    """Fence the disposable cache and start lease-coordinated rebuild.

    A rolling replacement must become health-ready while waiting for the old
    writer's lease. Business requests remain unavailable until a full rebuild
    finishes, avoiding an old-writer/new-container readiness deadlock.
    """
    global _persistence
    backend = getattr(settings, "persistence_backend", "local")
    if backend == "local":
        return None
    if backend != "cloudbase_http":
        raise ValueError("PERSISTENCE_BACKEND must be local or cloudbase_http")
    if _persistence is not None:
        return _persistence
    if engine.dialect.name != "sqlite" or not engine.url.database or engine.url.database == ":memory:":
        raise ValueError("cloudbase_http requires a file-based SQLite query cache")
    from . import models  # noqa: F401
    from .persistence_http import Coordinator, HttpPersistenceSession, HttpRemoteStore
    remote = HttpRemoteStore(settings.persistence_api_url, settings.persistence_api_key)
    coordinator = Coordinator(remote, engine.url.database, Base.metadata,
                              lease_seconds=getattr(settings, "persistence_lease_seconds", 90),
                              traffic_url=getattr(settings, "persistence_traffic_url", ""))
    # Existing cache files are disposable and never trusted across processes.
    # Guard installation performs no schema/data SQL before bootstrap succeeds.
    engine.dispose()
    coordinator.install(engine, initialize=False)
    SessionLocal.configure(persistence_coordinator=coordinator)
    _persistence = coordinator
    if bootstrap_sync:
        # Explicit diagnostic/test mode. The service uses asynchronous startup.
        coordinator.try_acquire_writer()
        if not coordinator._leader:
            raise RuntimeError("synchronous cache bootstrap requires the write lease")
        coordinator.start()
        coordinator.recover_after_acquire()
    else:
        coordinator.start()
    return coordinator


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from . import models  # noqa: F401  (register tables before create_all)
    if engine.dialect.name == "postgresql":
        # Do not silently fall back to public when the operator omitted the
        # isolated schema. Account/schema creation belongs to migration tooling.
        with engine.connect() as conn:
            if not inspect(conn).has_schema(engine_schema(engine)):
                raise RuntimeError("application database schema is not provisioned")
    Base.metadata.create_all(engine)
    _migrate(engine)


def _migrate(target_engine) -> None:
    """Idempotent column additions for existing SQLite/PostgreSQL databases.

    create_all never alters an existing table, so columns added after a
    deployment need explicit ALTER TABLE guarded by dialect-aware inspection.
    """
    wanted = {
        "forecast_snapshots": [
            ("apparent_temp", "FLOAT"),
            ("humidity", "FLOAT"),
        ],
    }
    with target_engine.begin() as conn:
        inspector = inspect(conn)
        schema = engine_schema(target_engine)
        quote = conn.dialect.identifier_preparer.quote_identifier
        for table, columns in wanted.items():
            existing = {column["name"] for column in inspector.get_columns(
                table, schema=schema)}
            qualified = f"{quote(schema)}.{quote(table)}" if schema else quote(table)
            for name, decl in columns:
                if name not in existing:
                    conn.execute(text(
                        f"ALTER TABLE {qualified} ADD COLUMN {quote(name)} {decl}"))
