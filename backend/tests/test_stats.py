import math

from app.services.stats import (brier_decomposition, brier_score,
                                brier_skill_score, dual_truth_divergence,
                                heidke, onset_capture, peirce, recalibrate,
                                reliability_table, shrinkage, wilson_ci)


def P(*rows):
    """rows of (prob_percent, rained) -> pair list with a fixed baseline."""
    return [(p / 100.0, r, 0.2) for p, r in rows]


# --- wilson CI ---------------------------------------------------------------

def test_wilson_known_value():
    lo, hi = wilson_ci(1, 1)
    assert abs(lo - 0.2066) < 0.001 and hi == 1.0


def test_wilson_symmetric_center():
    lo, hi = wilson_ci(5, 10)
    assert lo < 0.5 < hi
    assert abs((lo + hi) / 2 - 0.5) < 0.01


def test_wilson_invalid():
    assert wilson_ci(0, 0) is None


def test_wilson_zero_successes():
    lo, hi = wilson_ci(0, 20)
    assert lo == 0.0
    assert abs(hi - 0.161) < 0.002


# --- brier / BSS / decomposition --------------------------------------------

def test_brier_matches_manual():
    pairs = P((80, True), (80, False), (20, True), (20, False))
    # (0.8-1)^2 + (0.8-0)^2 + (0.2-1)^2 + (0.2-0)^2 = .04+.64+.64+.04
    assert abs(brier_score(pairs) - 1.36 / 4) < 1e-9


def test_bss_perfect_forecast_is_one():
    src = P((80, True), (20, False), (90, True), (10, False))
    pairs = [(1.0 if r else 0.0, r, 0.3) for _p, r, _b in src]
    assert abs(brier_skill_score(pairs) - 1.0) < 1e-9


def test_bss_climatology_forecast_is_zero():
    # forecast always says the baseline -> no skill beyond climatology
    src = P((80, True), (20, False), (90, False), (10, True))
    pairs = [(0.2, r, 0.2) for _p, r, _b in src]
    assert abs(brier_skill_score(pairs)) < 1e-9


def test_bss_bad_forecast_is_negative():
    pairs = [(0.9, False, 0.2), (0.9, False, 0.2), (0.1, True, 0.2), (0.1, True, 0.2)]
    assert brier_skill_score(pairs) < 0


def test_decomposition_identity():
    rows = [(85, True), (75, False), (60, True), (55, False), (45, True),
            (30, False), (25, False), (15, True), (10, False), (5, False),
            (90, True), (20, False), (35, True), (65, False), (50, True)]
    pairs = P(*rows)
    dec = brier_decomposition(pairs)
    assert abs(dec["check_sum"] - brier_score(pairs)) < 1e-4


def test_decomposition_base_rate():
    pairs = P((50, True), (50, True), (50, False), (50, False))
    dec = brier_decomposition(pairs)
    assert dec["base_rate"] == 0.5
    assert abs(dec["uncertainty"] - 0.25) < 1e-9


# --- reliability & recalibration --------------------------------------------

def test_reliability_binning_edges():
    pairs = P((100, True), (100, True), (0, False))
    table = reliability_table(pairs, bins=10)
    by_lo = {round(b.lo, 1): b for b in table}
    assert by_lo[0.9].n == 2 and by_lo[0.9].observed_freq == 1.0
    assert by_lo[0.0].n == 1 and by_lo[0.0].observed_freq == 0.0


def test_recalibrate_overblown_forecast():
    # forecast says 70-80% but it only rained 30% of those hours
    rows = [(75, False)] * 7 + [(75, True)] * 3 + [(15, False)] * 8 + [(15, True)] * 2
    f = recalibrate(P(*rows))
    corrected = f(0.75)
    assert 0.2 < corrected < 0.45  # pulled toward the empirical ~0.3
    assert f(0.75) < 0.75


def test_recalibrate_monotone():
    rows = [(85, True)] * 6 + [(85, False)] * 2 + [(65, True)] * 4 + [(65, False)] * 4 \
        + [(35, True)] * 2 + [(35, False)] * 6 + [(10, False)] * 9 + [(10, True)] * 1
    f = recalibrate(P(*rows))
    vals = [f(x / 100) for x in range(0, 101, 5)]
    assert all(a <= b + 1e-9 for a, b in zip(vals, vals[1:]))


def test_recalibrate_identity_without_data():
    f = recalibrate([])
    assert abs(f(0.42) - 0.42) < 1e-9


def test_recalibrate_drops_thin_bins():
    # one bin has 100 samples, one has 2 -> only the fat bin becomes a knot
    rows = [(75, False)] * 7 + [(75, True)] * 3 + [(25, True), (25, False)]
    f = recalibrate(P(*rows))
    assert 0.2 <= f(0.75) <= 0.4


