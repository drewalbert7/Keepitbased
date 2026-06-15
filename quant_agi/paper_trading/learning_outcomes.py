"""Measured outcomes gate — coaching only tightens if next N trades improve metrics."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

# Rank tape is primary; coach overlays; X is a weak whisper (see research_agent + learning_memory).
DEFAULT_OUTCOME_WINDOW_TRADES = 10

_TIGHT_ENTRY = {"patient": 2, "balanced": 1, "aggressive_leader": 0}
_TIGHT_EXIT = {"protect_capital": 2, "let_winners_run": 0, "balanced": 1}
_TIGHT_REGIME = {"prefer_cautious": 2, "neutral": 1, "prefer_opportunistic": 0}


def outcome_window_trades() -> int:
    try:
        from config import settings

        raw = getattr(settings, "bot_learning_outcome_window_trades", None)
        if raw is not None:
            return max(3, min(50, int(raw)))
    except Exception:  # noqa: BLE001
        pass
    return DEFAULT_OUTCOME_WINDOW_TRADES


def metrics_snapshot(metrics: dict[str, Any] | None) -> dict[str, Any]:
    m = metrics or {}
    return {
        "cum_pnl_usd": float(m.get("cumPnlUsd") or m.get("cum_pnl_usd") or 0),
        "sharpe_proxy": float(m.get("sharpeProxy") or m.get("sharpe_proxy") or 0),
        "max_drawdown_pct": float(m.get("maxDrawdownPct") or m.get("max_drawdown_pct") or 0),
        "trade_count": int(m.get("tradeCount") or m.get("trade_count") or 0),
    }


def _parse_ts(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        raw = str(value).replace("Z", "+00:00")
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (TypeError, ValueError):
        return None


def trades_since(trades: list[dict[str, Any]], since_iso: str | None) -> list[dict[str, Any]]:
    anchor = _parse_ts(since_iso)
    if not anchor:
        return list(trades or [])
    out: list[dict[str, Any]] = []
    for t in trades or []:
        ts = _parse_ts(t.get("createdAt") or t.get("created_at"))
        if ts and ts >= anchor:
            out.append(t)
    return out


def directiveness_score(directives: dict[str, Any] | None) -> int:
    d = directives or {}
    return (
        _TIGHT_REGIME.get(str(d.get("regime_bias") or "neutral").lower(), 1)
        + _TIGHT_ENTRY.get(str(d.get("entry_posture") or "balanced").lower(), 1)
        + _TIGHT_EXIT.get(str(d.get("exit_posture") or "balanced").lower(), 1)
    )


def is_tightening(
    previous: dict[str, Any] | None,
    proposed: dict[str, Any] | None,
) -> bool:
    return directiveness_score(proposed) > directiveness_score(previous)


def soften_directives(directives: dict[str, Any] | None) -> dict[str, Any]:
    """Step coaching one notch looser after a failed outcome gate."""
    d = dict(directives or {})
    entry = str(d.get("entry_posture") or "balanced").lower()
    exit_p = str(d.get("exit_posture") or "balanced").lower()
    regime = str(d.get("regime_bias") or "neutral").lower()
    if entry == "patient":
        d["entry_posture"] = "balanced"
    if exit_p == "protect_capital":
        d["exit_posture"] = "balanced"
    if regime == "prefer_cautious":
        d["regime_bias"] = "neutral"
    return d


def evaluate_previous_cycle_gate(
    *,
    previous_memory: dict[str, Any] | None,
    recent_trades: list[dict[str, Any]] | None,
    current_metrics: dict[str, Any] | None,
    window: int | None = None,
) -> dict[str, Any]:
    """Score prior coaching against paper trades since that cycle's baseline."""
    window = window or outcome_window_trades()
    if not previous_memory:
        return {
            "status": "insufficient_data",
            "window_trades": window,
            "message": "First learning cycle — no prior coaching to evaluate.",
        }

    gate = previous_memory.get("outcome_gate") if isinstance(previous_memory.get("outcome_gate"), dict) else {}
    prior_status = str(gate.get("status") or "").lower()
    if prior_status in {"passed", "failed"} and gate.get("evaluated_at"):
        return {
            "status": prior_status,
            "window_trades": int(gate.get("window_trades") or window),
            "baseline": gate.get("baseline"),
            "after": gate.get("after"),
            "delta": gate.get("delta"),
            "evaluated_at": gate.get("evaluated_at"),
            "message": gate.get("message"),
        }

    baseline = gate.get("baseline") if isinstance(gate.get("baseline"), dict) else None
    if not baseline:
        return {
            "status": "insufficient_data",
            "window_trades": window,
            "message": "No outcome baseline on prior memory.",
        }

    since = baseline.get("recorded_at") or previous_memory.get("updated_at")
    trades_after = trades_since(recent_trades or [], str(since) if since else None)
    current = metrics_snapshot(current_metrics)
    trade_delta = max(len(trades_after), current["trade_count"] - int(baseline.get("trade_count") or 0))

    if trade_delta < window:
        return {
            "status": "pending",
            "window_trades": window,
            "trades_since_baseline": trade_delta,
            "baseline": baseline,
            "message": (
                f"Waiting for {window - trade_delta} more paper trade(s) "
                f"before evaluating prior coaching ({trade_delta}/{window})."
            ),
        }

    delta_pnl = current["cum_pnl_usd"] - float(baseline.get("cum_pnl_usd") or 0)
    delta_sharpe = current["sharpe_proxy"] - float(baseline.get("sharpe_proxy") or 0)
    dd_delta = current["max_drawdown_pct"] - float(baseline.get("max_drawdown_pct") or 0)
    passed = delta_pnl > 0 or (delta_sharpe > 0.05 and dd_delta <= 0.02)

    return {
        "status": "passed" if passed else "failed",
        "window_trades": window,
        "trades_since_baseline": trade_delta,
        "baseline": baseline,
        "after": current,
        "delta": {
            "cum_pnl_usd": round(delta_pnl, 2),
            "sharpe_proxy": round(delta_sharpe, 3),
            "max_drawdown_pct": round(dd_delta, 4),
            "trade_count": trade_delta,
        },
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "message": (
            "Prior coaching improved paper metrics — tightening allowed."
            if passed
            else "Prior coaching did not improve metrics — do not tighten further."
        ),
    }


