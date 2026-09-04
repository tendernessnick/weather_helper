from datetime import datetime

import pytest

from app.services import fusion


def _step(ending: str, mm: float) -> dict:
    return {"ending": ending, "mm": mm}


def test_swirls_hour_probs_buckets():
    now = datetime(2026, 9, 4, 14, 20)
    steps = [
        _step("2026-09-04T14:30", 0.2),  # ongoing bucket 14:00
        _step("2026-09-04T15:00", 0.0),  # ends on the hour -> closes 14:00
        _step("2026-09-04T15:30", 0.2),  # bucket 15:00
        _step("2026-09-04T16:00", 0.0),  # bucket 15:00, dry
        _step("2026-09-04T13:00", 5.0),  # already fallen, ignored
    ]
    probs = fusion.swirls_hour_probs(steps, now, threshold_mm=0.05)
    # bucket 14:00 = [wet 14:30, dry 15:00]; bucket 15:00 = [wet 15:30, dry 16:00]
    assert probs[datetime(2026, 9, 4, 14, 0)] == 50.0
    assert probs[datetime(2026, 9, 4, 15, 0)] == 50.0
    assert datetime(2026, 9, 4, 16, 0) not in probs


def test_fuse_weights():
    assert fusion.fuse(50.0, 40.0, None) == pytest.approx(0.7 * 50 + 0.3 * 40)
    assert fusion.fuse(None, 40.0, 10.0) == pytest.approx(0.7 * 40 + 0.3 * 10)
    assert fusion.fuse(None, 40.0, None) == 40.0


def test_fused_overlay():
    now = datetime(2026, 9, 4, 14, 20)
    steps = [_step("2026-09-04T15:30", 0.2)]  # only hour 15:00 covered
    hourly = [{"hour": datetime(2026, 9, 4, h, 0), "corrected_pop": 40,
               "climatology_pop": 20} for h in range(15, 22)]

    out = fusion.fused_overlay(steps, fetched_at=now, hourly=hourly,
                               now=now, threshold_mm=0.05)
    assert len(out) == fusion.FUSE_HOURS  # extra input hours dropped
    assert out[0] == (round(0.7 * 100 + 0.3 * 40), True)   # radar participates
    assert out[1] == (round(0.7 * 40 + 0.3 * 20), False)   # climatology blend

    # Stale snapshot: radar must not participate even though steps exist.
    stale = fusion.fused_overlay(steps, fetched_at=datetime(2026, 9, 4, 13, 0),
                                 hourly=hourly[:1], now=now, threshold_mm=0.05)
    assert stale[0] == (round(0.7 * 40 + 0.3 * 20), False)


def test_fused_overlay_accepts_iso_string_hours():
    """The API layer builds hourly items with ISO strings - the overlay must
    still match them against the datetime-keyed SWIRLS buckets."""
    now = datetime(2026, 9, 4, 14, 20)
    steps = [_step("2026-09-04T15:30", 0.2)]
    hourly = [{"hour": f"2026-09-04T{h:02d}:00:00", "corrected_pop": 40,
               "climatology_pop": 20} for h in range(15, 18)]
    out = fusion.fused_overlay(steps, fetched_at=now, hourly=hourly,
                               now=now, threshold_mm=0.05)
    assert out[0] == (round(0.7 * 100 + 0.3 * 40), True)
    assert out[1] == (round(0.7 * 40 + 0.3 * 20), False)
