"""Decision endpoints must distinguish stale/missing evidence from dry weather."""
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.api import best, courts, subscriptions
from app.db import Base, SessionLocal, engine
from app.main import _frontend_path
from app.models import Court, ForecastSnapshot, NowcastSnapshot, PushSubscription
from app.schemas import PollingSubscriptionIn, SubscriptionIn
from app.services import fusion, hko_nowcast, push
from app.services.freshness import (FORECAST_FRESH_SEC, NOWCAST_FRESH_SEC,
                                   is_fresh, source_status)

NOW = datetime(2026, 11, 14, 15, 20)


@pytest.fixture()
def db(monkeypatch):
    Base.metadata.create_all(engine)
    session = SessionLocal()
    for module in (best, courts, subscriptions, push):
        monkeypatch.setattr(module, "hk_now", lambda: NOW)
    monkeypatch.setattr(courts.analytics, "pooled_calibration", lambda db: (lambda p: p, 0))
    for idx in range(3):
        session.add(Court(id=f"c{idx}", name_en=f"Court {idx}", name_tc="球場",
                          name_sc="球场", district_en="X", district_tc="X",
                          lat=22.28, lon=114.19, letter="C"))
    session.commit()
    yield session
    session.close()
    Base.metadata.drop_all(engine)


def forecast(db, cid="c0", hour=None, pop=0, age=0):
    row = ForecastSnapshot(court_id=cid, target_hour=hour or NOW.replace(hour=16, minute=0),
                           precip_prob=pop, fetched_at=NOW - timedelta(seconds=age))
    db.add(row)
    db.commit()
    return row


def nowcast(db, age=0, ending="2026-11-14T16:00:00", mm=0.0):
    row = NowcastSnapshot(court_id="c0", fetched_at=NOW - timedelta(seconds=age),
                          steps_json=json.dumps([{"ending": ending, "mm": mm}]))
    db.add(row)
    db.commit()
    return row


@pytest.mark.parametrize("seconds,fresh", [(0, True), (180, True), (1800, False), (-1, False)])
def test_freshness_rejects_stale_and_future(seconds, fresh):
    assert is_fresh(NOW - timedelta(seconds=seconds), NOW, NOWCAST_FRESH_SEC) is fresh


def test_freshness_accepts_explicit_timezone_and_handles_missing():
    utc_now = datetime(2026, 11, 14, 7, 20, tzinfo=timezone.utc)
    assert is_fresh(utc_now, NOW, NOWCAST_FRESH_SEC)
    assert source_status(None, NOW, NOWCAST_FRESH_SEC)["status"] == "missing"
    assert source_status(NOW, NOW, NOWCAST_FRESH_SEC)["fetched_at"].endswith("+08:00")


def test_weather_exposes_stale_instead_of_silent_fresh_zero(db):
    forecast(db, age=FORECAST_FRESH_SEC + 1)
    nowcast(db, age=NOWCAST_FRESH_SEC + 1)
    data = courts.court_weather("c0", db)
    assert data["hourly"][0]["stale"] is True
    assert data["data_status"]["hourly"]["status"] == "stale"
    assert data["data_status"]["nowcast"]["status"] == "stale"
    assert data["data_status"]["timezone"] == "Asia/Hong_Kong"
    assert "not a calibrated probability" in data["sources"]["fused"]
    assert courts._nowcast_badges(db) == {}


def test_weather_missing_and_expired_coverage(db):
    data = courts.court_weather("c0", db)
    assert data["hourly"] == []
    assert data["data_status"]["hourly"]["status"] == "missing"
    nowcast(db, ending="2026-11-14T15:00:00")
    assert courts.court_weather("c0", db)["data_status"]["nowcast"]["status"] == "stale"


def test_weather_near_term_status_cannot_hide_one_stale_hour(db):
    forecast(db)
    forecast(db, hour=NOW.replace(hour=17, minute=0), age=FORECAST_FRESH_SEC + 1)
    data = courts.court_weather("c0", db)
    assert data["data_status"]["hourly"]["status"] == "stale"
    assert [h["stale"] for h in data["hourly"]] == [False, True]


def test_best_uses_true_median_and_excludes_stale_zero(db):
    forecast(db, "c0", pop=20)
    forecast(db, "c1", pop=81)
    forecast(db, "c2", pop=0, age=FORECAST_FRESH_SEC + 1)
    data = best.best_hours(hour=None, db=db)
    assert data["city_median_pop"] == 50.5
    assert data["hours"][0]["city_median_pop"] == 50.5
    assert [c["court_id"] for c in data["courts"]] == ["c0", "c1"]
    assert data["available_courts"] == 2 and data["total_courts"] == 3


def test_best_all_stale_is_empty_unknown_not_zero(db):
    forecast(db, age=FORECAST_FRESH_SEC + 1)
    data = best.best_hours(hour=None, db=db)
    assert data["city_median_pop"] is None
    assert data["courts"] == [] and data["hours"] == []
    assert data["data_status"]["status"] == "stale"


