"""Aggregate metrics from paper-bot ledger payloads (for autoresearch + scorecard)."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any


def _daily_returns(snapshots: list[dict[str, Any]]) -> list[float]:
    if len(snapshots) < 2:
        return []
    out: list[float] = []
    for i in range(1, len(snapshots)):
        prev = float(snapshots[i - 1].get("equity_usd") or snapshots[i - 1].get("equityUsd") or 0)
        curr = float(snapshots[i].get("equity_usd") or snapshots[i].get("equityUsd") or 0)
        if prev > 0:
            out.append((curr - prev) / prev)
    return out


def sharpe_proxy(returns: list[float]) -> float:
    if len(returns) < 2:
        return 0.0
    mean = sum(returns) / len(returns)
    var = sum((r - mean) ** 2 for r in returns) / len(returns)
    std = math.sqrt(var)
    if std < 1e-12:
        return 0.0
    return (mean / std) * math.sqrt(252)


def max_drawdown_pct(snapshots: list[dict[str, Any]], starting_equity: float) -> float:
    peak = float(starting_equity or 0)
    max_dd = 0.0
    for row in snapshots:
        eq = float(row.get("equity_usd") or row.get("equityUsd") or 0)
        peak = max(peak, eq)
        if peak > 0:
            max_dd = max(max_dd, (peak - eq) / peak)
    return round(max_dd, 4)


def summarize_paper_bot_metrics(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Input shape (from Node):
      starting_cash_usd, equity_usd, cum_pnl_usd, trade_count, snapshots: [{equity_usd, ...}]
    """
    starting = float(payload.get("starting_cash_usd") or 10000)
    equity = float(payload.get("equity_usd") or starting)
    snapshots = list(payload.get("snapshots") or [])
    trade_count = int(payload.get("trade_count") or 0)
    returns = _daily_returns(snapshots)
    sharpe_all = round(sharpe_proxy(returns), 4)
    sharpe_7d = round(sharpe_proxy(returns[-7:]), 4)
    sharpe_5d = round(sharpe_proxy(returns[-5:]), 4)
    prior_5 = returns[-10:-5] if len(returns) >= 10 else []
    recent_5 = returns[-5:] if len(returns) >= 5 else []
    sharpe_holdout_delta = round(sharpe_proxy(recent_5) - sharpe_proxy(prior_5), 4)
    dd = max_drawdown_pct(snapshots, starting)

    return {
        "starting_cash_usd": starting,
        "equity_usd": round(equity, 2),
        "cum_pnl_usd": round(equity - starting, 2),
        "paper_days": len(snapshots),
        "trade_count": trade_count,
        "sharpe_proxy": sharpe_all,
        "sharpe_7d": sharpe_7d,
        "sharpe_holdout_5d_delta": sharpe_holdout_delta,
        "max_drawdown_pct": dd,
    }


BASELINE_MAX_DRAWDOWN_PCT = 0.15


def enrich_nightly_context(payload: dict[str, Any]) -> dict[str, Any]:
    """Rich nightly prompt fields: worst day, win rate, symbols, rules."""
    snapshots = list(payload.get("snapshots") or [])
    starting = float(payload.get("starting_cash_usd") or 10000)
    equity = float(payload.get("equity_usd") or starting)

    worst_day: dict[str, Any] | None = None
    positive_days = 0
    for row in snapshots:
        day_pnl = float(row.get("day_pnl_usd") or row.get("dayPnlUsd") or 0)
        if day_pnl > 0:
            positive_days += 1
        snap_date = row.get("snapshot_date") or row.get("snapshotDate")
        if worst_day is None or day_pnl < float(worst_day.get("day_pnl_usd") or 0):
            worst_day = {"snapshot_date": snap_date, "day_pnl_usd": round(day_pnl, 2)}

    symbols_traded = list(payload.get("symbols_traded") or [])
    top_reason_tags = list(payload.get("top_reason_tags") or [])

    return {
        "equity_usd": round(equity, 2),
        "cum_pnl_usd": round(equity - starting, 2),
        "paper_days": len(snapshots),
        "trade_count": int(payload.get("trade_count") or 0),
        "win_rate_days": round(positive_days / len(snapshots), 3) if snapshots else 0.0,
        "worst_day": worst_day,
        "symbols_traded": symbols_traded,
        "top_reason_tags": top_reason_tags,
    }


def evaluate_promotion_gates(
    metrics: dict[str, Any],
    *,
    walk_forward: dict[str, Any] | None = None,
    reset_cooldown_blocked: bool = False,
) -> dict[str, Any]:
    """Promotion gates from todo.md — all must pass before autoresearch may promote."""
    gates = [
        {
            "id": "paper_days",
            "label": "≥10 paper days",
            "pass": int(metrics.get("paper_days") or 0) >= 10,
            "actual": int(metrics.get("paper_days") or 0),
            "required": 10,
        },
        {
            "id": "trade_count",
            "label": "≥20 fills",
            "pass": int(metrics.get("trade_count") or 0) >= 20,
            "actual": int(metrics.get("trade_count") or 0),
            "required": 20,
        },
        {
            "id": "sharpe_holdout",
            "label": "Sharpe Δ > 0 (last 5d vs prior 5d)",
            "pass": float(metrics.get("sharpe_holdout_5d_delta") or 0) > 0,
            "actual": float(metrics.get("sharpe_holdout_5d_delta") or 0),
            "required": 0,
        },
        {
            "id": "max_drawdown",
            "label": "Max drawdown ≤ 15%",
            "pass": float(metrics.get("max_drawdown_pct") or 0) <= BASELINE_MAX_DRAWDOWN_PCT,
            "actual": float(metrics.get("max_drawdown_pct") or 0),
            "required": BASELINE_MAX_DRAWDOWN_PCT,
        },
    ]

    if walk_forward is not None:
        wf_pass = bool(walk_forward.get("pass"))
        gates.append(
            {
                "id": "walk_forward",
                "label": "Walk-forward Sharpe Δ > 0 (Massive holdout)",
                "pass": wf_pass,
                "actual": float(walk_forward.get("avg_holdout_sharpe_delta") or 0),
                "required": 0,
            }
        )

    gates.append(
        {
            "id": "reset_cooldown",
            "label": "24h cooldown after account reset",
            "pass": not reset_cooldown_blocked,
            "actual": 1 if reset_cooldown_blocked else 0,
            "required": 0,
        }
    )
    passed = sum(1 for g in gates if g["pass"])
    return {
        "gates": gates,
        "passed_count": passed,
        "total_count": len(gates),
        "promotion_ready": passed == len(gates),
    }


def load_paper_bot_metrics_file(path: str | Path | None) -> dict[str, Any] | None:
    """Optional JSON snapshot written by nightly paper-bot close (Phase 3 hook)."""
    if not path:
        return None
    p = Path(path)
    if not p.is_file():
        return None
    try:
        blob = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return blob if isinstance(blob, dict) else None
