"""DB assembly for the statistics APIs: builds pair lists from snapshots,
observations, user reports and climatology, then runs the pure stats on them.

Pair format everywhere: (prob_0to1, outcome_bool, baseline_prob_or_None).
"""
import json
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import floor_hour, hk_now, settings
from ..models import (Climatology, Court, ForecastLead, ForecastSnapshot,
                      NowcastSnapshot, Observation, Persistence, UserReport)
from ..services import stats
from .verification import _f3_pairs, _open_meteo_pairs, _user_outcomes

# Decision zones on the corrected probability.
ZONE_GREEN_MAX = 0.30
ZONE_AMBER_MAX = 0.60


def _climatology_lookup(db: Session) -> dict[tuple[str, int, int], float]:
    """(court_id, month, hour) -> historical rain frequency."""
    rows = db.execute(
        select(Climatology.court_id, Climatology.month, Climatology.hour,
               Climatology.rain_count, Climatology.samples)
    ).all()
    out = {}
    for court_id, month, hour, rain, samples in rows:
        if samples:
            out[(court_id, month, hour)] = rain / samples
    return out


def _station_outcomes(db: Session, since) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for court_id, hour, rain in db.execute(
        select(Observation.court_id, Observation.observed_hour, Observation.rain)
        .where(Observation.observed_hour >= since)
    ):
        out.setdefault(court_id, {})[hour] = bool(rain)
    return out


def _om_pairs_all(db: Session, since) -> dict[str, list]:
    """Open-Meteo (prob, outcome, climatology) pairs per court."""
    clim = _climatology_lookup(db)
    outcomes = _station_outcomes(db, since)
    pairs: dict[str, list] = {}
    for court_id, target, prob in db.execute(
        select(ForecastSnapshot.court_id, ForecastSnapshot.target_hour,
               ForecastSnapshot.precip_prob)
        .where(ForecastSnapshot.source == "open_meteo",
               ForecastSnapshot.target_hour >= since)
    ):
        outcome = outcomes.get(court_id, {}).get(target)
        if outcome is None:
            continue
        baseline = clim.get((court_id, target.month, target.hour))
        pairs.setdefault(court_id, []).append((prob / 100.0, outcome, baseline))
    return pairs


def _iter_f3(db: Session, since):
    for court_id in {c for (c,) in db.execute(select(Court.id))}:
        for hour, rain, _p in _f3_pairs(db, court_id, since):
            yield court_id, hour, rain, _p


def _confusion(pairs, threshold: float) -> dict:
    h = m = fa = cn = 0
    for p, o, _b in pairs:
        rain_fcst = p >= threshold
        if rain_fcst and o:
            h += 1
        elif not rain_fcst and o:
            m += 1
        elif rain_fcst and not o:
            fa += 1
        else:
            cn += 1
    return {"hits": h, "misses": m, "false_alarms": fa, "correct_negatives": cn}


def _rates(conf: dict) -> dict:
    h, m, fa, cn = (conf["hits"], conf["misses"],
                    conf["false_alarms"], conf["correct_negatives"])
    n = h + m + fa + cn
    return {
        "n": n,
        "accuracy": round((h + cn) / n, 3) if n else None,
        "pod": round(h / (h + m), 3) if h + m else None,
        "pod_ci": stats.wilson_ci(h, h + m),
        "far": round(fa / (h + fa), 3) if h + fa else None,
        "far_ci": stats.wilson_ci(fa, h + fa),
        "heidke": stats.heidke(h, m, fa, cn),
        "peirce": stats.peirce(h, m, fa, cn),
        **conf,
    }


# ---------------------------------------------------------------- overview ---

