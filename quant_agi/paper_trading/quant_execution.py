"""Quant auto-pick execution: sizing, rank rotation exits, stop-loss (momentum rotation)."""

from __future__ import annotations

from typing import Any, Optional

# Momentum / factor rotation heuristics (paper bot — not validated live alpha).
QUANT_HOLD_TOP_N = 20
QUANT_EXIT_MIN_SCORE = 45.0
QUANT_TOP_TIER_N = 5
STOP_LOSS_PCT = 0.08
TAKE_PROFIT_ROTATE_PCT = 0.12


def rank_index(symbol: str, ordered_universe: list[str]) -> Optional[int]:
    sym = symbol.upper()
    try:
        return ordered_universe.index(sym)
    except ValueError:
        return None


def evaluate_exit_reason(
    *,
    symbol: str,
    avg_cost_usd: float,
    price_usd: float,
    quant_rank_by_symbol: dict[str, Any],
    ordered_universe: list[str],
) -> Optional[str]:
    """Return exit reason tag or None to hold."""
    if price_usd <= 0 or avg_cost_usd <= 0:
        return None

    pnl_pct = (price_usd - avg_cost_usd) / avg_cost_usd
    if pnl_pct <= -STOP_LOSS_PCT:
        return "stop_loss"

    meta = quant_rank_by_symbol.get(symbol.upper()) or quant_rank_by_symbol.get(symbol)
    score = float(meta.get("score", 0)) if isinstance(meta, dict) else 0.0
    idx = rank_index(symbol, ordered_universe)

    if idx is None or idx >= QUANT_HOLD_TOP_N:
        return "rank_drop"
    if score > 0 and score < QUANT_EXIT_MIN_SCORE:
        return "rank_score_floor"
    if pnl_pct >= TAKE_PROFIT_ROTATE_PCT and (idx is None or idx >= QUANT_TOP_TIER_N):
        return "profit_rotate"

    return None


def compute_buy_notional(
    *,
    equity_usd: float,
    available_cash: float,
    min_cash_reserve: float,
    max_position_pct: float,
    max_notional_per_trade: float,
    max_open_positions: int,
    open_count: int,
    rank_score: Optional[float] = None,
) -> float:
    """Equity-based slot sizing with optional rank score tilt (proven momentum sizing pattern)."""
    slots_left = max(1, max_open_positions - open_count)
    slot_pct = min(float(max_position_pct), (100.0 / float(max_open_positions)) * 0.95)
    target = float(equity_usd) * (slot_pct / 100.0)

    if rank_score is not None and rank_score > 0:
        score_factor = max(0.55, min(1.0, float(rank_score) / 100.0))
        target *= score_factor

    headroom = max(0.0, float(available_cash) - float(min_cash_reserve))
    return min(target, float(max_notional_per_trade), headroom)
