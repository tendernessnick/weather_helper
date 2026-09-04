"""DB assembly for the statistics APIs: builds pair lists from snapshots,
observations, user reports and climatology, then runs the pure stats on them.

Pair format everywhere: (prob_0to1, outcome_bool, baseline_prob_or_None).
"""
import json
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import floor_hour, hk_now, settings
from ..models import (Climatology, Court, ForecastLead, ForecastSnapshot,
                      NowcastSnapshot, Observation, Persistence, UserReport)
from ..services import stats
from .verification import _user_outcomes, user_outcomes_all

# Decision zones on the corrected probability.
ZONE_GREEN_MAX = 0.30
ZONE_AMBER_MAX = 0.60


def _climatology_lookup(db: Session, court_id: str | None = None) -> dict[tuple[str, int, int], float]:
    """(court_id, month, hour) -> historical rain frequency. Optionally one court."""
    query = select(Climatology.court_id, Climatology.month, Climatology.hour,
                   Climatology.rain_count, Climatology.samples)
    if court_id is not None:
        query = query.where(Climatology.court_id == court_id)
    out = {}
    for cid, month, hour, rain, samples in db.execute(query).all():
        if samples:
            out[(cid, month, hour)] = rain / samples
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


def _om_pairs_court(db: Session, court_id: str, since) -> list:
    """Open-Meteo (prob, outcome, climatology) pairs for ONE court - the
    detail-page calibration path; skips _om_pairs_all's full-city scan."""
    clim = _climatology_lookup(db, court_id)
    outcomes = _station_outcomes(db, since).get(court_id, {})
    pairs = []
    for target, prob in db.execute(
        select(ForecastSnapshot.target_hour, ForecastSnapshot.precip_prob)
        .where(ForecastSnapshot.court_id == court_id,
               ForecastSnapshot.source == "open_meteo",
               ForecastSnapshot.target_hour >= since)
    ):
        outcome = outcomes.get(target)
        if outcome is None:
            continue
        baseline = clim.get((court_id, target.month, target.hour))
        pairs.append((prob / 100.0, outcome, baseline))
    return pairs


def _f3_hour_flags(db: Session, since) -> dict[str, dict[datetime, bool]]:
    """Per court x hour rain call from F3 snapshots, freshest issue before the
    hour. One scan shared by overview() and disagreement(); replaces the old
    per-court loop (57 queries + the same rows parsed twice per request)."""
    per_hour: dict[str, dict[datetime, tuple[datetime, bool]]] = {}
    for court_id, fetched_at, steps_json in db.execute(
        select(NowcastSnapshot.court_id, NowcastSnapshot.fetched_at,
               NowcastSnapshot.steps_json)
        .where(NowcastSnapshot.fetched_at >= since)
    ):
        hourly: dict[datetime, bool] = {}
        for step in json.loads(steps_json):
            hour = floor_hour(datetime.fromisoformat(step["ending"]))
            if hour <= fetched_at:
                continue
            rain = step["mm"] >= settings.nowcast_mm_threshold
            hourly[hour] = hourly.get(hour, False) or rain
        for hour, rain in hourly.items():
            prev = per_hour.setdefault(court_id, {}).get(hour)
            if prev is None or fetched_at > prev[0]:
                per_hour[court_id][hour] = (fetched_at, rain)
    return {c: {h: rain for h, (_f, rain) in hours.items()}
            for c, hours in per_hour.items()}


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

# Full-window stats are expensive at 30-day data volume (tens of thousands of
# nowcast snapshots JSON-parsed per call); 10 minutes of staleness is fine for
# a retrospective ledger. Same TTL pattern as pooled_calibration below.
_STATS_TTL = timedelta(minutes=10)
_overview_cache: dict = {"data": None, "built": None}
_disagree_cache: dict = {"data": None, "built": None}
_ranking_cache: dict = {"data": None, "built": None}


