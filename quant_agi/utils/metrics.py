"""Trading / alert-relevant scalar metrics — numpy-only (no TA-Lib C deps)."""

from __future__ import annotations

from typing import Optional, Sequence, Tuple

import numpy as np


def sharpe_ratio(returns: np.ndarray, rf: float = 0.0, periods_per_year: int = 252) -> float:
    """Annualized Sharpe on simple returns."""
    x = np.asarray(returns, dtype=np.float64)
    if x.size < 6:
        return 0.0
    mu = np.mean(x) - rf / periods_per_year
    sigma = np.std(x, ddof=1)
    if sigma < 1e-12:
        return 0.0
    return float(np.sqrt(periods_per_year) * mu / sigma)


def win_rate(hit_direction: Sequence[bool]) -> float:
    b = np.array(list(hit_direction), dtype=bool)
    if b.size == 0:
        return 0.0
    return float(np.mean(b))


def profit_factor(pnl_series: Sequence[float]) -> float:
    s = np.array(list(pnl_series), dtype=np.float64)
    gains = np.sum(s[s > 0])
    losses = -np.sum(s[s < 0])
    if losses < 1e-12:
        return float(inf_safe(gains))
    return float(gains / losses)


def inf_safe(x: float) -> float:
    return x if np.isfinite(x) else 0.0


def simple_rsi(series: np.ndarray, period: int = 14) -> Optional[float]:
    """Wilder RSI on last closed value."""
    x = np.asarray(series, dtype=np.float64).ravel()
    if x.size < period + 2:
        return None
    delta = np.diff(x)
    gains = np.clip(delta, 0, None)
    losses = -np.clip(delta, None, 0)
    if gains.size < period:
        return None
    avg_g = np.mean(gains[-period:])
    avg_l = np.mean(losses[-period:])
    if avg_l == 0:
        return 100.0
    rs = avg_g / avg_l
    return float(100.0 - (100.0 / (1.0 + rs)))


def max_drawdown(equity: np.ndarray) -> float:
    c = np.maximum.accumulate(equity)
    dd = (equity - c) / np.where(c != 0, c, np.nan)
    return float(np.nanmin(dd))


def percentile_ci(values: Sequence[float], low: float = 10.0, high: float = 90.0) -> Tuple[float, float]:
    v = np.array(list(values), dtype=np.float64)
    if v.size == 0:
        return (0.0, 0.0)
    return (
        float(np.percentile(v, low)),
        float(np.percentile(v, high)),
    )
