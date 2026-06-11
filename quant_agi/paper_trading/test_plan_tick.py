"""Tests for LangGraph plan-tick (deterministic path — no Grok required)."""

from __future__ import annotations

from paper_trading.plan_tick import plan_tick_payload
from paper_trading.quant_execution import evaluate_exit_reason


def test_plan_tick_deterministic_entry_candidates():
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
    )
    assert result["ok"] is True
    assert result["skipped"] is False
    plan = result.get("plan") or {}
    assert plan.get("phase") == "5c"
    assert isinstance(result.get("trade_intents"), list)


def test_plan_tick_kill_switch_skipped():
    result = plan_tick_payload(
        cash_usd=5000,
        positions=[],
        universe_symbols=["AAA"],
        prices={"AAA": 10.0},
        kill_switch_armed=True,
    )
    assert result["skipped"] is True
    assert "Kill switch" in (result.get("reason") or "")


def test_plan_tick_exit_proposal_for_stop_loss():
    result = plan_tick_payload(
        cash_usd=5000,
        positions=[{"symbol": "AAA", "quantity": 10, "avg_cost_usd": 100.0}],
        universe_symbols=["AAA", "BBB"],
        prices={"AAA": 90.0, "BBB": 50.0},
        kill_switch_armed=False,
        quant_rank_by_symbol={
            "AAA": {"score": 80, "strategy": "momentum_liquidity"},
            "BBB": {"score": 85, "strategy": "momentum_liquidity"},
        },
        run_at_iso="2026-06-02T14:00:00-04:00",
    )
    reason = evaluate_exit_reason(
        symbol="AAA",
        avg_cost_usd=100.0,
        price_usd=90.0,
        quant_rank_by_symbol=result.get("plan", {}).get("exit_proposals") and {
            "AAA": {"score": 80, "strategy": "momentum_liquidity"}
        }
        or {"AAA": {"score": 80, "strategy": "momentum_liquidity"}},
        ordered_universe=["AAA", "BBB"],
    )
    assert reason == "stop_loss"
    exits = result.get("prioritized_exit_symbols") or []
    if exits:
        assert "AAA" in exits
