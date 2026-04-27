from typing import Any, Dict, List, Optional, TypedDict


class OpportunityState(TypedDict, total=False):
    prompt: str
    mode: str
    preferences: Dict[str, Any]
    user_id: int
    as_of: str

    intent: str
    symbols: List[str]
    candidates: List[Dict[str, Any]]
    output: Dict[str, Any]
    reply: str
    error: Optional[str]
