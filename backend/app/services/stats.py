"""Pure statistics functions for forecast verification analytics.

Everything here is side-effect free and unit-tested; DB assembly lives in
analytics.py. Conventions:
- a "pair" is (prob, outcome, baseline_prob): prob in [0,1] is the issued
  forecast probability, outcome is the observed truth (True=rain),
  baseline_prob is the climatological frequency for that court/month/hour.
"""
import math
from dataclasses import dataclass

Z95 = 1.959963984540054  # two-sided 95% normal quantile
MIN_BIN_N = 10           # below this a reliability bin is too thin to map


def wilson_ci(k: int, n: int, z: float = Z95) -> tuple[float, float] | None:
    """95% Wilson score interval for a binomial proportion."""
    if n <= 0:
        return None
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - margin), min(1.0, centre + margin)


def brier_score(pairs: list[tuple[float, bool, float | None]]) -> float | None:
    vals = [(p - (1.0 if o else 0.0)) ** 2 for p, o, _b in pairs]
    return sum(vals) / len(vals) if vals else None


def brier_skill_score(pairs: list[tuple[float, bool, float | None]]) -> float | None:
    """BSS = 1 - BS/BS_climatology. >0 means the forecast beats knowing only
    the climatological base rate - the honest null model."""
    if not pairs:
        return None
    bs = brier_score(pairs)
    bs_ref = sum((b - (1.0 if o else 0.0)) ** 2
                 for _p, o, b in pairs if b is not None)
    n_ref = sum(1 for _p, _o, b in pairs if b is not None)
    if not n_ref or bs is None:
        return None
    bs_ref /= n_ref
    if bs_ref == 0:
        return None
    return 1 - bs / bs_ref


@dataclass
class ReliabilityBin:
    lo: float
    hi: float
    n: int
    mean_forecast: float
    observed_freq: float
    ci: tuple[float, float] | None


def reliability_table(pairs: list[tuple[float, bool, float | None]],
                      bins: int = 10) -> list[ReliabilityBin]:
    edges = [i / bins for i in range(bins + 1)]
    out: list[ReliabilityBin] = []
    for lo, hi in zip(edges, edges[1:]):
        in_bin = [(p, o) for p, o, _b in pairs if lo <= p < hi or (hi == 1.0 and p == 1.0)]
        if not in_bin:
            continue
        n = len(in_bin)
        rains = sum(1 for _p, o in in_bin if o)
        out.append(ReliabilityBin(
            lo=lo, hi=hi, n=n,
            mean_forecast=sum(p for p, _o in in_bin) / n,
            observed_freq=rains / n,
            ci=wilson_ci(rains, n),
        ))
    return out


def brier_decomposition(pairs: list[tuple[float, bool, float | None]]) -> dict | None:
    """Murphy decomposition: BS = reliability - resolution + uncertainty.

    Grouped by exact forecast value (1% rounding) so the identity holds
    strictly; equal-width bins would leak within-bin forecast variance into
    the components.
    """
    if not pairs:
        return None
    n = len(pairs)
    o_bar = sum(1 for _p, o, _b in pairs if o) / n
    uncertainty = o_bar * (1 - o_bar)

    groups: dict[int, list[float]] = {}
    for p, o, _b in pairs:
        groups.setdefault(round(p * 100), []).append(1.0 if o else 0.0)

    reliability = 0.0
    resolution = 0.0
    for key, outcomes in groups.items():
        f = key / 100.0
        o_b = sum(outcomes) / len(outcomes)
        w = len(outcomes) / n
        reliability += w * (f - o_b) ** 2
        resolution += w * (o_b - o_bar) ** 2
    return {
        "reliability": round(reliability, 5),
        "resolution": round(resolution, 5),
        "uncertainty": round(uncertainty, 5),
        "check_sum": round(reliability - resolution + uncertainty, 5),
        "base_rate": round(o_bar, 4),
    }


