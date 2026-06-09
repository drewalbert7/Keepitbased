"""Merge approved paper-bot rules into deterministic simulator parameters."""

from __future__ import annotations

from typing import Any

DEFAULT_POLICY: dict[str, float | int] = {
    "max_position_pct": 10.0,
    "max_notional_per_trade": 750.0,
    "min_cash_reserve": 500.0,
    "max_open_positions": 5,
}


def _coerce_policy_value(key: str, value: Any) -> float | int | None:
    if value is None:
        return None
    try:
        if key == "max_open_positions":
            return max(1, min(20, int(float(value))))
        return float(value)
    except (TypeError, ValueError):
        return None


def merge_active_rules(rules: list[dict[str, Any]] | None) -> dict[str, float | int]:
    """Later rules override earlier ones for the same key."""
    policy: dict[str, float | int] = dict(DEFAULT_POLICY)
    for row in rules or []:
        payload = row.get("rule_json") if isinstance(row.get("rule_json"), dict) else {}
        rule_type = str(payload.get("rule_type") or row.get("rule_type") or "").strip()
        if rule_type in DEFAULT_POLICY:
            val = _coerce_policy_value(rule_type, payload.get("value", payload.get(rule_type)))
            if val is not None:
                policy[rule_type] = val
        for key in DEFAULT_POLICY:
            if key in payload:
                val = _coerce_policy_value(key, payload[key])
                if val is not None:
                    policy[key] = val
    return policy
