"""Backtest harness — compares baseline vs simulated candidate swarm hyperparameters."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Callable, Dict

import numpy as np
import pandas as pd

from config import settings
from swarm.swarm_manager import SwarmManager
from utils.metrics import max_drawdown, profit_factor, sharpe_ratio, simple_rsi


@dataclass
class ExperimentScore:
    sharpe_alert_proxy: float
    win_hit_rate_proxy: float
    profit_fac: float
    max_dd: float
    aggregate: float
    diagnostics: Dict[str, Any]


def run_synthetic_audit(
    *,
    swarm_ctor: Callable[[], SwarmManager] | None = None,
) -> ExperimentScore:
    """Walk synthetic daily series; swarm belief gates toy long/flat strategy."""
    rng = np.random.default_rng(202611)

    log_rets = rng.normal(loc=2.8e-4, scale=0.0128, size=900)
    closes = pd.Series(
        100.0 * np.exp(np.cumsum(log_rets.astype(np.float64))),
        index=pd.date_range("2018-01-01", periods=900, freq="D"),
    )

    raw = swarm_ctor() if swarm_ctor else SwarmManager(n_agents=780, rounds=6)
    swarm = SwarmManager(
        n_agents=min(raw.n_agents, settings.autoresearch_eval_agents),
        rounds=min(raw.rounds, settings.autoresearch_eval_rounds),
    )

    pnl_slices: list[float] = []
    hits: list[bool] = []

    for i in range(60, len(closes) - 10, 21):
        window = closes.iloc[:i].copy()
        last_px = float(window.iloc[-1])
        base_px = float(window.iloc[max(10, len(window) // 40)])
        pct_gap = (last_px - base_px) / abs(base_px) * 100.0
        rsi_series = window.values
        rsi = simple_rsi(rsi_series) or 50.0

        drift = rng.normal(0, 1.05)
        ef = swarm.run_sync(
            rsi=rsi,
            headline_sentiment=float(np.clip(drift / 5.8, -1, 1)),
            onchain_pulse=float(np.clip(np.sin(i / 10.9) * 0.7, -1.0, 1.0)),
            macro_stress=float(np.clip(rng.standard_normal(), -1, 1)),
            baseline_gap_pct=float(pct_gap),
            use_executor="none",
        )

        if not math.isfinite(last_px) or last_px == 0:
            continue
        fwd = closes.iloc[i + 1 : i + 6]
        if len(fwd) < 2:
            continue
        fwd_last = float(fwd.iloc[-1])
        if not math.isfinite(fwd_last):
            continue
        fwd_ret = float(fwd_last / last_px - 1.0)

        long_bias = ef.influence_weighted_probability - 0.48
        pnl_piece = fwd_ret if long_bias >= 0 else -abs(fwd_ret) * 0.25
        pnl_slices.append(pnl_piece)
        hits.append(fwd_ret > 0)

    pn = np.array(pnl_slices, dtype=np.float64)
    sh = sharpe_ratio(pn)
    wr = float(np.mean(hits)) if hits else 0.5
    pf = profit_factor(pn)
    eq = np.cumprod(np.ones_like(pn) + pn).astype(np.float64)
    dd = max_drawdown(eq)

    agg = float(0.45 * np.tanh(sh) + 0.25 * (wr - 0.5) * 6.0 + 0.22 * np.tanh(np.log(pf + 1e-6)) - 0.25 * dd)

    return ExperimentScore(
        sharpe_alert_proxy=float(sh),
        win_hit_rate_proxy=float(wr),
        profit_fac=float(pf),
        max_dd=float(dd),
        aggregate=agg,
        diagnostics={"symbols": "(synthetic mix)", "n_samples": pn.size},
    )


def statistically_better(candidate: ExperimentScore, baseline: ExperimentScore, *, alpha: float) -> bool:
    """Lightweight heuristic gate — surrogate for paired bootstrap on live alert logs."""
    uplift = candidate.aggregate - baseline.aggregate

    thresh = alpha * np.sqrt(baseline.win_hit_rate_proxy**2 + baseline.max_dd + 5e-3)
    uplift_threshold = np.sign(uplift or 1e-6) * thresh

    return bool(uplift > max(0.18, uplift_threshold))
