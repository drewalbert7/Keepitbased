"""Plan-tick orchestrator — LangGraph multi-agent entry/exit planning for quant auto-pick."""

from __future__ import annotations

from typing import Any, Optional

from paper_trading.bot_policy_engine import merge_active_rules


def plan_tick_payload(
    *,
    cash_usd: float,
    positions: list[dict[str, Any]],
    universe_symbols: list[str],
    prices: dict[str, float],
    kill_switch_armed: bool,
    policy_version: int = 1,
    active_rules: list[dict[str, Any]] | None = None,
    active_policy: dict[str, Any] | None = None,
    universe_source: str = "quant_auto",
    quant_rank_by_symbol: dict[str, Any] | None = None,
    run_at_iso: Optional[str] = None,
    learning_memory: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run multi-agent plan graph; returns audit-friendly plan (no fills)."""
    policy = active_policy or merge_active_rules(active_rules or [])

    if kill_switch_armed:
        return {
            "ok": True,
            "skipped": True,
            "reason": "Kill switch armed — no agent plan.",
            "plan": None,
            "trade_intents": [],
            "regime_label": None,
            "rationale": None,
            "grok_used": False,
            "prioritized_exit_symbols": [],
            "prioritized_entry_symbols": [],
            "policy_version": policy_version,
            "applied_policy": policy,
        }

    if not universe_symbols:
        return {
            "ok": True,
            "skipped": True,
            "reason": "Empty universe — nothing to plan.",
            "plan": None,
            "trade_intents": [],
            "regime_label": None,
            "rationale": None,
            "grok_used": False,
            "prioritized_exit_symbols": [],
            "prioritized_entry_symbols": [],
            "policy_version": policy_version,
            "applied_policy": policy,
        }

    try:
        from paper_trading.bot_graph.bot_graph import build_bot_plan_graph

        graph = build_bot_plan_graph()
    except Exception as ex:  # noqa: BLE001 — surface import/compile errors
        return {
            "ok": False,
            "skipped": True,
            "reason": f"Agent graph unavailable: {ex}",
            "plan": None,
            "trade_intents": [],
            "regime_label": None,
            "rationale": None,
            "grok_used": False,
            "prioritized_exit_symbols": [],
            "prioritized_entry_symbols": [],
            "policy_version": policy_version,
            "applied_policy": policy,
            "error": str(ex),
        }

    initial: dict[str, Any] = {
        "cash_usd": float(cash_usd),
        "positions": positions,
        "universe_symbols": [str(s).upper().strip() for s in universe_symbols if str(s).strip()],
        "prices": {str(k).upper(): float(v) for k, v in prices.items() if v and float(v) > 0},
        "policy": policy,
        "quant_rank_by_symbol": quant_rank_by_symbol or {},
        "run_at_iso": run_at_iso,
        "policy_version": policy_version,
        "universe_source": universe_source,
        "grok_used": False,
    }
    if learning_memory and isinstance(learning_memory, dict):
        initial["learning_memory"] = learning_memory

    final = graph.invoke(initial)
    plan = final.get("plan") if isinstance(final.get("plan"), dict) else {}

    return {
        "ok": True,
        "skipped": False,
        "reason": None,
        "plan": plan,
        "trade_intents": final.get("trade_intents") or [],
        "regime_label": final.get("regime_label"),
        "rationale": final.get("rationale"),
        "grok_used": bool(final.get("grok_used")),
        "prioritized_exit_symbols": final.get("prioritized_exit_symbols") or [],
        "prioritized_entry_symbols": final.get("prioritized_entry_symbols") or [],
        "policy_version": policy_version,
        "applied_policy": policy,
    }
