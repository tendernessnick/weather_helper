import os
from datetime import datetime, timedelta

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite://")

from app.config import HK_TZ  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.models import Climatology, Court, ForecastLead, ForecastSnapshot, Persistence  # noqa: E402
from app.services.climate import Aggregates  # noqa: E402
from app.services.open_meteo import _upsert_court  # noqa: E402

NOW = datetime.now(HK_TZ).replace(tzinfo=None, minute=5, second=0, microsecond=0)


@pytest.fixture()
def db():
    Base.metadata.create_all(engine)
    session = SessionLocal()
    yield session
    session.close()
    Base.metadata.drop_all(engine)


def _hourly(probs, first_offset_hours=1.0):
    """Synthetic hourly payload; targets start NOW+first_offset (top of hour)."""
    start = (NOW + timedelta(hours=first_offset_hours)).replace(minute=0)
    return {
        "time": [start + timedelta(hours=i) for i in range(len(probs))],
        "precipitation_probability": list(probs),
        "precipitation": [0.0] * len(probs),
        "weather_code": [0] * len(probs),
        "wind_speed_10m": [0.0] * len(probs),
    }


def test_lead_buckets_first_entry_frozen(db):
    # first target lands at NOW+1.5h rounded down = next clock hour (minute=5
    # in NOW guards hour-boundary races); leads 0.9,1.9,2.9 -> l3; 3.9..5.9 -> l12
    h1 = _hourly([10, 20, 30, 40, 50, 60], first_offset_hours=1.5)
    n = _upsert_court(db, "c1", h1, fetched_at=NOW)
    db.flush()
    assert n == 6
    leads = db.query(ForecastLead).order_by(ForecastLead.target_hour).all()
    assert len(leads) == 6
    assert {l.lead_bucket for l in leads} == {"l3", "l12"}
    frozen = {(l.target_hour, l.lead_bucket): l.precip_prob for l in leads}

    # next fetch an hour later with different probs: snapshots update to the
    # new values, existing lead rows keep the values first seen in their bucket
    h2 = _hourly([90, 80, 70, 60, 50, 40], first_offset_hours=1.5)
    _upsert_court(db, "c1", h2, fetched_at=NOW + timedelta(hours=1))
    db.flush()
    snaps = db.query(ForecastSnapshot).order_by(ForecastSnapshot.target_hour).all()
    assert [s.precip_prob for s in snaps] == [90, 80, 70, 60, 50, 40]

    for (target, bucket), prob in frozen.items():
        row = db.query(ForecastLead).filter_by(
            court_id="c1", target_hour=target, lead_bucket=bucket).one()
        assert row.precip_prob == prob


def test_climate_aggregates_counts(db):
    agg = Aggregates()
    # 2026-06-01 10:00 onwards: dry, dry, dry, 1.5mm, 0.3mm(=dry at the
    # 0.5mm climate threshold), dry
    base = datetime(2026, 6, 1, 10)
    times = [(base + timedelta(hours=i)).isoformat() for i in range(6)]
    mms = [0.0, 0.0, 0.0, 1.5, 0.3, 0.0]
    agg.feed(times, mms)

    # climatology: month=6 hour pairs
    assert agg.clim[(6, 10)] == [1, 0]
    assert agg.clim[(6, 13)] == [1, 1]
    assert agg.clim[(6, 14)] == [1, 0]  # 0.3mm below climate threshold
    assert agg.clim[(6, 15)] == [1, 0]

    # transitions: d->d, d->d, d->w, w->d, d->d  => dd=3, dw=1, ww=0, wd=1
    ww, wd, dw, dd = agg.trans[6]
    assert (ww, wd, dw, dd) == (0, 1, 1, 3)

    # survival: dry starts at hours 0,1,2,4 (hour5 lacks a next hour)
    #   hour0: L1 dry ok, L2 dry ok, L3 blocked by wet hour3
    #   hour1: L1 dry ok, L2 blocked by wet hour3
    #   hour2: L1 window wet -> base counts, survival does not
    #   hour4: L1 dry ok, L2 out of range
    assert agg.surv_base[6] == 4
    assert agg.surv_ok[6][1] == 3
    assert agg.surv_ok[6][2] == 1
    assert 3 not in agg.surv_ok[6]


def test_climate_feed_skips_gaps(db):
    agg = Aggregates()
    base = datetime(2026, 7, 2, 8)
    times = [(base + timedelta(hours=i)).isoformat() for i in range(4)]
    agg.feed(times, [0.0, None, 0.0, 2.0])
    # missing hour 9: no samples, no transitions across it
    assert (7, 9) not in agg.clim
    ww, wd, dw, dd = agg.trans[7]
    assert (ww, wd, dw, dd) == (0, 0, 1, 0)  # only hour10 dry -> hour11 wet
    # survival: hour8 dry start blocked by the None gap; hour10 dry start has
    # an observed (wet) next hour -> one eligible start, zero survivals
    assert agg.surv_base.get(7, 0) == 1
    assert agg.surv_ok.get(7, {}).get(1, 0) == 0


def test_climate_save_accumulates(db):
    db.add(Court(id="c1", name_en="T", name_tc="T", name_sc="T",
                 district_en="D", district_tc="D", lat=22.3, lon=114.2, letter="T"))
    db.commit()

    agg = Aggregates()
    base = datetime(2026, 6, 1, 10)
    agg.feed([(base + timedelta(hours=i)).isoformat() for i in range(4)],
             [0.0, 0.0, 1.0, 0.0])
    agg.save(db, "c1")
    agg2 = Aggregates()
    agg2.feed([(base + timedelta(days=365, hours=i)).isoformat() for i in range(4)],
              [0.0, 1.0, 1.0, 0.0])
    agg2.save(db, "c1")

    row = db.query(Climatology).filter_by(court_id="c1", month=6, hour=10).first()
    assert row.samples == 2 and row.rain_count == 0
    persist = db.query(Persistence).filter_by(court_id="c1", month=6).first()
    ww, wd, dw, dd = persist.wet_to_wet, persist.wet_to_dry, persist.dry_to_wet, persist.dry_to_dry
    # run1: dd=1,dw=1,wd=1 ; run2: dw=1,ww=1,wd=1
    assert (ww, wd, dw, dd) == (1, 2, 2, 1)
