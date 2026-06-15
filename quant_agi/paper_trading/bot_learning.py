"""Bot learning lab — external research + paper performance → teachable improvements."""

from __future__ import annotations

import json
from typing import Any

from autoresearch.grok_client import effective_grok_api_key, grok_json_object
from autoresearch.web_research import gather_research_context, research_capabilities
from autoresearch.x_research import build_trusted_x_context
from config import resolved_grok_model, settings
from paper_trading.grok_bot_advisor import _normalize_proposals
from paper_trading.learning_memory import build_learning_memory_from_cycle
from paper_trading.learning_outcomes import attach_outcome_gated_memory

LEARNING_SYSTEM = """You are the research coach for a US equities PAPER trading bot (educational).
Your lessons directly teach the multi-agent plan graph (research_strategist, entry_strategist,
exit_strategist, candidate_debate) how to choose trades — optimal entry timing, exit discipline,
and which symbols to favor or avoid on the next session.

You receive:
1) Recent paper-trading performance and agent activity
2) Trusted X monitor accounts you follow (source_type x_monitor) — PRIORITIZE these over arXiv and generic X search
3) Supplemental arXiv papers and broader X discourse

Synthesize practical lessons and conservative policy tweaks the human operator can approve.
Ground lessons from trusted X monitors in specific post themes; cite @handles when used.
Extract cashtags ($TICKER) from trusted monitors into coaching_directives.trusted_symbols (max 8).

Each lesson must teach trade-level behavior: when to enter (patient vs aggressive), when to exit
(trim vs hold winners), and which names match paper momentum + trusted trader themes.

Return a single JSON object:
{
  "summary": "2-4 sentences: what the bot should learn next",
  "lessons": [
    {
      "title": "short lesson headline",
      "detail": "2-3 sentences tying source insight to this bot's observed behavior",
      "source_titles": ["arXiv title or @author X post theme you used"]
    }
  ],
  "proposals": [
    {
      "rule_type": "max_position_pct | max_notional_per_trade | max_open_positions | min_cash_reserve",
      "payload": { "rule_type": "<same>", "value": <number> },
      "rule_text": "<short label>",
      "rationale": "<one sentence citing research/X discourse + paper metrics>"
    }
  ],
  "agent_hints": [
    "Optional plain-English hint for the multi-agent graph (regime, sizing, exit patience) — not executable code"
  ],
  "coaching_directives": {
    "regime_bias": "neutral | prefer_cautious | prefer_opportunistic",
    "entry_posture": "balanced | patient | aggressive_leader",
    "exit_posture": "balanced | protect_capital | let_winners_run",
    "priority_themes": ["short theme tied to research or metrics"],
    "avoid": ["pattern or behavior to de-emphasize this week"],
    "trusted_symbols": ["TICKER symbols from trusted X monitors only — not dashboard defaults"]
  }
}
Rules:
- Max 3 lessons, max 2 proposals, max 3 agent_hints, max 8 trusted_symbols.
- When trusted X monitor posts exist, at least one lesson must reference a monitored @handle.
- trusted_symbols must come from cashtags in trusted monitor posts — do not invent tickers.
- coaching_directives must be actionable for a paper momentum bot — no live trading advice.
- entry_posture / exit_posture must reflect paper lessons (e.g. patient entries after drawdown, protect_capital exits).
- priority_themes should name trade setups the research agent can weight (e.g. "semis momentum", "avoid chase").
- Prefer prefer_cautious + patient + protect_capital after drawdowns; do not flip to aggressive without strong evidence.
- Proposals must be conservative sizing caps only — no leverage, options, or live trading.
- If X search returned nothing, still use arXiv sources and internal metrics.
- Prefer tightening after losses; do not propose aggressive size-ups without strong evidence.
- Coaching tightens only when prior cycle improved paper metrics over the next N trades (outcome gate)."""