def overview(db: Session) -> dict:
    now = hk_now()
    if _overview_cache["data"] is not None and now - _overview_cache["built"] < _STATS_TTL:
        return _overview_cache["data"]
    since = now - timedelta(days=settings.window_days)
    om = _om_pairs_all(db, since)
    pooled = [p for court_pairs in om.values() for p in court_pairs]

    conf = _confusion(pooled, settings.pop_rain_threshold / 100.0)
    brier = stats.brier_score(pooled)
    bss = stats.brier_skill_score(pooled)
    result = {
        "window_days": settings.window_days,
        "open_meteo": {
            "n": len(pooled),
            "brier": round(brier, 4) if brier is not None else None,
            "bss": round(bss, 4) if bss is not None else None,
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
    f3_hours = _f3_hour_flags(db, since)
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
    _overview_cache.update(data=result, built=now)
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
        brier = stats.brier_score(pairs)
        bss = stats.brier_skill_score(pairs)
        out[bucket] = {
            "n": len(pairs),
            "brier": round(brier, 4) if brier is not None else None,
            "bss": round(bss, 4) if bss is not None else None,
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
    now = hk_now()
    if _ranking_cache["data"] is not None and now - _ranking_cache["built"] < _STATS_TTL:
        return _ranking_cache["data"]
    since = now - timedelta(days=settings.window_days)
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
    users_all = user_outcomes_all(db, since)
    for court_id in om:
        user = users_all.get(court_id, {})
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
            "name_tc": court.name_tc if court else "",
            "name_en": court.name_en if court else "",
            "n": n,
            "raw_accuracy": round(raw, 3),
            "shrunk_accuracy": round(shrunk, 3),
            "ci": ci and [round(ci[0], 3), round(ci[1], 3)],
            "misses": conf["misses"],
            "false_alarms": conf["false_alarms"],
            "microclimate": divergence.get(court_id, {}).get("microclimate", False),
        })
    rows.sort(key=lambda r: r["shrunk_accuracy"], reverse=True)
    result = {"group_rate": group_rate and round(group_rate, 3), "courts": rows}
    _ranking_cache.update(data=result, built=now)
    return result


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
    court_pairs = _om_pairs_court(db, court_id, since)
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


# ---------------------------------------------------------- quality trend ---

def quality_trend(db: Session, days: int = 90) -> dict:
    """Daily Open-Meteo accuracy/Brier over the window, plus a 7-day pooled
    rolling smooth - answers "is the forecast getting better or worse lately"."""
    since = hk_now() - timedelta(days=days)
    threshold = settings.pop_rain_threshold / 100.0
    outcomes = _station_outcomes(db, since)

    per_day: dict[str, list[tuple[float, bool]]] = {}
    for court_id, target, prob in db.execute(
        select(ForecastSnapshot.court_id, ForecastSnapshot.target_hour,
               ForecastSnapshot.precip_prob)
        .where(ForecastSnapshot.source == "open_meteo",
               ForecastSnapshot.target_hour >= since)
    ):
        outcome = outcomes.get(court_id, {}).get(target)
        if outcome is None:
            continue
        per_day.setdefault(target.date().isoformat(), []).append((prob / 100.0, outcome))

    def _rates(pairs: list[tuple[float, bool]]) -> tuple[int, float, float]:
        n = len(pairs)
        acc = sum(1 for p, o in pairs if (p >= threshold) == o) / n
        brier = sum((p - (1.0 if o else 0.0)) ** 2 for p, o in pairs) / n
        return n, acc, brier

    dates = sorted(per_day)
    series = []
    for i, d in enumerate(dates):
        n, acc, brier = _rates(per_day[d])
        window = [pr for wd in dates[max(0, i - 6):i + 1] for pr in per_day[wd]]
        wn, wacc, wbrier = _rates(window)
        series.append({
            "date": d, "n": n,
            "accuracy": round(acc, 3), "brier": round(brier, 3),
            "n_7d": wn, "acc_7d": round(wacc, 3), "brier_7d": round(wbrier, 3),
        })

    total = [pr for d in dates for pr in per_day[d]]
    _tn, tacc, _tb = _rates(total)
    return {
        "days": days,
        "window_n": _tn,
        "window_accuracy": round(tacc, 3),
        "series": series,
    }


# ------------------------------------------------------------- dry ranking ---

def dry_ranking(db: Session, month: int = 0) -> dict:
    """Historical rain frequency per court from the 10y ERA5 archive
    (month 0 = whole year). ERA5 is an ~11km grid, so same-area courts tie."""
    query = (db.query(Climatology.court_id,
                      func.sum(Climatology.rain_count), func.sum(Climatology.samples)))
    if month:
        query = query.filter(Climatology.month == month)
    rows = query.group_by(Climatology.court_id).all()

    courts = {c.id: c for c in db.query(Court).all()}
    total_rain = sum(r for _c, r, _s in rows)
    total_samples = sum(s for _c, _r, s in rows)
    city_avg = total_rain / total_samples if total_samples else None

    out = []
    for court_id, rain, samples in rows:
        court = courts.get(court_id)
        if court is None or not samples:
            continue
        pct = rain / samples * 100
        out.append({
            "court_id": court_id,
            "name_sc": court.name_sc, "name_tc": court.name_tc,
            "name_en": court.name_en,
            "district_tc": court.district_tc, "district_en": court.district_en,
            "rain_pct": round(pct, 1),
            "diff_pct": round(pct - city_avg * 100, 1) if city_avg is not None else None,
        })
    out.sort(key=lambda r: r["rain_pct"])
    return {
        "month": month,
        "city_avg_pct": round(city_avg * 100, 1) if city_avg is not None else None,
        "courts": out,
    }


# ------------------------------------------------------------ disagreement ---

def disagreement(db: Session) -> dict:
    """When Open-Meteo and the F3 nowcast call the same court-hour differently,
    who matches the gauge? Agreement accuracy is the baseline to beat."""
    now = hk_now()
    if _disagree_cache["data"] is not None and now - _disagree_cache["built"] < _STATS_TTL:
        return _disagree_cache["data"]
    since = now - timedelta(days=settings.window_days)
    threshold = settings.pop_rain_threshold / 100.0

    om: dict[str, dict] = {}
    for court_id, target, prob in db.execute(
        select(ForecastSnapshot.court_id, ForecastSnapshot.target_hour,
               ForecastSnapshot.precip_prob)
        .where(ForecastSnapshot.source == "open_meteo",
               ForecastSnapshot.target_hour >= since)
    ):
        om.setdefault(court_id, {})[target] = prob / 100.0 >= threshold
    outcomes = _station_outcomes(db, since)

    n = agree_rain = agree_rain_hit = agree_dry = agree_dry_hit = 0
    om_wet_n = om_wet_right = f3_wet_n = f3_wet_right = 0
    f3_flags = _f3_hour_flags(db, since)
    for court_id, hours in f3_flags.items():
        om_hours = om.get(court_id, {})
        court_outcomes = outcomes.get(court_id, {})
        for hour, f3_rain in hours.items():
            om_rain = om_hours.get(hour)
            if om_rain is None:
                continue
            outcome = court_outcomes.get(hour)
            if outcome is None:
                continue
            n += 1
            if om_rain and f3_rain:
                agree_rain += 1
                agree_rain_hit += int(outcome)
            elif not om_rain and not f3_rain:
                agree_dry += 1
                agree_dry_hit += int(not outcome)
            elif om_rain:  # OM wet, F3 dry
                om_wet_n += 1
                om_wet_right += int(outcome)
            else:          # F3 wet, OM dry
                f3_wet_n += 1
                f3_wet_right += int(outcome)

    result = {
        "window_days": settings.window_days,
        "n": n,
        "agree_n": agree_rain + agree_dry,
        "agree_rain_n": agree_rain,
        "agree_rain_acc": round(agree_rain_hit / agree_rain, 3) if agree_rain else None,
        "agree_dry_n": agree_dry,
        "agree_dry_acc": round(agree_dry_hit / agree_dry, 3) if agree_dry else None,
        # OM-only rain calls: right when it actually rained
        "om_wet_n": om_wet_n, "om_wet_right": om_wet_right,
        # F3-only rain calls: right when it actually rained
        "f3_wet_n": f3_wet_n, "f3_wet_right": f3_wet_right,
    }
    _disagree_cache.update(data=result, built=now)
    return result