# --- skill scores ------------------------------------------------------------

def test_heidke_peirce_perfect():
    assert heidke(10, 0, 0, 10) == 1.0
    assert peirce(10, 0, 0, 10) == 1.0


def test_heidke_peirce_no_skill_constant_dry():
    # always-dry forecast with rare rain: HSS zero; Peirce undefined when the
    # forecast never says "yes" (no hit or false-alarm denominator)
    assert abs(heidke(0, 2, 0, 98)) < 1e-9
    assert peirce(0, 2, 0, 98) is None


def test_peirce_worse_than_chance_negative():
    assert peirce(0, 5, 5, 0) == -1.0


# --- shrinkage ---------------------------------------------------------------

def test_shrinkage_extremes():
    assert abs(shrinkage(0, 0, 0.3) - 0.3) < 1e-9              # no data -> group
    # 100k samples: prior barely moves the estimate
    assert abs(shrinkage(70000, 100000, 0.3) - 0.7) < 1e-3
    # exactly the prior strength: halfway between court rate and group rate
    assert abs(shrinkage(100, 200, 0.2) - (100 + 200 * 0.2) / 400) < 1e-9


# --- onset & dual truth ------------------------------------------------------

def test_onset_capture():
    res = onset_capture([10, 20, 30], {10, 30, 99})
    assert res == {"onsets": 3, "captured": 2, "capture_rate": 2 / 3}
    assert onset_capture([], set())["captured"] is None


def test_overview_onset_requires_adjacent_observed_hour():
    """An onset counts only when the immediately preceding hour was observed
    dry - a gap must reset the chain, not borrow a stale previous hour."""
    import os
    os.environ.setdefault("DATABASE_URL", "sqlite://")
    from datetime import datetime, timedelta
    from app.db import Base, SessionLocal, engine
    from app.models import Court, NowcastSnapshot, Observation
    from app.services.analytics import overview
    import json

    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        db.add(Court(id="c1", name_en="T", name_tc="T", name_sc="T",
                     district_en="D", district_tc="D", lat=22.3, lon=114.2, letter="T"))
        base = datetime.now().replace(minute=0, second=0, microsecond=0) - timedelta(hours=5)

        def f3_wet(hour_idx: int) -> None:
            issued = base + timedelta(hours=hour_idx) - timedelta(minutes=90)
            ending = base + timedelta(hours=hour_idx) + timedelta(minutes=30)
            db.add(NowcastSnapshot(
                court_id="c1", fetched_at=issued,
                steps_json=json.dumps([{"ending": ending.isoformat(), "mm": 1.0}])))

        for i in range(4):
            f3_wet(i)
        # observations: dry, MISSING, rain, dry - the rain hour's previous
        # observed hour is stale-dry across the gap -> must NOT count as onset
        for i, rain in ((0, False), (2, True), (3, False)):
            db.add(Observation(court_id="c1", observed_hour=base + timedelta(hours=i),
                               station_name="S", rainfall_mm=2.0 if rain else 0.0,
                               rain=rain, fetched_at=base + timedelta(hours=i)))
        db.commit()

        result = overview(db)
        assert result["hko_f3"]["onsets"] == 0
    finally:
        db.close()
        Base.metadata.drop_all(engine)


def test_dual_truth_flags_microclimate():
    agree = [(False, False)] * 15 + [(True, True)] * 3
    diverge = [(True, False)] * 5  # users see rain, gauge dry -> 5/23 = 22%
    res = dual_truth_divergence(agree + diverge)
    assert res["n"] == 23
    assert res["microclimate"] is True
    assert res["user_rain_station_dry"] > 0.15

    low = [(True, False)] * 2 + [(False, False)] * 20  # 2/22 = 9% -> no flag
    assert dual_truth_divergence(low)["microclimate"] is False

    few = [(True, False)] * 5 + [(False, False)] * 5   # 50% but n=10 < 20
    assert dual_truth_divergence(few)["microclimate"] is False


# --- lead bucket helper ------------------------------------------------------

def test_lead_bucket_boundaries():
    from app.services.open_meteo import _lead_bucket
    assert _lead_bucket(0.5) == "l3"
    assert _lead_bucket(3.0) == "l3"
    assert _lead_bucket(3.5) == "l12"
    assert _lead_bucket(12.0) == "l12"
    assert _lead_bucket(29.9) == "l24"
    assert _lead_bucket(30.0) == "l24"
    assert _lead_bucket(50.0) == "l48"
    assert _lead_bucket(60.0) is None
