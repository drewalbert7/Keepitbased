"""Tests for outcome-gated coaching memory."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from paper_trading.learning_outcomes import (
    attach_outcome_gated_memory,
    evaluate_previous_cycle_gate,
    is_tightening,
    resolve_effective_directives,
    soften_directives,
)


def _trade_at(offset_minutes: int) -> dict:
    ts = datetime.now(timezone.utc) - timedelta(minutes=offset_minutes)
    return {"symbol": "AAA", "side": "buy", "createdAt": ts.isoformat()}


def test_is_tightening_detects_patient_and_protect_capital():
    loose = {"regime_bias": "neutral", "entry_posture": "balanced", "exit_posture": "balanced"}
    tight = {"regime_bias": "prefer_cautious", "entry_posture": "patient", "exit_posture": "protect_capital"}
    assert is_tightening(loose, tight)
    assert not is_tightening(tight, loose)


def test_soften_directives_steps_down_one_notch():
    d = soften_directives(
        {"regime_bias": "prefer_cautious", "entry_posture": "patient", "exit_posture": "protect_capital"}
    )
    assert d["regime_bias"] == "neutral"
    assert d["entry_posture"] == "balanced"
    assert d["exit_posture"] == "balanced"


def test_evaluate_previous_cycle_gate_pending_until_window_trades():
    prev = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "outcome_gate": {
            "baseline": {
                "cum_pnl_usd": 0,
                "trade_count": 5,
                "sharpe_proxy": 0.1,
                "max_drawdown_pct": 0.05,
                "recorded_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    }
    gate = evaluate_previous_cycle_gate(
        previous_memory=prev,
        recent_trades=[_trade_at(1)],
        current_metrics={"cumPnlUsd": 10, "tradeCount": 6, "sharpeProxy": 0.1, "maxDrawdownPct": 0.05},
        window=10,
    )
    assert gate["status"] == "pending"


def test_failed_gate_blocks_new_tightening():
    prior_gate = {"status": "failed", "message": "did not improve"}
    proposed = {
        "regime_bias": "prefer_cautious",
        "entry_posture": "patient",
        "exit_posture": "protect_capital",
    }
    prev = {
        "effective_directives": {
            "regime_bias": "neutral",
            "entry_posture": "balanced",
            "exit_posture": "balanced",
        }
    }
    effective, note = resolve_effective_directives(
        previous_memory=prev,
        proposed_directives=proposed,
        prior_gate=prior_gate,
    )
    assert effective["entry_posture"] == "balanced"
    assert note


def test_attach_outcome_gated_memory_records_baseline_and_hierarchy():
    out = attach_outcome_gated_memory(
        {
            "summary": "Test",
            "lessons": [],
            "agent_hints": [],
            "coaching_directives": {
                "regime_bias": "neutral",
                "entry_posture": "balanced",
                "exit_posture": "balanced",
            },
        },
        previous_memory=None,
        recent_trades=[],
        current_metrics={"cumPnlUsd": 100, "tradeCount": 3, "sharpeProxy": 0.2, "maxDrawdownPct": 0.03},
        source="test",
    )
    mem = out["learning_memory"]
    assert mem["signal_hierarchy"]["rank"] == "primary"
    assert mem["outcome_gate"]["status"] == "pending"
    assert mem["outcome_gate"]["baseline"]["trade_count"] == 3
