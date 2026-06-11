from __future__ import annotations

from typing import Any, Dict, List, Optional, TypedDict


class BotPlanState(TypedDict, total=False):
    """State for quant paper-bot plan-tick LangGraph."""

    cash_usd: float
    positions: List[Dict[str, Any]]
    universe_symbols: List[str]
    prices: Dict[str, float]
    policy: Dict[str, Any]
    quant_rank_by_symbol: Dict[str, Any]
    run_at_iso: Optional[str]
    policy_version: int
    universe_source: str

    error: Optional[str]
    equity_usd: float
    scout_candidates: List[Dict[str, Any]]
    held_enriched: List[Dict[str, Any]]
    regime_label: str
    regime_detail: str
    allow_entries: bool
    allow_exits: bool

    entry_proposals: List[Dict[str, Any]]
    exit_proposals: List[Dict[str, Any]]
    entry_rationale: str
    exit_rationale: str
    grok_used: bool

    debate_results: List[Dict[str, Any]]
    debate_summary: str
    debate_used: bool

    prioritized_exit_symbols: List[str]
    prioritized_entry_symbols: List[str]
    trade_intents: List[Dict[str, Any]]
    rationale: str
    plan: Dict[str, Any]
