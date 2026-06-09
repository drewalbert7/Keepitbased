"""Walk-forward Sharpe eval on Massive/Polygon daily closes for bot-traded symbols."""

from __future__ import annotations

from typing import Any

from keepitbased_integration.data_fetcher import KeepItBasedDataFetcher
from paper_trading.paper_bot_metrics import sharpe_proxy


def evaluate_walk_forward(
    symbols: list[str],
    *,
    holdout_days: int = 5,
    min_bars: int = 20,
) -> dict[str, Any]:
    """
    Hold out the last ``holdout_days`` daily returns per symbol; compare test vs train Sharpe.
    Returns aggregate pass/fail for promotion gate when avg holdout delta > 0.
    """
    uniq = [str(s).upper().strip() for s in symbols if str(s).strip()]
    uniq = list(dict.fromkeys(uniq))[:12]
    if not uniq:
        return {
            "ok": True,
            "symbols_requested": 0,
            "symbols_evaluated": 0,
            "holdout_days": holdout_days,
            "avg_holdout_sharpe_delta": 0.0,
            "pass": False,
            "reason": "no_traded_symbols",
            "per_symbol": [],
        }

    fb = KeepItBasedDataFetcher()
    per_symbol: list[dict[str, Any]] = []
    deltas: list[float] = []

    for sym in uniq:
        hist = fb.load_history(sym, refresh=False, asset_type="stock")
        source = fb.last_history_source
        if source.startswith("synthetic") or len(hist.index) < min_bars:
            hist = fb.load_history(sym, refresh=True, asset_type="stock")
            source = fb.last_history_source

        closes = hist["close"].dropna()
        if len(closes) < min_bars:
            continue

        returns = closes.pct_change().dropna().tolist()
        if len(returns) < holdout_days + 5:
            continue

        train = returns[:-holdout_days]
        test = returns[-holdout_days:]
        train_sharpe = round(sharpe_proxy(train), 4)
        test_sharpe = round(sharpe_proxy(test), 4)
        delta = round(test_sharpe - train_sharpe, 4)
        deltas.append(delta)
        per_symbol.append(
            {
                "symbol": sym,
                "bars": len(closes),
                "history_source": source,
                "train_sharpe": train_sharpe,
                "test_sharpe": test_sharpe,
                "holdout_sharpe_delta": delta,
            }
        )

    avg_delta = round(sum(deltas) / len(deltas), 4) if deltas else 0.0
    return {
        "ok": True,
        "symbols_requested": len(uniq),
        "symbols_evaluated": len(per_symbol),
        "holdout_days": holdout_days,
        "avg_holdout_sharpe_delta": avg_delta,
        "pass": avg_delta > 0 and len(per_symbol) > 0,
        "reason": None if per_symbol else "insufficient_history",
        "per_symbol": per_symbol[:6],
    }