def overview(db: Session) -> dict:
    since = hk_now() - timedelta(days=settings.window_days)
    om = _om_pairs_all(db, since)
    pooled = [p for court_pairs in om.values() for p in court_pairs]

    conf = _confusion(pooled, settings.pop_rain_threshold / 100.0)
    result = {
        "window_days": settings.window_days,
        "open_meteo": {
            "n": len(pooled),
            "brier": stats.brier_score(pooled),
            "bss": stats.brier_skill_score(pooled),
            "decomposition": stats.brier_decomposition(pooled),
            "reliability": [
                {"lo": b.lo, "hi": b.hi, "n": b.n,
                 "mean_forecast": round(b.mean_forecast, 3),
                 "observed_freq": round(b.observed_freq, 3),
                 "ci": b.ci and [round(b.ci[0], 3), round(b.ci[1], 3)]}
                for b in stats.reliability_table(pooled)
            ],
            **_rates(conf),
        },
    }

    # F3: deterministic nowcast -> binary verification only (no Brier/BSS)
    f3_hours: dict[str, dict] = {}
    for court_id, hour, rain, _p in _iter_f3(db, since):
        f3_hours.setdefault(court_id, {})[hour] = rain
    outcomes = _station_outcomes(db, since)
    conf3 = {"hits": 0, "misses": 0, "false_alarms": 0, "correct_negatives": 0}
    onsets_total = captured = 0
    for court_id, hours in f3_hours.items():
        court_obs = outcomes.get(court_id, {})
        prev = None
        for hour in sorted(hours):
            o = court_obs.get(hour)
            if o is None:
                prev = None  # observation gap: "previous hour" must be adjacent
                continue
            fcst = hours[hour]
            key = ("hits" if fcst else "misses") if o else \
                  ("false_alarms" if fcst else "correct_negatives")
            conf3[key] += 1
            # onset: immediately preceding observed hour dry, this hour raining
            if o and prev is False:
                onsets_total += 1
                if fcst:
                    captured += 1
            prev = o
    result["hko_f3"] = {
        **_rates(conf3),
        "onsets": onsets_total,
        "onset_capture_rate": round(captured / onsets_total, 3) if onsets_total else None,
    }
    return result


# --------------------------------------------------------------- lead decay ---

def lead_decay(db: Session) -> dict:
    since = hk_now() - timedelta(days=settings.window_days)
    clim = _climatology_lookup(db)
    outcomes = _station_outcomes(db, since)
    rows = db.execute(
        select(ForecastLead.court_id, ForecastLead.lead_bucket,
               ForecastLead.target_hour, ForecastLead.precip_prob)
        .where(ForecastLead.target_hour >= since)
    ).all()

    buckets: dict[str, list] = {}
    for court_id, bucket, target, prob in rows:
        o = outcomes.get(court_id, {}).get(target)
        if o is None:
            continue
        baseline = clim.get((court_id, target.month, target.hour))
        buckets.setdefault(bucket, []).append((prob / 100.0, o, baseline))

    out = {}
    for bucket in ("l3", "l12", "l24", "l48"):
        pairs = buckets.get(bucket, [])
        conf = _confusion(pairs, settings.pop_rain_threshold / 100.0)
        out[bucket] = {
            "n": len(pairs),
            "brier": stats.brier_score(pairs),
            "bss": stats.brier_skill_score(pairs),
            **_rates(conf),
            "accumulating": len(pairs) < settings.min_samples,
        }
    return out


# ------------------------------------------------------------ hourly profile ---

def hourly_profile(db: Session) -> dict:
    since = hk_now() - timedelta(days=settings.window_days)
    threshold = settings.pop_rain_threshold / 100.0

    hours: dict[int, dict[str, int]] = {h: {"rain": 0, "missed": 0, "fa": 0}
                                        for h in range(24)}
    outcomes = _station_outcomes(db, since)
    for court_id, target, prob in db.execute(
        select(ForecastSnapshot.court_id, ForecastSnapshot.target_hour,
               ForecastSnapshot.precip_prob)
        .where(ForecastSnapshot.source == "open_meteo",
               ForecastSnapshot.target_hour >= since)
    ):
        o = outcomes.get(court_id, {}).get(target)
        if o is None:
            continue
        cell = hours[target.hour]
        flagged = prob / 100.0 >= threshold
        if o:
            cell["rain"] += 1
            if not flagged:
                cell["missed"] += 1
        elif flagged:
            cell["fa"] += 1

    profile = []
    for h in range(24):
        cell = hours[h]
        miss_rate = cell["missed"] / cell["rain"] if cell["rain"] else None
        profile.append({
            "hour": h,
            "rain_events": cell["rain"],
            "miss_rate": round(miss_rate, 3) if miss_rate is not None else None,
            "miss_ci": stats.wilson_ci(cell["missed"], cell["rain"]),
            "false_alarms": cell["fa"],
        })
    return {"threshold_pct": settings.pop_rain_threshold, "profile": profile}


# ---------------------------------------------------------- courts ranking ---

