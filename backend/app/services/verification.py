"""Forecast verification engine.

Scores each forecast source against two kinds of hourly ground truth:
- station: nearest HKO rain gauge (authoritative, automatic)
- user: majority vote of accepted community reports in that hour

A single observation can never validate a probability, so we aggregate over a
rolling window into confusion counts + Brier score instead of judging one event.
"""
import json
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import floor_hour, hk_now, settings
from ..models import ForecastSnapshot, NowcastSnapshot, Observation, UserReport


@dataclass
class Metrics:
    n: int = 0
    hits: int = 0          # forecast rain, observed rain
    misses: int = 0        # forecast no rain, observed rain
    false_alarms: int = 0  # forecast rain, observed no rain
    correct_negatives: int = 0
    brier_sum: float = 0.0
    brier_n: int = 0

    def add(self, forecast_rain: bool, outcome_rain: bool, prob: float | None) -> None:
        if forecast_rain and outcome_rain:
            self.hits += 1
        elif not forecast_rain and outcome_rain:
            self.misses += 1
        elif forecast_rain and not outcome_rain:
            self.false_alarms += 1
        else:
            self.correct_negatives += 1
        self.n += 1
        if prob is not None:
            self.brier_sum += (prob - (1.0 if outcome_rain else 0.0)) ** 2
            self.brier_n += 1

    def as_dict(self) -> dict:
        accuracy = (self.hits + self.correct_negatives) / self.n if self.n else None
        return {
            "n": self.n,
            "hits": self.hits,
            "misses": self.misses,
            "false_alarms": self.false_alarms,
            "correct_negatives": self.correct_negatives,
            "accuracy": round(accuracy, 3) if accuracy is not None else None,
            "pod": round(self.hits / (self.hits + self.misses), 3)
                if (self.hits + self.misses) else None,
            "far": round(self.false_alarms / (self.hits + self.false_alarms), 3)
                if (self.hits + self.false_alarms) else None,
            "brier": round(self.brier_sum / self.brier_n, 3) if self.brier_n else None,
            "sufficient_samples": self.n >= settings.min_samples,
        }


def _user_outcomes(db: Session, court_id: str, since: datetime) -> dict[datetime, bool]:
    """Majority-vote rain outcome per hour from accepted reports (one vote per device)."""
    reports = db.execute(
        select(UserReport.created_at, UserReport.device_id, UserReport.was_raining)
        .where(UserReport.court_id == court_id,
               UserReport.status == "accepted",
               UserReport.created_at >= since)
    ).all()
    votes: dict[datetime, dict[str, bool]] = {}
    for created_at, device_id, was_raining in reports:
        hour = floor_hour(created_at)
        # Last report per device wins within the hour (cooldown makes this rare).
        votes.setdefault(hour, {})[device_id] = bool(was_raining)

    outcomes: dict[datetime, bool] = {}
    for hour, device_votes in votes.items():
        raining = sum(device_votes.values())
        outcomes[hour] = raining * 2 >= len(device_votes)  # ties count as rain
    return outcomes


def _open_meteo_pairs(db: Session, court_id: str, since: datetime) -> list[tuple[datetime, bool, float]]:
    """[(hour, forecast_rain(>=POP threshold), prob)] for OM snapshots in the window."""
    rows = db.execute(
        select(ForecastSnapshot.target_hour, ForecastSnapshot.precip_prob)
        .where(ForecastSnapshot.court_id == court_id,
               ForecastSnapshot.source == "open_meteo",
               ForecastSnapshot.target_hour >= since)
    ).all()
    return [
        (target, prob >= settings.pop_rain_threshold, prob / 100.0)
        for target, prob in rows
    ]