def resolve_effective_directives(
    *,
    previous_memory: dict[str, Any] | None,
    proposed_directives: dict[str, Any],
    prior_gate: dict[str, Any],
) -> tuple[dict[str, Any], str | None]:
    """Pick directives plan-tick will use this cycle."""
    prev_effective = (previous_memory or {}).get("effective_directives")
    if not isinstance(prev_effective, dict) or not prev_effective:
        prev_effective = (previous_memory or {}).get("coaching_directives") or {}

    status = str(prior_gate.get("status") or "").lower()

    if status == "pending":
        base = prev_effective if prev_effective else proposed_directives
        return base, prior_gate.get("message")

    if status == "failed":
        if is_tightening(prev_effective, proposed_directives):
            softened = soften_directives(prev_effective or proposed_directives)
            return softened, "Outcome gate failed — kept softer coaching instead of new tightening."
        return proposed_directives, prior_gate.get("message")

    if status == "passed":
        return proposed_directives, prior_gate.get("message")

    # First cycle / insufficient data — apply proposed coaching.
    return proposed_directives, None


def attach_outcome_gated_memory(
    payload: dict[str, Any],
    *,
    previous_memory: dict[str, Any] | None,
    recent_trades: list[dict[str, Any]] | None,
    current_metrics: dict[str, Any] | None,
    source: str = "manual",
) -> dict[str, Any]:
    """Build learning_memory with outcome baseline + effective coaching directives."""
    from paper_trading.learning_memory import build_learning_memory_from_cycle

    window = outcome_window_trades()
    prior_gate = evaluate_previous_cycle_gate(
        previous_memory=previous_memory,
        recent_trades=recent_trades,
        current_metrics=current_metrics,
        window=window,
    )
    proposed = payload.get("coaching_directives") if isinstance(payload.get("coaching_directives"), dict) else {}
    effective, apply_note = resolve_effective_directives(
        previous_memory=previous_memory,
        proposed_directives=proposed,
        prior_gate=prior_gate,
    )

    memory = build_learning_memory_from_cycle({**payload, "coaching_directives": proposed}, source=source)
    baseline = metrics_snapshot(current_metrics)
    baseline["recorded_at"] = memory["updated_at"]

    memory["proposed_directives"] = proposed
    memory["effective_directives"] = effective
    memory["coaching_directives"] = effective
    memory["signal_hierarchy"] = {
        "rank": "primary",
        "coach": "overlay",
        "x_whisper": "weak_overlay",
    }
    memory["outcome_gate"] = {
        "status": "pending",
        "window_trades": window,
        "baseline": baseline,
        "previous_cycle": prior_gate,
        "message": f"Measure next {window} paper trade(s) before tightening coaching again.",
    }
    if apply_note:
        memory["outcome_gate"]["apply_note"] = apply_note

    return {
        **payload,
        "learning_memory": memory,
        "outcome_gate": prior_gate,
        "effective_coaching_directives": effective,
        "coaching_directives": effective,
    }