def courts_ranking(db: Session) -> dict:
    since = hk_now() - timedelta(days=settings.window_days)
    om = _om_pairs_all(db, since)
    threshold = settings.pop_rain_threshold / 100.0
    courts = {c.id: c for c in db.query(Court).all()}

    # pooled group rate for shrinkage
    pooled_conf = _confusion([p for v in om.values() for p in v], threshold)
    pooled_n = sum(pooled_conf.values())
    group_rate = (pooled_conf["hits"] + pooled_conf["correct_negatives"]) / pooled_n \
        if pooled_n else None

    # dual-truth divergence per court (microclimate flag)
    divergence = {}
    station_all = _station_outcomes(db, since)
    for court_id in om:
        user = _user_outcomes(db, court_id, since)
        station = station_all.get(court_id, {})
        both = [(user[h], station[h]) for h in user if h in station]
        if both:
            divergence[court_id] = stats.dual_truth_divergence(both)

    rows = []
    for court_id, pairs in om.items():
        conf = _confusion(pairs, threshold)
        n = sum(conf.values())
        if n == 0:
            continue
        k = conf["hits"] + conf["correct_negatives"]
        raw = k / n
        shrunk = stats.shrinkage(k, n, group_rate) if group_rate is not None else raw
        ci = stats.wilson_ci(k, n)
        court = courts.get(court_id)
        rows.append({
            "court_id": court_id,
            "name_sc": court.name_sc if court else court_id,
            "district_tc": court.district_tc if court else "",
            "n": n,
            "raw_accuracy": round(raw, 3),
            "shrunk_accuracy": round(shrunk, 3),
            "ci": ci and [round(ci[0], 3), round(ci[1], 3)],
            "misses": conf["misses"],
            "false_alarms": conf["false_alarms"],
            "microclimate": divergence.get(court_id, {}).get("microclimate", False),
        })
    rows.sort(key=lambda r: r["shrunk_accuracy"], reverse=True)
    return {"group_rate": group_rate and round(group_rate, 3), "courts": rows}


# ------------------------------------------------------- court calibration ---

_CALIB_TTL = timedelta(minutes=10)
_calib_cache: dict = {"f": None, "n": 0, "built": None}


def pooled_calibration(db: Session):
    """Recalibration function built from all courts' pairs (10-min TTL)."""
    now = hk_now()
    if _calib_cache["f"] is not None and now - _calib_cache["built"] < _CALIB_TTL:
        return _calib_cache["f"], _calib_cache["n"]
    since = now - timedelta(days=settings.window_days)
    pooled = [p for v in _om_pairs_all(db, since).values() for p in v]
    f = stats.recalibrate(pooled)
    _calib_cache.update(f=f, n=len(pooled), built=now)
    return f, len(pooled)


def court_calibration(db: Session, court_id: str) -> dict:
    since = hk_now() - timedelta(days=settings.window_days)
    court_pairs = _om_pairs_all(db, since).get(court_id, [])
    pooled_f, pooled_n = pooled_calibration(db)

    basis = "pooled"
    f = pooled_f
    n = pooled_n
    rains = sum(1 for _p, o, _b in court_pairs if o)
    # court-specific mapping only with enough wet events to trust bins
    if len(court_pairs) >= settings.min_samples * 2 and rains >= 30:
        f = stats.recalibrate(court_pairs)
        basis = "court"
        n = len(court_pairs)

    # dual truth for this court
    user = _user_outcomes(db, court_id, since)
    station = _station_outcomes(db, since).get(court_id, {})
    both = [(user[h], station[h]) for h in user if h in station]
    divergence = stats.dual_truth_divergence(both) if both else {"n": 0}

    return {
        "basis": basis,
        "n": n,
        "mapping": [{"official_pct": p, "corrected": round(f(p / 100.0), 3)}
                    for p in range(10, 100, 10)],
        "divergence": divergence,
        "zones": {"green_max": ZONE_GREEN_MAX, "amber_max": ZONE_AMBER_MAX},
    }


# ------------------------------------------------------------- persistence ---

def persistence_card(db: Session, court_id: str) -> dict | None:
    month = hk_now().month
    row = db.query(Persistence).filter(
        Persistence.court_id == court_id, Persistence.month == month).first()
    if row is None:
        return None
    wet = row.wet_to_wet + row.wet_to_dry
    dry = row.dry_to_wet + row.dry_to_dry
    surv = json.loads(row.survival_json or "{}")
    base = surv.get("_base", 0)
    survival = {L: round(surv.get(str(L), 0) / base, 3)
                for L in (1, 2, 3, 4) if base}
    return {
        "month": month,
        "p_still_wet_next_hour": round(row.wet_to_wet / wet, 3) if wet else None,
        "p_dry_turns_wet_next_hour": round(row.dry_to_wet / dry, 3) if dry else None,
        "dry_survival_1_to_4h": survival,
        "samples": wet + dry,
        "grid_note": "ERA5 十年档案 · ≥0.5mm 口径 · 区域网格级(~11km)，同区球场数值相同",
    }


def decision_zone(corrected: float) -> str:
    if corrected <= ZONE_GREEN_MAX:
        return "go"
    if corrected <= ZONE_AMBER_MAX:
        return "edge"
    return "no"
