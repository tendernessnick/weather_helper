import json
import os
from datetime import datetime, timedelta

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite://")

from app.config import HK_TZ  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.models import (Court, ForecastSnapshot, NowcastSnapshot,  # noqa: E402
                        Observation, UserReport)
from app.services.verification import (all_court_summaries,  # noqa: E402
                                       compute_court_scores)

NOW = datetime.now(HK_TZ).replace(tzinfo=None, minute=0, second=0, microsecond=0)


@pytest.fixture()
def db():
    Base.metadata.create_all(engine)
    session = SessionLocal()
    session.add(Court(id="c1", name_en="Test", name_tc="測試", name_sc="测试",
                      district_en="X", district_tc="X", lat=22.28, lon=114.19,
                      letter="T"))
    yield session
    session.close()
    Base.metadata.drop_all(engine)


def _seed_pairs(db):
    """Forecast vs reality over 4 hours:

    hour  prob  f3_rain  station_rain  user_rain
    H-4    70    yes      yes          -
    H-3    80    yes      no           no
    H-2    20    no       yes          yes
    H-1    10    no       no           -
    """
    hours = [NOW - timedelta(hours=i) for i in (4, 3, 2, 1)]
    pops = [70, 80, 20, 10]
    station_rains = [True, False, True, False]
    user_rains = [None, False, True, None]

    for hour, pop in zip(hours, pops):
        db.add(ForecastSnapshot(court_id="c1", source="open_meteo", target_hour=hour,
                                precip_prob=pop, precip_mm=0.0,
                                fetched_at=hour - timedelta(hours=1)))

    # F3 snapshots issued 90 min before each hour, one wet step inside the hour
    # for hours 0 and 1 only.
    f3_wet = [True, True, False, False]
    for hour, wet in zip(hours, f3_wet):
        issued = hour - timedelta(minutes=90)
        ending = hour + timedelta(minutes=30)
        steps = [{"ending": ending.isoformat(), "mm": 1.2 if wet else 0.0}]
        db.add(NowcastSnapshot(court_id="c1", fetched_at=issued,
                               steps_json=json.dumps(steps)))

    for hour, rain in zip(hours, station_rains):
        db.add(Observation(court_id="c1", observed_hour=hour, station_name="S",
                           rainfall_mm=2.0 if rain else 0.0, rain=rain,
                           fetched_at=hour + timedelta(minutes=15)))

    for hour, rain in zip(hours, user_rains):
        if rain is None:
            continue
        db.add(UserReport(court_id="c1", device_id="dev-1",
                          was_raining=rain, intensity="light" if rain else "none",
                          lat=22.28, lon=114.19, status="accepted",
                          created_at=hour + timedelta(minutes=10)))
    db.commit()


def test_open_meteo_vs_station_metrics(db):
    _seed_pairs(db)
    scores = compute_court_scores(db, "c1")
    om = scores["open_meteo"]["station"]

    # pop>=50 -> forecast rain for hours 0,1; station rain for hours 0,2.
    assert om["n"] == 4
    assert om["hits"] == 1            # H-4: forecast rain, rained
    assert om["false_alarms"] == 1    # H-3: forecast rain, dry
    assert om["misses"] == 1          # H-2: forecast dry, rained
    assert om["correct_negatives"] == 1
    assert om["accuracy"] == 0.5
    assert om["pod"] == 0.5
    assert om["far"] == 0.5
    # Brier: (0.7-1)^2 + (0.8-0)^2 + (0.2-1)^2 + (0.1-0)^2 = .09+.64+.64+.01 = 1.38/4
    assert om["brier"] == 0.345


def test_open_meteo_vs_user_metrics(db):
    _seed_pairs(db)
    om_user = compute_court_scores(db, "c1")["open_meteo"]["user"]
    # Only 2 hours have user outcomes: H-3 (dry) and H-2 (rain).
    assert om_user["n"] == 2
    assert om_user["false_alarms"] == 1
    assert om_user["misses"] == 1


def test_f3_vs_station_metrics(db):
    _seed_pairs(db)
    f3 = compute_court_scores(db, "c1")["hko_f3"]["station"]
    # F3 said rain for hours 0,1; station rained hours 0,2 -> same confusion as OM.
    assert f3["n"] == 4
    assert f3["hits"] == 1
    assert f3["false_alarms"] == 1
    assert f3["misses"] == 1
    assert f3["correct_negatives"] == 1
    assert f3["brier"] is None  # deterministic source, no probability to score


def test_f3_uses_freshest_snapshot_before_hour(db):
    """A later snapshot issued before the hour must override an earlier one."""
    hour = NOW - timedelta(hours=1)
    early = hour - timedelta(minutes=110)
    late = hour - timedelta(minutes=20)
    steps_wet = json.dumps([{"ending": (hour + timedelta(minutes=30)).isoformat(),
                             "mm": 2.0}])
    steps_dry = json.dumps([{"ending": (hour + timedelta(minutes=30)).isoformat(),
                             "mm": 0.0}])
    db.add(NowcastSnapshot(court_id="c1", fetched_at=early, steps_json=steps_wet))
    db.add(NowcastSnapshot(court_id="c1", fetched_at=late, steps_json=steps_dry))
    db.add(Observation(court_id="c1", observed_hour=hour, station_name="S",
                       rainfall_mm=0.0, rain=False, fetched_at=hour))
    db.commit()

    f3 = compute_court_scores(db, "c1")["hko_f3"]["station"]
    # Dry nowcast + dry station -> correct negative, not a false alarm.
    assert f3["correct_negatives"] == 1
    assert f3["false_alarms"] == 0


def test_all_court_summaries(db):
    _seed_pairs(db)
    summary = all_court_summaries(db)["c1"]
    assert summary["n"] == 4
    assert summary["accuracy"] == 0.5
    assert summary["sufficient_samples"] is False  # below MIN_SAMPLES=20


def test_empty_court_is_all_zeros(db):
    scores = compute_court_scores(db, "c1")
    assert scores["open_meteo"]["station"]["n"] == 0
    assert scores["open_meteo"]["station"]["accuracy"] is None
    assert all_court_summaries(db) == {}
