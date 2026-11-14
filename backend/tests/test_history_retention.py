"""History retention and rebuild responses are independent of score windows."""
from datetime import datetime, timedelta
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import main, scheduler
from app.db import Base, get_db
from app.models import ForecastSnapshot, UserReport
from app.persistence_http import PersistenceUnavailable


def test_long_term_history_survives_purge_and_rejected_reports_expire(monkeypatch):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    now = datetime(2026, 11, 14, 23)
    with factory() as db:
        db.add(ForecastSnapshot(court_id="old-court", target_hour=now-timedelta(days=100),
                                fetched_at=now-timedelta(days=101), precip_prob=10))
        for status in ("accepted", "rejected_cooldown"):
            db.add(UserReport(court_id="old-court", device_id="test", was_raining=False,
                              intensity="none", lat=22.3, lon=114.2, status=status,
                              created_at=now-timedelta(days=100)))
        db.commit()
    monkeypatch.setattr(scheduler, "SessionLocal", factory)
    monkeypatch.setattr(scheduler, "hk_now", lambda: now)
    monkeypatch.setattr(scheduler, "settings", SimpleNamespace(data_retention_days=0, window_days=30))
    scheduler._job_purge()
    with factory() as db:
        assert db.query(ForecastSnapshot).count() == 1
        assert [row.status for row in db.query(UserReport).all()] == ["accepted"]
    monkeypatch.setattr(scheduler, "settings", SimpleNamespace(data_retention_days=60, window_days=30))
    scheduler._job_purge()
    with factory() as db:
        assert db.query(ForecastSnapshot).count() == 0
    engine.dispose()


def test_rebuilding_requests_have_retryable_503():
    def rebuilding():
        raise PersistenceUnavailable("test recovery")
    main.app.dependency_overrides[get_db] = rebuilding
    try:
        response = TestClient(main.app).get("/api/courts")
        assert response.status_code == 503
        assert response.headers["Retry-After"] == "5"
    finally:
        main.app.dependency_overrides.pop(get_db, None)


def test_health_during_handover_does_not_query_invalid_cache(monkeypatch):
    state = {"cache_valid": False, "reason": "rebuilding", "leader": False}
    monkeypatch.setattr(main, "get_persistence", lambda: SimpleNamespace(status=lambda: state))
    def forbidden():
        raise AssertionError("invalid cache must not be queried")
    monkeypatch.setattr(main, "db_state", forbidden)
    assert main.health()["persistence"] == state
    assert main.health()["db"]["cache_state"] == "rebuilding"


def test_cached_statistics_are_fenced_during_rebuild(monkeypatch):
    def invalid():
        raise PersistenceUnavailable("rebuilding")
    state = {"cache_valid": False, "reason": "rebuilding", "leader": False}
    monkeypatch.setattr(main, "get_persistence", lambda: SimpleNamespace(
        ensure_valid=invalid, status=lambda: state))
    monkeypatch.setattr(main, "detect_release_generation", lambda: 7)
    client = TestClient(main.app)
    assert client.get("/api/stats/overview").status_code == 503
    assert client.get("/api/health").status_code == 200
    identity = client.get("/api/instance")
    assert identity.status_code == 200
    assert identity.json() == {"generation": 7}
    assert identity.headers["Cache-Control"] == "no-store"
