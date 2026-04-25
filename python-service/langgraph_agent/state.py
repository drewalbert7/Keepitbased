from typing import Any, Dict, List, Optional, TypedDict


class BuyAlertState(TypedDict, total=False):
    symbol: str
    period: str
    interval: str
    max_alerts_per_day: int
    as_of: str

    history_rows: List[Dict[str, Any]]
    latest_close: float
    sma20: float
    sma50: float
    rsi14: float
    macd: float
    macd_signal: float
    volume_ratio: float

    score: int
    confidence: float
    action: str
    entry_zone: Dict[str, float]
    stop_hint: float
    horizon: str
    reasons: List[str]
    invalidation: str
    throttled: bool
    output: Dict[str, Any]
    error: Optional[str]
