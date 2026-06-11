"""Brain reflection — analyze agent plan history + paper P&L → policy improvement proposals."""

from __future__ import annotations

import json
from typing import Any

from autoresearch.grok_client import effective_grok_api_key, grok_json_object
from config import resolved_grok_model, settings
from paper_trading.grok_bot_advisor import _normalize_proposals

REFLECTION_SYSTEM = """You are the improvement coach for a US equities PAPER trading bot (educational).
Review recent agent plan ticks, fills, and P&L — suggest conservative policy tweaks the human can approve.

Return a single JSON object:
{
  "summary": "2-3 sentences plain English on what worked / what to tighten",
  "insights": {
    "agent_tick_count": number,
    "fill_count": number,
    "agent_fill_rate": number,
    "cum_pnl_usd": number,
    "regime_mix": "short label"
  },
  "proposals": [
    {
      "rule_type": "max_position_pct | max_notional_per_trade | max_open_positions | min_cash_reserve",
      "payload": { "rule_type": "<same>", "value": <number> },
      "rule_text": "<short label>",
      "rationale": "<one sentence tied to observed paper performance>"
    }
  ]
}
Rules:
- Max 2 proposals; only suggest changes when evidence supports it.
- Never propose leverage, options, or live trading.
- Prefer tightening (smaller size, more reserve) after losses or high churn."""


def _regime_mix(agent_plans: list[dict[str, Any]]) -> str:
    counts: dict[str, int] = {}
    for row in agent_plans:
        label = str(row.get("regimeLabel") or row.get("regime_label") or "").strip()
        if label:
            counts[label] = counts.get(label, 0) + 1
    if not counts:
        return "unknown"
    return max(counts.items(), key=lambda kv: kv[1])[0]


def _heuristic_reflection(
    *,
    agent_plans: list[dict[str, Any]],
    recent_trades: list[dict[str, Any]],
    metrics: dict[str, Any],
    current_policy: dict[str, Any],
) -> dict[str, Any]:
    tick_count = len(agent_plans)
    fill_count = len(recent_trades)
    agent_fills = 0
    for t in recent_trades:
        rj = t.get("reasonJson") or t.get("reason_json")
        if isinstance(rj, dict) and rj.get("agent_plan"):
            agent_fills += 1
    agent_fill_rate = round(agent_fills / tick_count, 2) if tick_count else 0.0
    cum_pnl = float(metrics.get("cumPnlUsd") or metrics.get("cum_pnl_usd") or 0)
    max_dd = float(metrics.get("maxDrawdownPct") or metrics.get("max_drawdown_pct") or 0)

    insights = {
        "agent_tick_count": tick_count,
        "fill_count": fill_count,
        "agent_fill_count": agent_fills,
        "agent_fill_rate": agent_fill_rate,
        "cum_pnl_usd": round(cum_pnl, 2),
        "max_drawdown_pct": max_dd,
        "regime_mix": _regime_mix(agent_plans),
    }

    proposals: list[dict[str, Any]] = []
    summary_parts: list[str] = []

    if tick_count == 0:
        summary_parts.append("No agent plan ticks yet — run the bot in multi-agent mode to collect data.")
    else:
        summary_parts.append(
            f"Reviewed {tick_count} agent plan tick(s) and {fill_count} recent fill(s) "
            f"({agent_fills} agent-tagged)."
        )

    reserve = float(current_policy.get("min_cash_reserve") or 500)
    max_notional = float(current_policy.get("max_notional_per_trade") or 750)

    if cum_pnl < -250 or max_dd >= 0.12:
        new_reserve = min(5000, reserve + 250)
        proposals.append(
            {
                "rule_type": "min_cash_reserve",
                "payload": {"rule_type": "min_cash_reserve", "value": new_reserve},
                "rule_text": f"Raise cash reserve to ${new_reserve:g} after drawdown",
                "rationale": "Paper equity under pressure — keep more dry powder while agents learn.",
            }
        )
        summary_parts.append("Drawdown detected — consider more cash reserve.")

    if agent_fill_rate > 0.65 and tick_count >= 3:
        new_notional = max(250, round(max_notional * 0.85, 0))
        proposals.append(
            {
                "rule_type": "max_notional_per_trade",
                "payload": {"rule_type": "max_notional_per_trade", "value": new_notional},
                "rule_text": f"Trim max trade size to ${new_notional:g}",
                "rationale": "High agent fill rate — reduce churn and size while evaluating edge.",
            }
        )

    if not proposals and cum_pnl >= 0 and tick_count >= 2:
        summary_parts.append("No urgent policy tweaks — continue monitoring agent vs rules-only fills.")

    return {
        "ok": True,
        "summary": " ".join(summary_parts).strip(),
        "insights": insights,
        "proposals": _normalize_proposals(proposals),
        "grok_used": False,
    }


def reflect_brain_payload(
    *,
    agent_plans: list[dict[str, Any]] | None = None,
    recent_trades: list[dict[str, Any]] | None = None,
    metrics: dict[str, Any] | None = None,
    current_policy: dict[str, Any] | None = None,
    universe_mode: str = "quant_auto_agent",
) -> dict[str, Any]:
    """Produce brain reflection summary + optional rule proposals."""
    plans = list(agent_plans or [])
    trades = list(recent_trades or [])
    policy = dict(current_policy or {})
    m = dict(metrics or {})

    api_key = effective_grok_api_key(settings.grok_api_key)
    if api_key and (plans or trades):
        model = resolved_grok_model()
        timeout = float(getattr(settings, "grok_http_timeout_sec", None) or 45.0)
        user = json.dumps(
            {
                "universe_mode": universe_mode,
                "current_policy": policy,
                "metrics": m,
                "agent_plans": plans[:12],
                "recent_trades": trades[:20],
            },
            indent=2,
            default=str,
        )
        blob = grok_json_object(
            api_key=api_key,
            base_url=str(settings.grok_base_url or "https://api.x.ai/v1"),
            model=model,
            system=REFLECTION_SYSTEM,
            user=user,
            timeout_sec=timeout,
        )
        if blob and isinstance(blob, dict):
            proposals = _normalize_proposals(blob.get("proposals") if isinstance(blob.get("proposals"), list) else [])
            insights = blob.get("insights") if isinstance(blob.get("insights"), dict) else {}
            summary = str(blob.get("summary") or "").strip()
            if summary or proposals:
                heuristic = _heuristic_reflection(
                    agent_plans=plans,
                    recent_trades=trades,
                    metrics=m,
                    current_policy=policy,
                )
                base_insights = dict(heuristic["insights"])
                base_insights.update({k: v for k, v in insights.items() if v is not None})
                return {
                    "ok": True,
                    "summary": summary or heuristic["summary"],
                    "insights": base_insights,
                    "proposals": proposals or heuristic["proposals"],
                    "grok_used": True,
                }

    return _heuristic_reflection(
        agent_plans=plans,
        recent_trades=trades,
        metrics=m,
        current_policy=policy,
    )
