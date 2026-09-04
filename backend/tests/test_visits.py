import os

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite://")  # in-memory for tests
os.environ.setdefault("ADMIN_TOKEN", "test-token")

from app.api.admin import admin_visits  # noqa: E402
from app.api.visits import record_visit  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.models import VisitLog  # noqa: E402
from app.schemas import VisitIn  # noqa: E402

DEVICE = "22222222-2222-2222-2222-222222222222"


@pytest.fixture()
def db():
    Base.metadata.create_all(engine)
    session = SessionLocal()
    yield session
    session.close()
    Base.metadata.drop_all(engine)


def _post(db, source=None, path=None, device=DEVICE):
    return record_visit(VisitIn(source=source, path=path),
                        x_device_id=device, db=db)


def test_visit_recorded_with_defaults(db):
    assert _post(db, source="TennisGo!", path="/courts/abc") == {"status": "ok"}
    row = db.query(VisitLog).one()
    # source is normalized to the URL-safe lowercase tag; path is kept
    assert row.source == "tennisgo"
    assert row.path == "/courts/abc"


def test_visit_sanitizes_and_falls_back(db):
    _post(db, source="../evil", path="http://spoof.example")
    row = db.query(VisitLog).one()
    assert row.source == "evil"
    assert row.path == "/"  # non-relative paths fall back to "/"


def test_visit_rejects_bad_device(db):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        _post(db, device="not-a-uuid")
    assert e.value.status_code == 400


def test_admin_visits_rollup(db):
    _post(db, source="tennisgo", path="/")
    _post(db, source="tennisgo", path="/best", device="33333333-3333-3333-3333-333333333333")
    _post(db, source=None, path="/")
    out = admin_visits(days=30, db=db)
    assert out["total_visits"] == 3
    by_source = {r["source"]: r for r in out["by_source"]}
    assert by_source["tennisgo"]["visits"] == 2
    assert by_source["tennisgo"]["devices"] == 2
    assert by_source["direct"]["visits"] == 1
    assert sum(d["visits"] for d in out["by_day"]) == 3
