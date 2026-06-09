"""Grok-powered (or heuristic fallback) user note → rule proposals."""

from __future__ import annotations

import re
from typing import Any

from autoresearch.grok_client import effective_grok_api_key, grok_json_object
from config import settings, resolved_grok_model

ADVISOR_SYSTEM = """You parse natural-language trading style notes for a US equities PAPER trading bot.
Return a single JSON object:
{
  "proposals": [
    {
      "rule_type": "max_position_pct | max_notional_per_trade | max_open_positions | min_cash_reserve",
      "payload": { "rule_type": "<same>", "value": <number> },
      "rule_text": "<short human label>",
      "rationale": "<one sentence, educational tone>"
    }
  ]
}
Rules:
- Max 3 proposals per note.
- max_position_pct: 1-25 (percent of cash/equity per position)
- max_notional_per_trade: 100-5000 USD
- max_open_positions: 1-10
- min_cash_reserve: 250-5000 USD
- Do NOT propose live trading, leverage, or options.
- If the note is vague, propose one conservative sizing cap."""


def _normalize_proposals(raw: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    allowed = {"max_position_pct", "max_notional_per_trade", "max_open_positions", "min_cash_reserve"}
    for item in raw[:3]:
        if not isinstance(item, dict):
            continue
        rule_type = str(item.get("rule_type") or "").strip()
        if rule_type not in allowed:
            continue
        payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
        value = payload.get("value", payload.get(rule_type))
        try:
            value_f = float(value)
        except (TypeError, ValueError):
            continue
        rule_text = str(item.get("rule_text") or f"{rule_type.replace('_', ' ')}: {value_f}").strip()
        rationale = str(item.get("rationale") or "Parsed from your trading note.").strip()
        out.append(
            {
                "rule_type": rule_type,
                "payload": {"rule_type": rule_type, "value": value_f},
                "rule_text": rule_text[:240],
                "rationale": rationale[:500],
            }
        )
    return out


def _heuristic_proposals(note: str) -> list[dict[str, Any]]:
    text = note.lower()
    proposals: list[dict[str, Any]] = []

    pct_match = re.search(r"(\d+(?:\.\d+)?)\s*%\s*(?:per\s+position|position|max)?", text)
    if pct_match:
        val = min(25.0, max(1.0, float(pct_match.group(1))))
        proposals.append(
            {
                "rule_type": "max_position_pct",
                "payload": {"rule_type": "max_position_pct", "value": val},
                "rule_text": f"Cap each position at {val:g}% of capital",
                "rationale": "Heuristic parse from your note (Grok unavailable).",
            }
        )

    if "small" in text or "conservative" in text:
        proposals.append(
            {
                "rule_type": "max_notional_per_trade",
                "payload": {"rule_type": "max_notional_per_trade", "value": 400.0},
                "rule_text": "Limit each trade to $400 notional",
                "rationale": "Conservative sizing keyword detected.",
            }
        )

    if "few" in text or "concentrated" in text:
        proposals.append(
            {
                "rule_type": "max_open_positions",
                "payload": {"rule_type": "max_open_positions", "value": 3},
                "rule_text": "Hold at most 3 open positions",
                "rationale": "Concentration keyword detected.",
            }
        )

    if not proposals:
        proposals.append(
            {
                "rule_type": "max_position_pct",
                "payload": {"rule_type": "max_position_pct", "value": 8.0},
                "rule_text": "Default cap: 8% per position",
                "rationale": "Default conservative rule when note could not be parsed precisely.",
            }
        )

    return proposals[:3]


def interpret_user_note(note: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return { ok, proposals, model, used_grok }."""
    cleaned = str(note or "").strip()[:4000]
    if not cleaned:
        return {"ok": False, "error": "Note text required", "proposals": []}

    ctx = context or {}
    user_prompt = (
        f"User note:\n{cleaned}\n\n"
        f"Account context: equity=${ctx.get('equity_usd', '?')}, cash=${ctx.get('cash_usd', '?')}, "
        f"policy_version={ctx.get('policy_version', 1)}, active_rules={ctx.get('active_rules_count', 0)}."
    )

    key = effective_grok_api_key(settings.grok_api_key)
    if key:
        model = resolved_grok_model()
        timeout = float(min(90, max(15, settings.grok_request_timeout_sec)))
        data = grok_json_object(
            api_key=key,
            base_url=settings.grok_base_url,
            model=model,
            system=ADVISOR_SYSTEM,
            user=user_prompt,
            timeout_sec=timeout,
        )
        if isinstance(data, dict) and isinstance(data.get("proposals"), list):
            proposals = _normalize_proposals(data["proposals"])
            if proposals:
                return {"ok": True, "proposals": proposals, "model": model, "used_grok": True}

    return {
        "ok": True,
        "proposals": _heuristic_proposals(cleaned),
        "model": None,
        "used_grok": False,
    }
