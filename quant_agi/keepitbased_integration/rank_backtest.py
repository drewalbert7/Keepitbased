"""Simple holdout backtest: top-5 basket vs SPY over 3/6/12 month windows."""

from __future__ import annotations

import math
from typing import Any, Callable, Optional

HORIZON_DAYS = {"3m": 63, "6m": 126, "12m": 252}
BENCHMARK = "SPY"


def _forward_return_pct(closes: Any, start_idx: int, end_idx: int) -> Optional[float]:
    try:
        if start_idx < 0 or end_idx >= len(closes.index) or start_idx >= end_idx:
            return None
        a = float(closes.iloc[start_idx])
        b = float(closes.iloc[end_idx])
        if not math.isfinite(a) or not math.isfinite(b) or a == 0:
            return None
        return (b - a) / abs(a) * 100.0
    except (TypeError, ValueError, IndexError, AttributeError):
        return None


def _equal_weight_basket_return(
    symbol_histories: dict[str, Any],
    start_idx: int,
    end_idx: int,
) -> tuple[Optional[float], list[str]]:
    rets: list[float] = []
    used: list[str] = []
    for sym, hist in symbol_histories.items():
        r = _forward_return_pct(hist.close, start_idx, end_idx)
        if r is not None and math.isfinite(r):
            rets.append(r)
            used.append(sym)
    if not rets:
        return None, used
    return sum(rets) / float(len(rets)), used


def rank_backtest_holdout(
    universe: list[str],
    fb: Any,
    *,
    score_fn: Callable[[Any], float],
    top_k: int = 5,
    benchmark: str = BENCHMARK,
    max_universe_eval: int = 55,
) -> dict[str, Any]:
    """
    At each horizon, re-rank using only history up to the holdout start bar (tape proxy),
    equal-weight top_k forward return vs benchmark over the holdout window.
    """
    bench_hist = fb.load_history(benchmark, refresh=False, asset_type="stock")
    if len(bench_hist.index) < 280:
        bench_hist = fb.load_history(benchmark, refresh=True, asset_type="stock")

    n_bench = len(bench_hist.index)
    horizons_out: dict[str, Any] = {}

    eval_syms = [str(s).upper() for s in universe if str(s).strip()][:max_universe_eval]
    hist_cache: dict[str, Any] = {benchmark: bench_hist}
    for sym in eval_syms:
        if sym == benchmark:
            continue
        h = fb.load_history(sym, refresh=False, asset_type="stock")
        if len(h.index) >= 80:
            hist_cache[sym] = h

    for label, days in HORIZON_DAYS.items():
        if n_bench < days + 25:
            horizons_out[label] = {"ok": False, "reason": "insufficient_benchmark_history", "trading_days": days}
            continue

        end_idx = n_bench - 1
        start_idx = end_idx - days
        as_of_idx = start_idx - 1
        if as_of_idx < 30:
            horizons_out[label] = {"ok": False, "reason": "holdout_start_too_early", "trading_days": days}
            continue

        scores: list[tuple[str, float]] = []
        for sym, hist in hist_cache.items():
            if sym == benchmark:
                continue
            if len(hist.index) <= as_of_idx:
                continue
            truncated = hist.iloc[: as_of_idx + 1]
            try:
                sc = float(score_fn(truncated))
            except (TypeError, ValueError):
                continue
            if math.isfinite(sc):
                scores.append((sym, sc))

        scores.sort(key=lambda x: (-x[1], x[0]))
        top_syms = [s for s, _ in scores[:top_k]]

        basket_hist = {s: hist_cache[s] for s in top_syms if s in hist_cache}
        basket_ret, used = _equal_weight_basket_return(basket_hist, start_idx, end_idx)
        spy_ret = _forward_return_pct(bench_hist.close, start_idx, end_idx)

        holdout_start = str(bench_hist.index[start_idx])[:10] if len(bench_hist.index) else None
        holdout_end = str(bench_hist.index[end_idx])[:10] if len(bench_hist.index) else None

        horizons_out[label] = {
            "ok": basket_ret is not None and spy_ret is not None,
            "trading_days": days,
            "holdout_start": holdout_start,
            "holdout_end": holdout_end,
            "top_symbols": top_syms,
            "symbols_with_returns": used,
            "basket_return_pct": round(basket_ret, 3) if basket_ret is not None else None,
            "benchmark_return_pct": round(spy_ret, 3) if spy_ret is not None else None,
            "excess_return_pct": round(basket_ret - spy_ret, 3)
            if basket_ret is not None and spy_ret is not None
            else None,
        }

    return {
        "method": "tape_holdout_top5_vs_spy",
        "benchmark": benchmark,
        "top_k": top_k,
        "universe_evaluated": len(eval_syms),
        "horizons": horizons_out,
        "disclaimer": (
            "Holdout re-ranks with truncated daily bars only (tape proxy for all strategies). "
            "Not a guarantee of future performance; educational research panel."
        ),
    }


def trailing_returns_for_symbols(
    symbols: list[str],
    fb: Any,
    *,
    benchmark: str = BENCHMARK,
) -> dict[str, Any]:
    """Trailing 3/6/12m equal-weight return for today's top picks vs benchmark."""
    uniq = []
    for s in symbols:
        u = str(s).upper().strip()
        if u and u not in uniq:
            uniq.append(u)

    bench_hist = fb.load_history(benchmark, refresh=False, asset_type="stock")
    n = len(bench_hist.index)
    horizons_out: dict[str, Any] = {}

    sym_hist: dict[str, Any] = {}
    for sym in uniq:
        h = fb.load_history(sym, refresh=False, asset_type="stock")
        if len(h.index) >= 30:
            sym_hist[sym] = h

    for label, days in HORIZON_DAYS.items():
        if n < days + 5:
            horizons_out[label] = {"ok": False, "reason": "insufficient_history", "trading_days": days}
            continue
        start_idx = n - 1 - days
        end_idx = n - 1
        basket_ret, used = _equal_weight_basket_return(sym_hist, start_idx, end_idx)
        spy_ret = _forward_return_pct(bench_hist.close, start_idx, end_idx)
        horizons_out[label] = {
            "ok": basket_ret is not None and spy_ret is not None,
            "trading_days": days,
            "symbols": uniq,
            "symbols_with_returns": used,
            "basket_return_pct": round(basket_ret, 3) if basket_ret is not None else None,
            "benchmark_return_pct": round(spy_ret, 3) if spy_ret is not None else None,
            "excess_return_pct": round(basket_ret - spy_ret, 3)
            if basket_ret is not None and spy_ret is not None
            else None,
        }

    return {
        "method": "trailing_top_picks_vs_spy",
        "benchmark": benchmark,
        "horizons": horizons_out,
    }