@pytest.mark.parametrize("raw", ["bad", "2026-11-14T16:30", "2026-11-14T15:00", "2026-11-15T16:00"])
def test_best_rejects_invalid_past_and_out_of_range_hours(raw):
    with pytest.raises(HTTPException) as exc:
        best._parse_hour(raw, NOW)
    assert exc.value.status_code == 422


def test_best_normalizes_timezone():
    assert best._parse_hour("2026-11-14T08:00:00Z", NOW) == datetime(2026, 11, 14, 16)


@pytest.mark.parametrize("age", [None, FORECAST_FRESH_SEC + 1])
def test_missing_or_stale_forecast_reminder_is_unknown(db, age):
    if age is not None:
        forecast(db, age=age)
    play_at = NOW + timedelta(minutes=30)
    subscriptions.create_polling_subscription(
        PollingSubscriptionIn(court_id="c0", play_at=play_at), "test-device", db)
    delivered = subscriptions.check_reminders("test-device", db)["reminders"][0]
    assert delivered["risk_status"] == "unknown"
    assert delivered["risky"] is None and delivered["pop"] is None
    assert subscriptions.check_reminders("test-device", db)["reminders"] == []


def test_fresh_radar_can_warn_without_numeric_probability(db):
    nowcast(db, mm=1.0)
    # Step ending 16:00 describes the hour 15:00-16:00, not 16:00-17:00.
    assert push.rain_risk(db, "c0", NOW.replace(minute=0)) == (True, None)
    assert push.rain_risk(db, "c0", NOW.replace(hour=16, minute=0)) == (None, None)
    sub = PushSubscription(play_at=NOW, court_id="c0")
    payload = push._reminder_payload(db.get(Court, "c0"), sub, True, None)
    assert "None" not in json.dumps(payload)
    assert "radar" in payload["variants"]["en"]["body"]


def test_stale_radar_cannot_warn_or_make_unknown_dry(db):
    nowcast(db, age=NOWCAST_FRESH_SEC + 1, mm=10.0)
    assert push.rain_risk(db, "c0", NOW.replace(minute=0)) == (None, None)


def test_unknown_push_explains_missing_data(db):
    sub = PushSubscription(play_at=NOW + timedelta(minutes=30), court_id="c0")
    payload = push._reminder_payload(db.get(Court, "c0"), sub, None, None)
    assert "unknown" in payload["variants"]["en"]["body"]
    assert "无法判断" in payload["body"]
    assert "None%" not in json.dumps(payload)


@pytest.mark.parametrize("schema", [PollingSubscriptionIn, SubscriptionIn])
def test_subscription_accepts_offsets_as_instants(schema):
    body = {"court_id": "c0", "play_at": "2026-11-14T08:00:00Z"}
    if schema is SubscriptionIn:
        body["subscription"] = {"endpoint": "test", "keys": {"p256dh": "a", "auth": "b"}}
    assert schema(**body).play_at == datetime(2026, 11, 14, 16)


def test_upstream_issue_required_and_not_download_time():
    text = f"{hko_nowcast.COL_UPDATED},other\n202611141200,x\n"
    assert hko_nowcast.parse_issue_time("\ufeff" + text) == datetime(2026, 11, 14, 12)
    with pytest.raises(ValueError):
        hko_nowcast.parse_issue_time("other\nx\n")


def test_nowcast_repeat_issue_is_idempotent(db, monkeypatch):
    text = (f"{hko_nowcast.COL_UPDATED},{hko_nowcast.COL_ENDING},"
            f"{hko_nowcast.COL_LAT},{hko_nowcast.COL_LON},{hko_nowcast.COL_MM}\n"
            "202611141200,202611141230,22.28,114.19,0\n")
    class Response:
        def raise_for_status(self):
            pass
    response = Response()
    response.text = text
    monkeypatch.setattr(hko_nowcast.httpx, "get", lambda *a, **kw: response)
    assert hko_nowcast.ingest_nowcast(db) == 3
    assert hko_nowcast.ingest_nowcast(db) == 0
    assert db.query(NowcastSnapshot).count() == 3
    assert db.query(NowcastSnapshot).first().fetched_at == datetime(2026, 11, 14, 12)


@pytest.mark.parametrize("path", ["../secret.txt", "../../backend/.env", "api/not-real"])
def test_spa_cannot_escape_build_or_mask_api_errors(tmp_path, path):
    build = tmp_path / "dist"
    build.mkdir()
    with pytest.raises(HTTPException):
        _frontend_path(str(build), path)
    assert _frontend_path(str(build), "courts/c0").is_relative_to(build)


def test_fusion_does_not_turn_missing_rainfall_into_dry_steps():
    steps = [{"ending": "2026-11-14T16:00"},
             {"ending": "2026-11-14T16:00", "mm": float("nan")},
             {"ending": "2026-11-14T16:00", "mm": -1}]
    assert fusion.swirls_hour_probs(steps, NOW, 0.05) == {}
