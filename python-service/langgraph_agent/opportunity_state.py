from typing import Any, Dict, List, Optional, TypedDict


class OpportunityState(TypedDict, total=False):
    prompt: str
    mode: str
    preferences: Dict[str, Any]
    user_id: int
    as_of: str
    run_id: str

    intent: str
    symbols: List[str]
    prompt_symbols: List[str]
    user_alert_context: List[Dict[str, Any]]
    market_snapshots: Dict[str, Any]
    candidates: List[Dict[str, Any]]
    internal_alert_result: Dict[str, Any]
    output: Dict[str, Any]
    reply: str
    error: Optional[str]
    # Mirrors Node GET /api/agent/watchlist-context — dashboard quotes & sizing
    watchlist_context: Optional[Dict[str, Any]]