def _derive_research_queries(
    *,
    metrics: dict[str, Any],
    nightly_context: dict[str, Any] | None,
    universe_mode: str,
    agent_plans: list[dict[str, Any]],
) -> list[str]:
    queries: list[str] = []
    cum_pnl = float(metrics.get("cumPnlUsd") or metrics.get("cum_pnl_usd") or 0)
    max_dd = float(metrics.get("maxDrawdownPct") or metrics.get("max_drawdown_pct") or 0)
    sharpe = float(metrics.get("sharpeProxy") or metrics.get("sharpe_proxy") or 0)
    trade_count = int(metrics.get("tradeCount") or metrics.get("trade_count") or 0)

    if cum_pnl < -200 or max_dd >= 0.08:
        queries.append("drawdown control position sizing systematic equity trading")
    if sharpe < 0.5 and trade_count >= 5:
        queries.append("momentum factor equity short horizon quantitative")
    if trade_count >= 10:
        queries.append("transaction costs turnover reduction algorithmic trading")
    if agent_plans:
        queries.append("market regime detection multi agent trading system")
    if universe_mode in ("quant_auto", "quant_auto_agent"):
        queries.append("cross sectional momentum rank portfolio construction equities")

    tags = (nightly_context or {}).get("topReasonTags") or (nightly_context or {}).get("top_reason_tags") or []
    if isinstance(tags, list) and tags:
        top = tags[0]
        tag = top.get("tag") if isinstance(top, dict) else str(top)
        if tag:
            queries.append(f"quantitative trading {tag} risk management")

    if not queries:
        queries.append("systematic equity trading risk management position sizing")

    # Dedupe while preserving order
    seen: set[str] = set()
    out: list[str] = []
    for q in queries:
        key = q.lower()
        if key not in seen:
            seen.add(key)
            out.append(q)
    return out[:4]


def _format_sources_for_prompt(sources: list[dict[str, str]]) -> str:
    if not sources:
        return "(No external sources retrieved — rely on paper metrics only.)"
    lines: list[str] = []
    for i, src in enumerate(sources[:12], start=1):
        lines.append(
            f"{i}. [{src.get('source_type', 'source')}] {src.get('title', 'Untitled')}\n"
            f"   URL: {src.get('url', 'n/a')}\n"
            f"   Snippet: {src.get('snippet', '')[:400]}"
        )
    return "\n\n".join(lines)


