"""Tests for learning memory → plan graph coaching."""

from __future__ import annotations

from paper_trading.learning_memory import (
    apply_regime_coaching_bias,
    build_learning_memory_from_cycle,
    coaching_payload_for_graph,
    entry_score_adjustment,
    exit_urgency_boost,
)
from paper_trading.plan_tick import plan_tick_payload


def test_build_learning_memory_from_cycle_normalizes_directives():
    memory = build_learning_memory_from_cycle(
        {
            "summary": "Stay selective after drawdown.",
            "lessons": [{"title": "Sizing", "detail": "Tighten caps."}],
            "agent_hints": ["Wait for rank confluence"],
            "coaching_directives": {
                "regime_bias": "prefer_cautious",
                "entry_posture": "patient",
                "exit_posture": "protect_capital",
                "priority_themes": ["drawdown control"],
                "avoid": ["low-rank chase"],
            },
            "sources": [{"title": "Paper A"}],
            "research_queries": ["drawdown"],
            "grok_used": True,
        },
        source="grok",
    )
    assert memory["source"] == "grok"
    assert memory["coaching_directives"]["regime_bias"] == "prefer_cautious"
    assert memory["agent_hints"] == ["Wait for rank confluence"]
    assert memory["source_count"] == 1


def test_coaching_payload_for_graph_empty_when_no_content():
    assert coaching_payload_for_graph(None) == {}
    assert coaching_payload_for_graph({}) == {}


def test_apply_regime_coaching_bias_cautious():
    label, detail = apply_regime_coaching_bias(
        "risk_on",
        "Strong tape.",
        {"coaching_directives": {"regime_bias": "prefer_cautious"}},
    )
    assert label == "moderate"
    assert "Coach" in detail


def test_entry_and_exit_adjustments():
    memory = {"coaching_directives": {"entry_posture": "patient", "exit_posture": "protect_capital"}}
    assert entry_score_adjustment(memory) == 8.0
    assert exit_urgency_boost(memory) == 0.08


def test_plan_tick_applies_patient_entry_coaching():
    memory = build_learning_memory_from_cycle(
        {
            "summary": "Patient entries only.",
            "coaching_directives": {"entry_posture": "patient"},
            "lessons": [],
            "agent_hints": [],
            "sources": [],
        }
    )
    result = plan_tick_payload(
        cash_usd=9000,
        positions=[],
        universe_symbols=["AAA", "BBB"],
        prices={"AAA": 50.0, "BBB": 40.0},
        kill_switch_armed=False,
        quant_rank_by_symbol={
            "AAA": {"score": 55, "strategy": "momentum_liquidity"},
            "BBB": {"score": 88, "strategy": "momentum_liquidity"},
        },
        run_at_iso="2026-06-02T15:00:00-04:00",
        learning_memory=memory,
    )
    assert result["ok"] is True
    entries = result.get("prioritized_entry_symbols") or []
    if entries:
        assert "BBB" in entries
        assert "AAA" not in entries
