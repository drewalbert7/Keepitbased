"""Tests for research agent — deterministic path (no Grok required)."""

from __future__ import annotations

from paper_trading.bot_graph.research_agent import (
    apply_research_to_entries,
    apply_research_to_exits,
    deterministic_research,
)
from paper_trading.plan_tick import plan_tick_payload


def test_deterministic_research_boosts_trusted_x_cashtag():
    result = deterministic_research(
        scout_candidates=[
            {"symbol": "NVDA", "score": 75},
            {"symbol": "AAA", "score": 80},
        ],
        held_enriched=[],
        learning_memory={
            "coaching_directives": {
                "entry_posture": "balanced",
                "exit_posture": "balanced",
                "trusted_symbols": ["NVDA"],
                "priority_themes": ["semis momentum"],
            }
        },
        x_research_snippets=[
            {"author": "trader1", "text": "Long $NVDA on AI capex", "cashtags": ["NVDA"]},
        ],
        regime_label="moderate",
    )
    positions = {p["symbol"]: p for p in result["positions"]}
    assert "NVDA" in positions
    assert positions["NVDA"]["action"] in {"enter", "hold"}
    assert positions["NVDA"]["weight"] >= positions.get("AAA", {"weight": 0})["weight"]


def test_apply_research_to_entries_adjusts_urgency():
    proposals = [{"symbol": "NVDA", "urgency": 0.6, "reason": "momentum_leader"}]
    recs = [{"symbol": "NVDA", "action": "enter", "weight": 0.9, "rationale": "paper + X"}]
    out = apply_research_to_entries(proposals, recs)
    assert out[0]["urgency"] > 0.6
    assert out[0]["research_action"] == "enter"


def test_apply_research_to_exits_adds_research_exit():
    proposals = []
    recs = [{"symbol": "OLD", "action": "exit", "weight": 0.85, "rationale": "rank fade"}]
    out = apply_research_to_exits(proposals, recs)
    assert len(out) == 1
    assert out[0]["symbol"] == "OLD"
    assert out[0]["reason"] == "research_exit"


def test_plan_tick_includes_research_in_plan():
    memory = {
        "coaching_directives": {
            "entry_posture": "patient",
            "exit_posture": "protect_capital",
            "trusted_symbols": ["BBB"],
            "priority_themes": ["quality momentum"],
        },
        "lessons": [{"title": "Wait for confirmation", "detail": "Paper drawdown lesson"}],
    }
    snippets = [{"author": "handle", "text": "$BBB breakout setup", "cashtags": ["BBB"]}]
    result = plan_tick_payload(
        cash_usd=9000,
        positions=[],
        universe_symbols=["AAA", "BBB", "CCC"],
        prices={"AAA": 50.0, "BBB": 40.0, "CCC": 30.0},
        kill_switch_armed=False,
        quant_rank_by_symbol={
            "AAA": {"score": 88, "strategy": "momentum_liquidity"},
            "BBB": {"score": 72, "strategy": "rule_breaker_gardner"},
            "CCC": {"score": 60, "strategy": "photonics_chokepoint"},
        },
        run_at_iso="2026-06-02T15:00:00-04:00",
        learning_memory=memory,
        x_research_snippets=snippets,
    )
    plan = result.get("plan") or {}
    assert plan.get("phase") == "5d"
    assert isinstance(plan.get("research_recommendations"), list)
    assert plan.get("research_brief")