def _normalize_coaching_directives(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    themes = raw.get("priority_themes") if isinstance(raw.get("priority_themes"), list) else []
    avoid = raw.get("avoid") if isinstance(raw.get("avoid"), list) else []
    return {
        "regime_bias": str(raw.get("regime_bias") or "neutral")[:32],
        "entry_posture": str(raw.get("entry_posture") or "balanced")[:32],
        "exit_posture": str(raw.get("exit_posture") or "balanced")[:32],
        "priority_themes": [str(t)[:120] for t in themes if t][:4],
        "avoid": [str(a)[:120] for a in avoid if a][:4],
        "trusted_symbols": [
            str(s).upper().strip()[:8]
            for s in (raw.get("trusted_symbols") or [])
            if str(s).strip()
        ][:8],
    }


def _heuristic_coaching_directives(
    metrics: dict[str, Any],
    trusted_x: dict[str, Any] | None = None,
) -> dict[str, Any]:
    cum_pnl = float(metrics.get("cumPnlUsd") or metrics.get("cum_pnl_usd") or 0)
    max_dd = float(metrics.get("maxDrawdownPct") or metrics.get("max_drawdown_pct") or 0)
    trusted_symbols = list((trusted_x or {}).get("trusted_symbols") or [])[:8]
    if cum_pnl < -200 or max_dd >= 0.08:
        return {
            "regime_bias": "prefer_cautious",
            "entry_posture": "patient",
            "exit_posture": "protect_capital",
            "priority_themes": ["drawdown control", "rank quality over quantity"],
            "avoid": ["chasing low-rank fills outside quant windows"],
            "trusted_symbols": trusted_symbols,
        }
    return {
        "regime_bias": "neutral",
        "entry_posture": "balanced",
        "exit_posture": "balanced",
        "priority_themes": ["momentum leaders with strategy confluence"],
        "avoid": [],
        "trusted_symbols": trusted_symbols,
    }


def _attach_learning_memory(
    payload: dict[str, Any],
    *,
    source: str = "manual",
    previous_learning_memory: dict[str, Any] | None = None,
    recent_trades: list[dict[str, Any]] | None = None,
    current_metrics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if previous_learning_memory or recent_trades or current_metrics:
        return attach_outcome_gated_memory(
            payload,
            previous_memory=previous_learning_memory,
            recent_trades=recent_trades,
            current_metrics=current_metrics,
            source=source,
        )
    memory = build_learning_memory_from_cycle(payload, source=source)
    directives = memory.get("coaching_directives") or {}
    memory["effective_directives"] = directives
    memory["proposed_directives"] = directives
    memory["signal_hierarchy"] = {
        "rank": "primary",
        "coach": "overlay",
        "x_whisper": "weak_overlay",
    }
    return {**payload, "learning_memory": memory}


def _heuristic_learning(
    *,
    metrics: dict[str, Any],
    sources: list[dict[str, str]],
    queries_run: list[str],
    capabilities: dict[str, bool],
    trusted_x: dict[str, Any] | None = None,
    previous_learning_memory: dict[str, Any] | None = None,
    recent_trades: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    cum_pnl = float(metrics.get("cumPnlUsd") or metrics.get("cum_pnl_usd") or 0)
    lessons: list[dict[str, Any]] = []
    monitor_sources = [s for s in sources if s.get("source_type") == "x_monitor"]
    if monitor_sources:
        first = monitor_sources[0]
        lessons.append(
            {
                "title": "Follow trusted X monitor discourse",
                "detail": (
                    f"Prioritized {len(monitor_sources)} post(s) from your configured X monitors. "
                    "Let their cashtags and risk framing guide scout candidates beyond dashboard lists."
                ),
                "source_titles": [str(first.get("title") or "Trusted X monitor")],
            }
        )
    elif sources:
        first = sources[0]
        lessons.append(
            {
                "title": "Review external quant research",
                "detail": (
                    f"Found {len(sources)} source(s) for queries {', '.join(queries_run[:2])}. "
                    "Read drawdown and sizing guidance before loosening caps."
                ),
                "source_titles": [str(first.get("title") or "External source")],
            }
        )
    else:
        lessons.append(
            {
                "title": "Collect more paper data first",
                "detail": "Run the bot in multi-agent mode for several sessions before large policy changes.",
                "source_titles": [],
            }
        )

    proposals: list[dict[str, Any]] = []
    if cum_pnl < -300:
        proposals.append(
            {
                "rule_type": "min_cash_reserve",
                "payload": {"rule_type": "min_cash_reserve", "value": 1000},
                "rule_text": "Raise cash reserve to $1,000 while learning",
                "rationale": "Paper P&L is negative — classic risk literature favors more dry powder during drawdowns.",
            }
        )

    x_note = "X via x_search" if capabilities.get("x_search") else "X search off"
    if capabilities.get("x_monitor"):
        x_note += " + monitored accounts"
    if not capabilities.get("x"):
        x_note = "arxiv only (set XAI_API_KEY for X search)"
    coaching = _heuristic_coaching_directives(metrics, trusted_x)
    monitor_note = ""
    if trusted_x and trusted_x.get("trusted_symbols"):
        monitor_note = f" Trusted cashtags: {', '.join(trusted_x['trusted_symbols'][:6])}."
    base = {
        "ok": True,
        "summary": (
            f"Learning cycle reviewed {len(sources)} source(s) ({x_note})."
            + monitor_note
            + " "
            + ("Paper equity is under pressure — favor conservative sizing." if cum_pnl < 0 else "Continue monitoring; no urgent cap changes.")
        ),
        "lessons": lessons,
        "proposals": _normalize_proposals(proposals),
        "agent_hints": [
            "Favor regime-aware entries when rank tape is mixed; avoid forcing fills outside quant windows."
        ],
        "coaching_directives": coaching,
        "trusted_x": trusted_x or {},
        "sources": sources,
        "research_queries": queries_run,
        "capabilities": capabilities,
        "grok_used": False,
    }
    return _attach_learning_memory(
        base,
        source="heuristic",
        previous_learning_memory=previous_learning_memory,
        recent_trades=recent_trades,
        current_metrics=metrics,
    )


def run_bot_learning_payload(
    *,
    agent_plans: list[dict[str, Any]] | None = None,
    recent_trades: list[dict[str, Any]] | None = None,
    metrics: dict[str, Any] | None = None,
    nightly_context: dict[str, Any] | None = None,
    current_policy: dict[str, Any] | None = None,
    universe_mode: str = "quant_auto_agent",
    x_monitor_posts: list[dict[str, Any]] | None = None,
    x_monitor_accounts: list[dict[str, Any]] | None = None,
    x_ticker_buzz: list[dict[str, Any]] | None = None,
    previous_learning_memory: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Research external sources and synthesize bot learning output."""
    plans = list(agent_plans or [])
    trades = list(recent_trades or [])
    m = dict(metrics or {})
    policy = dict(current_policy or {})
    nightly = dict(nightly_context or {}) if nightly_context else {}
    x_monitor = bool(x_monitor_posts or x_monitor_accounts or x_ticker_buzz)
    caps = research_capabilities(x_monitor_configured=x_monitor)
    trusted_x = build_trusted_x_context(
        x_monitor_posts,
        x_monitor_accounts=x_monitor_accounts,
        x_ticker_buzz=x_ticker_buzz,
    )

    queries = _derive_research_queries(
        metrics=m,
        nightly_context=nightly or None,
        universe_mode=universe_mode,
        agent_plans=plans,
    )
    x_context = {
        "symbols_traded": nightly.get("symbolsTraded") or nightly.get("symbols_traded") or [],
        "trusted_symbols": trusted_x.get("trusted_symbols") or [],
        "monitor_accounts": trusted_x.get("monitor_accounts") or [],
    }
    sources, queries_run = gather_research_context(
        queries,
        max_per_query=3,
        include_x=True,
        x_context=x_context,
        x_monitor_posts=x_monitor_posts,
        prefer_x_monitor=True,
    )

    api_key = effective_grok_api_key(settings.grok_api_key)
    if api_key:
        model = resolved_grok_model()
        timeout = float(getattr(settings, "grok_request_timeout_sec", None) or 90.0)
        user = (
            f"## Paper bot performance\n{json.dumps({'metrics': m, 'current_policy': policy, 'universe_mode': universe_mode, 'agent_plan_count': len(plans), 'recent_trade_count': len(trades)}, indent=2, default=str)}\n\n"
            f"## Nightly context\n{json.dumps(nightly, indent=2, default=str)}\n\n"
            f"## Trusted X monitors (PRIORITY)\n{json.dumps(trusted_x, indent=2, default=str)}\n\n"
            f"## Research queries\n{json.dumps(queries_run, indent=2)}\n\n"
            f"## External sources (x_monitor listed first)\n{_format_sources_for_prompt(sources)}"
        )
        blob = grok_json_object(
            api_key=api_key,
            base_url=str(settings.grok_base_url or "https://api.x.ai/v1"),
            model=model,
            system=LEARNING_SYSTEM,
            user=user,
            timeout_sec=timeout,
        )
        if blob and isinstance(blob, dict):
            lessons_raw = blob.get("lessons") if isinstance(blob.get("lessons"), list) else []
            lessons: list[dict[str, Any]] = []
            for item in lessons_raw[:3]:
                if isinstance(item, dict) and item.get("title"):
                    lessons.append(
                        {
                            "title": str(item.get("title"))[:160],
                            "detail": str(item.get("detail") or "")[:800],
                            "source_titles": [
                                str(t)[:160]
                                for t in (item.get("source_titles") or [])
                                if t
                            ][:4],
                        }
                    )
            hints_raw = blob.get("agent_hints") if isinstance(blob.get("agent_hints"), list) else []
            agent_hints = [str(h)[:240] for h in hints_raw[:3] if str(h).strip()]
            coaching = _normalize_coaching_directives(blob.get("coaching_directives"))
            if not coaching.get("trusted_symbols") and trusted_x.get("trusted_symbols"):
                coaching["trusted_symbols"] = trusted_x["trusted_symbols"][:8]
            proposals = _normalize_proposals(
                blob.get("proposals") if isinstance(blob.get("proposals"), list) else []
            )
            summary = str(blob.get("summary") or "").strip()
            if summary or lessons or proposals:
                base = {
                    "ok": True,
                    "summary": summary or "Learning cycle complete.",
                    "lessons": lessons,
                    "proposals": proposals,
                    "agent_hints": agent_hints,
                    "coaching_directives": coaching,
                    "trusted_x": trusted_x,
                    "sources": sources,
                    "research_queries": queries_run,
                    "capabilities": caps,
                    "grok_used": True,
                }
                return _attach_learning_memory(
                    base,
                    source="grok",
                    previous_learning_memory=previous_learning_memory,
                    recent_trades=trades,
                    current_metrics=m,
                )

    return _heuristic_learning(
        metrics=m,
        sources=sources,
        queries_run=queries_run,
        capabilities=caps,
        trusted_x=trusted_x,
        previous_learning_memory=previous_learning_memory,
        recent_trades=trades,
    )
