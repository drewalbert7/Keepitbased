"""Aggregate swarm agent beliefs → probability-weighted forecast + CI."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Sequence

import numpy as np

from swarm.agent import SwarmAgent
from utils.metrics import percentile_ci


@dataclass
class EmergentForecast:
    rebound_probability_mean: float
    expected_depth_pct_recovery: float
    ci_recovery_low_pct: float
    ci_recovery_high_pct: float
    horizon_days_min: int
    horizon_days_max: int
    polarization_std: float
    influence_weighted_probability: float
    swarm_size: int

    def to_dict(self) -> dict:
        return {
            "rebound_probability_mean": self.rebound_probability_mean,
            "expected_depth_pct_recovery": self.expected_depth_pct_recovery,
            "ci_recovery_low_pct": self.ci_recovery_low_pct,
            "ci_recovery_high_pct": self.ci_recovery_high_pct,
            "horizon_days_min": self.horizon_days_min,
            "horizon_days_max": self.horizon_days_max,
            "polarization_std": self.polarization_std,
            "influence_weighted_probability": self.influence_weighted_probability,
            "swarm_size": self.swarm_size,
        }


def collect_rebound_pct_samples(agent_beliefs: Sequence[float]) -> np.ndarray:
    """Map belief (0–1 rebound p) rough recovery % distribution for reporting."""
    b = np.array(list(agent_beliefs), dtype=np.float64)
    dx = b - 0.48
    # Avoid negative**fractional base issues in NumPy reals
    mag = np.power(np.maximum(np.abs(dx), 1e-9), 1.08) * 35.0
    signed = np.sign(dx) * mag
    return np.clip(np.nan_to_num(signed), -5.0, 42.0)


def emerge_forecast_from_beliefs(
    beliefs: np.ndarray,
    weights: np.ndarray | None = None,
    horizon: tuple[int, int] = (5, 9),
) -> EmergentForecast:
    b = np.nan_to_num(np.asarray(beliefs, dtype=np.float64).ravel(), nan=0.5, posinf=0.99, neginf=0.01)
    if weights is None:
        w = np.ones_like(b)
    else:
        w = np.nan_to_num(np.asarray(weights, dtype=np.float64).ravel(), nan=1.0, posinf=1.0, neginf=1e-3)
    if len(w) != len(b):
        w = np.ones_like(b)
    w = np.clip(w, 1e-9, None)
    weighted_p = float(np.sum(b * w) / np.sum(w))
    samples = collect_rebound_pct_samples(b)
    ci_lo, ci_hi = percentile_ci(samples.tolist())

    polarization = float(np.std(b))

    hi, lo = max(horizon), min(horizon)
    horizon_min, horizon_max = min(lo, hi), max(lo, hi)

    depth_expect = float(np.mean(samples))

    return EmergentForecast(
        rebound_probability_mean=float(np.mean(b)),
        expected_depth_pct_recovery=depth_expect,
        ci_recovery_low_pct=float(ci_lo),
        ci_recovery_high_pct=float(ci_hi),
        horizon_days_min=horizon_min,
        horizon_days_max=horizon_max,
        polarization_std=polarization,
        influence_weighted_probability=weighted_p,
        swarm_size=int(b.size),
    )


def emerge_forecast(agents: List[SwarmAgent], horizon: tuple[int, int] = (5, 9)) -> EmergentForecast:
    beliefs = np.array([a.belief for a in agents], dtype=np.float64)
    weights = np.array([max(1e-3, float(a.personality.social_rank) + float(a.social_influence)) for a in agents])
    return emerge_forecast_from_beliefs(beliefs, weights, horizon)