def _f3_pairs(db: Session, court_id: str, since: datetime) -> list[tuple[datetime, bool, float]]:
    """Per-hour rain calls from F3 nowcast snapshots.

    For each hour H, take the freshest snapshot issued before H started and ask
    whether any of its 30-min steps ending inside H carries >= threshold mm.
    prob is None: a deterministic nowcast cannot be Brier-compared with a
    probabilistic forecast on equal terms.
    """
    snaps = db.execute(
        select(NowcastSnapshot.fetched_at, NowcastSnapshot.steps_json)
        .where(NowcastSnapshot.court_id == court_id,
               NowcastSnapshot.fetched_at >= since)
    ).all()

    per_hour: dict[datetime, tuple[datetime, bool]] = {}  # hour -> (fetched_at, rain)
    for fetched_at, steps_json in snaps:
        hourly_flags: dict[datetime, bool] = {}
        for step in json.loads(steps_json):
            ending = datetime.fromisoformat(step["ending"])
            hour = floor_hour(ending)
            if hour <= fetched_at:
                continue
            rain = step["mm"] >= settings.nowcast_mm_threshold
            hourly_flags[hour] = hourly_flags.get(hour, False) or rain
        for hour, rain in hourly_flags.items():
            prev = per_hour.get(hour)
            if prev is None or fetched_at > prev[0]:
                per_hour[hour] = (fetched_at, rain)

    return [(hour, rain, None) for hour, (_f, rain) in sorted(per_hour.items())]


def _score(pairs, outcomes: dict[datetime, bool]) -> Metrics:
    m = Metrics()
    for hour, forecast_rain, prob in pairs:
        outcome = outcomes.get(hour)
        if outcome is None:
            continue
        m.add(forecast_rain, outcome, prob)
    return m


def compute_court_scores(db: Session, court_id: str,
                         window_days: int | None = None) -> dict:
    """Multi-source scorecard for one court over the rolling window."""
    days = window_days or settings.window_days
    since = hk_now() - timedelta(days=days)

    station_rows = db.execute(
        select(Observation.observed_hour, Observation.rain)
        .where(Observation.court_id == court_id,
               Observation.observed_hour >= since)
    ).all()
    station_outcomes = {hour: bool(rain) for hour, rain in station_rows}
    user_outcomes = _user_outcomes(db, court_id, since)

    om_pairs = _open_meteo_pairs(db, court_id, since)
    f3_pairs = _f3_pairs(db, court_id, since)

    return {
        "window_days": days,
        "min_samples": settings.min_samples,
        "open_meteo": {
            "station": _score(om_pairs, station_outcomes).as_dict(),
            "user": _score(om_pairs, user_outcomes).as_dict(),
        },
        "hko_f3": {
            "station": _score(f3_pairs, station_outcomes).as_dict(),
            "user": _score(f3_pairs, user_outcomes).as_dict(),
        },
    }


def all_court_summaries(db: Session, window_days: int | None = None) -> dict[str, dict]:
    """Lightweight per-court summary for the list view: OM accuracy vs stations.

    Loads the whole window once and aggregates in memory - tens of thousands of
    rows at most, cheaper than 55 grouped subqueries.
    """
    days = window_days or settings.window_days
    since = hk_now() - timedelta(days=days)

    snapshots: dict[str, dict[datetime, tuple[int, bool]]] = {}
    for court_id, target, prob in db.execute(
        select(ForecastSnapshot.court_id, ForecastSnapshot.target_hour,
               ForecastSnapshot.precip_prob)
        .where(ForecastSnapshot.source == "open_meteo",
               ForecastSnapshot.target_hour >= since)
    ):
        snapshots.setdefault(court_id, {})[target] = (prob, prob >= settings.pop_rain_threshold)

    obs: dict[str, dict[datetime, bool]] = {}
    for court_id, hour, rain in db.execute(
        select(Observation.court_id, Observation.observed_hour, Observation.rain)
        .where(Observation.observed_hour >= since)
    ):
        obs.setdefault(court_id, {})[hour] = bool(rain)

    summaries: dict[str, dict] = {}
    for court_id, hours in snapshots.items():
        court_obs = obs.get(court_id, {})
        m = Metrics()
        for target, (_prob, forecast_rain) in hours.items():
            outcome = court_obs.get(target)
            if outcome is None:
                continue
            m.add(forecast_rain, outcome, None)
        d = m.as_dict()
        summaries[court_id] = {
            "n": d["n"],
            "accuracy": d["accuracy"],
            "sufficient_samples": d["sufficient_samples"],
        }
    return summaries
