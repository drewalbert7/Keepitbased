"""Penalize extended names — high in 52-week range and/or extreme 20D momentum."""

from __future__ import annotations

import math
from typing import Any, Optional

from keepitbased_integration.quant_strategies import _week52_band_position


def _momentum_20d_pct(hist: Any) -> Optional[float]:
    closes = hist.close
    if len(closes.index) < 21:
        return None
    last = float(closes.iloc[-1])
    back_20 = float(closes.iloc[-21])
    if not back_20 or not math.isfinite(last) or not math.isfinite(back_20):
        return None
    return (last - back_20) / abs(back_20) * 100.0


def compute_anti_chase_metrics(hist: Any, *, momentum_20d_pct: Optional[float] = None) -> dict[str, Any]:
    """
    Returns extension diagnostics and a penalty in 0–25 (composite scale).
    Flags when price is above 52w median band or 20D move is stretched.
    """
    pos = _week52_band_position(hist.close)
    mom = momentum_20d_pct if momentum_20d_pct is not None else _momentum_20d_pct(hist)
    median_pos = 0.5
    above_median_pct = max(0.0, (pos - median_pos) * 200.0)  # 0 at median, ~100 at 52w high

    penalty = 0.0
    reasons: list[str] = []

    if pos >= 0.82:
        leg = min(12.0, (pos - 0.82) * 75.0)
        penalty += leg
        reasons.append(f"52w range position {pos * 100:.0f}% (extended)")

    if pos >= 0.92:
        penalty += min(5.0, (pos - 0.92) * 50.0)
        reasons.append("near 52-week high")

    if mom is not None and math.isfinite(mom):
        if mom >= 30.0:
            leg = min(10.0, (mom - 30.0) * 0.22)
            penalty += leg
            reasons.append(f"20D momentum {mom:+.1f}% (chase risk)")
        if mom >= 50.0:
            penalty += min(6.0, (mom - 50.0) * 0.12)
            reasons.append("extreme 20D extension")

    penalty = round(min(25.0, max(0.0, penalty)), 3)
    chase_risk = penalty >= 8.0 or (pos >= 0.88 and mom is not None and mom >= 25.0)

    return {
        "enabled": True,
        "week52_position": round(pos, 4),
        "above_52w_median_pct": round(above_median_pct, 2),
        "momentum_20d_pct": round(mom, 4) if mom is not None and math.isfinite(mom) else None,
        "penalty_points": penalty,
        "chase_risk": bool(chase_risk),
        "reasons": reasons[:4],
    }


def apply_anti_chase_to_tape_score(score: float, metrics: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    """Momentum tier scores (~±2): subtract scaled penalty."""
    penalty = float(metrics.get("penalty_points") or 0.0)
    adj = score - (penalty / 25.0) * 0.55
    out = dict(metrics)
    out["score_before"] = round(score, 6)
    out["score_after"] = round(adj, 6)
    return round(adj, 6), out


def apply_anti_chase_to_composite(score: float, metrics: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    """0–100 composites: subtract penalty points directly."""
    penalty = float(metrics.get("penalty_points") or 0.0)
    adj = max(0.0, min(100.0, score - penalty))
    out = dict(metrics)
    out["score_before"] = round(score, 4)
    out["score_after"] = round(adj, 4)
    return round(adj, 4), out