def recalibrate(pairs: list[tuple[float, bool, float | None]],
                bins: int = 10) -> "callable":
    """Return f(official_prob) -> empirically corrected probability.

    Bin-mapping with linear interpolation between qualifying bin centres
    (monotone non-decreasing); outside the observed range the nearest bin
    answer is clamped. Bins with n < MIN_BIN_N are dropped from the knots.
    With zero (or all) rain outcomes there is nothing to learn - identity.
    """
    n = len(pairs)
    rains = sum(1 for _p, o, _b in pairs if o)
    if n == 0 or rains == 0 or rains == n:
        def identity(p: float) -> float:
            return p
        return identity

    table = [b for b in reliability_table(pairs, bins) if b.n >= MIN_BIN_N]

    knots = sorted((b.mean_forecast, b.observed_freq) for b in table)
    # enforce monotonicity (isotonic-style pool-adjacent violation fix)
    xs = [k[0] for k in knots]
    ys = [k[1] for k in knots]
    for i in range(1, len(ys)):
        if ys[i] < ys[i - 1]:
            ys[i] = ys[i - 1]

    def f(p: float) -> float:
        if p <= xs[0]:
            return ys[0]
        if p >= xs[-1]:
            return ys[-1]
        for i in range(1, len(xs)):
            if p <= xs[i]:
                span = xs[i] - xs[i - 1]
                t = (p - xs[i - 1]) / span if span > 0 else 0.0
                return ys[i - 1] + t * (ys[i] - ys[i - 1])
        return ys[-1]

    return f


def heidke(hits: int, misses: int, false_alarms: int, correct_negatives: int) -> float | None:
    """Heidke Skill Score: accuracy vs random expectation."""
    n = hits + misses + false_alarms + correct_negatives
    if n == 0:
        return None
    p_yes = (hits + misses) / n * (hits + false_alarms) / n
    p_no = (correct_negatives + false_alarms) / n * (misses + correct_negatives) / n
    expected = p_yes + p_no
    actual = (hits + correct_negatives) / n
    return None if expected == 1 else round((actual - expected) / (1 - expected), 3)


def peirce(hits: int, misses: int, false_alarms: int, correct_negatives: int) -> float | None:
    """Peirce Skill Score (true skill statistic): 1 = perfect, 0 = no better
    than chance, negative = worse."""
    obs_yes = hits + misses
    fcst_yes = hits + false_alarms
    n = obs_yes + false_alarms + correct_negatives
    if obs_yes == 0 or fcst_yes == 0 or n == 0:
        return None
    return round((hits / obs_yes) - (false_alarms / (n - obs_yes)), 3)


def shrinkage(court_k: int, court_n: int, group_rate: float,
              prior_strength: int = 200) -> float:
    """Empirical-Bayes point estimate: pull a noisy per-court rate toward the
    group rate with pseudo-counts. n=0 -> group rate; n->inf -> court rate."""
    if court_n + prior_strength == 0:
        return group_rate
    return (court_k + prior_strength * group_rate) / (court_n + prior_strength)


def onset_capture(onset_hours: list, warned_hours: set) -> dict:
    """Of hours where rain actually started (dry -> wet), how often had the
    F3 nowcast already flagged that hour?"""
    if not onset_hours:
        return {"onsets": 0, "captured": None}
    captured = sum(1 for h in onset_hours if h in warned_hours)
    return {"onsets": len(onset_hours), "captured": captured,
            "capture_rate": captured / len(onset_hours)}


def dual_truth_divergence(both_hours: list[tuple[bool, bool]]) -> dict:
    """Compare user reports with station observations hour by hour.

    both_hours: (user_says_rain, station_says_rain) for hours with both.
    user_rain_station_dry is the microclimate signal: rain the gauge missed.
    """
    n = len(both_hours)
    if n == 0:
        return {"n": 0, "agreement": None, "user_rain_station_dry": None,
                "microclimate": False}
    agree = sum(1 for u, s in both_hours if u == s)
    ursd = sum(1 for u, s in both_hours if u and not s)
    agreement = agree / n
    ursd_rate = ursd / n
    return {
        "n": n,
        "agreement": round(agreement, 3),
        "user_rain_station_dry": round(ursd_rate, 3),
        # flag: users saw rain the gauge denied in >15% of double-observed
        # hours, with enough overlap to trust the rate (>=20 hours)
        "microclimate": n >= 20 and ursd_rate > 0.15,
    }
