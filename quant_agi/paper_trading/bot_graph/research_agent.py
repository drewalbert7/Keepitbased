"""Research agent — papers + trusted X → weighted position guidance for entry/exit."""

from __future__ import annotations

import json
import re
from typing import Any

from autoresearch.grok_client import effective_grok_api_key, grok_json_object
from config import resolved_grok_model, settings
from paper_trading.learning_memory import coaching_payload_for_graph
from paper_trading.learning_outcomes import outcome_window_trades

_CASHTAG_RE = re.compile(r"\$([A-Z]{1,5})\b")

# Coach overlay caps — rank tape stays primary.
COACH_WEIGHT_BOOST_MAX = 0.06
X_WHISPER_WEIGHT_BOOST_MAX = 0.04
ENTRY_URGENCY_COACH_MULT = 0.05
ENTRY_URGENCY_AVOID_MULT = 0.18

RESEARCH_SYSTEM = """You are the research COACH for a US equities PAPER trading bot (educational).
Rank tape (scout_candidates scores) is the PRIMARY engine for symbol selection.
Your job: overlay paper lessons and trusted X themes — never override strong rank ordering.

Synthesize learning_coach lessons and trusted_x_snippets into posture guidance for entry/exit strategists.

Return a single JSON object:
{
  "brief": "2-3 sentences: what research + trusted traders imply for entries/exits now",
  "entry_themes": ["short theme from papers or @handles"],
  "exit_themes": ["when to trim or avoid"],
  "positions": [
    {
      "symbol": "TICKER",
      "action": "enter | exit | hold | avoid",
      "weight": 0.0-1.0,
      "rationale": "one sentence citing paper lesson or @handle post",
      "source": "paper | trusted_x | rank | blended"
    }
  ]
}
Rules:
- Max 8 positions; only symbols from scout_candidates or held_positions lists.
- Rank score ordering is primary — coach weights nudge urgency, not replace rank.
- Trusted X is a weak whisper — small weight boosts only when rank already supports the name.
- weight >= 0.75 + action enter → nudge only if rank score >= 55; action avoid → deprioritize weak ranks.
- Ground rationales in learning_coach lessons or trusted_x_snippets — do not invent sources.
- entry_themes / exit_themes must align with coaching_directives (entry_posture, exit_posture).
- Paper simulation only — not investment advice."""


def _extract_cashtags(text: str) -> list[str]:
    return list(dict.fromkeys(_CASHTAG_RE.findall(str(text or "").upper())))


def _trusted_symbols_from_snippets(snippets: list[Any]) -> dict[str, float]:
    """Symbol -> mention weight from trusted X posts."""
    weights: dict[str, float] = {}
    for item in snippets or []:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "")
        author = str(item.get("author") or item.get("authorUsername") or "").strip()
        for sym in item.get("cashtags") or _extract_cashtags(text):
            weights[sym] = weights.get(sym, 0.0) + 1.0
        if author and text:
            for sym in _extract_cashtags(text):
                weights[sym] = weights.get(sym, 0.0) + 0.5
    return weights


def _normalize_positions(
    raw: list[Any],
    *,
    allowed: set[str],
    max_items: int = 8,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        sym = str(item.get("symbol") or "").upper().strip()
        if not sym or sym not in allowed:
            continue
        action = str(item.get("action") or "hold").lower().strip()
        if action not in {"enter", "exit", "hold", "avoid"}:
            action = "hold"
        try:
            weight = float(item.get("weight") or 0.5)
        except (TypeError, ValueError):
            weight = 0.5
        weight = max(0.0, min(1.0, weight))
        out.append(
            {
                "symbol": sym,
                "action": action,
                "weight": round(weight, 3),
                "rationale": str(item.get("rationale") or "")[:280],
                "source": str(item.get("source") or "blended")[:32],
            }
        )
        if len(out) >= max_items:
            break
    return out


def deterministic_research(
    *,
    scout_candidates: list[dict[str, Any]],
    held_enriched: list[dict[str, Any]],
    learning_memory: dict[str, Any] | None,
    x_research_snippets: list[dict[str, Any]] | None,
    regime_label: str,
) -> dict[str, Any]:
    """Score positions from coaching memory + trusted X cashtags + rank (no Grok)."""
    directives = (learning_memory or {}).get("coaching_directives") or {}
    trusted_from_memory = {
        str(s).upper()
        for s in (directives.get("trusted_symbols") or [])
        if str(s).strip()
    }
    x_weights = _trusted_symbols_from_snippets(x_research_snippets or [])
    entry_posture = str(directives.get("entry_posture") or "balanced").lower()
    exit_posture = str(directives.get("exit_posture") or "balanced").lower()
    priority_themes = directives.get("priority_themes") or []
    avoid_list = directives.get("avoid") or []

    positions: list[dict[str, Any]] = []
    held_syms = {str(r.get("symbol", "")).upper() for r in held_enriched or []}

    for cand in scout_candidates or []:
        sym = str(cand.get("symbol", "")).upper()
        if not sym or sym in held_syms:
            continue
        score = float(cand.get("score") or 0)
        weight = min(0.95, max(0.35, score / 100.0))
        action = "enter"
        source = "rank"
        rationale = f"Rank score {score:.0f}"

        if sym in trusted_from_memory:
            weight = min(0.98, weight + COACH_WEIGHT_BOOST_MAX)
            source = "blended"
            rationale = "Coach trusted symbol + rank tape"
        if sym in x_weights:
            boost = min(X_WHISPER_WEIGHT_BOOST_MAX, x_weights[sym] * 0.02)
            weight = min(0.98, weight + boost)
            source = "trusted_x" if source == "rank" else "blended"
            rationale = f"Trusted X cashtag momentum (weight {x_weights[sym]:.0f}) + rank {score:.0f}"

        if entry_posture == "patient" and weight < 0.72:
            action = "hold"
            rationale = f"Patient entry posture — wait for stronger confirmation (score {score:.0f})"
        if regime_label == "cautious":
            action = "avoid" if weight < 0.8 else "hold"
            rationale = f"Cautious regime — selective only ({rationale})"

        positions.append(
            {
                "symbol": sym,
                "action": action,
                "weight": round(weight, 3),
                "rationale": rationale[:280],
                "source": source,
            }
        )

    for row in held_enriched or []:
        sym = str(row.get("symbol", "")).upper()
        if not sym:
            continue
        rank_score = float(row.get("rank_score") or 0)
        pnl_pct = float(row.get("pnl_pct") or 0)
        weight = 0.5
        action = "hold"
        rationale = f"Hold — rank {rank_score:.0f}, P&L {pnl_pct:+.1f}%"
        if exit_posture == "protect_capital" and (pnl_pct < -4 or rank_score < 45):
            action = "exit"
            weight = 0.82
            rationale = "Protect capital — weak rank or drawdown on position"
        elif pnl_pct > 12 and exit_posture == "let_winners_run":
            action = "hold"
            weight = 0.7
            rationale = "Let winners run per coaching exit posture"
        positions.append(
            {
                "symbol": sym,
                "action": action,
                "weight": round(weight, 3),
                "rationale": rationale,
                "source": "blended",
            }
        )

    positions.sort(key=lambda p: -float(p.get("weight") or 0))
    positions = positions[:8]

    theme_note = ", ".join(str(t) for t in priority_themes[:2]) if priority_themes else "momentum leaders"
    avoid_note = f" Avoid: {avoid_list[0]}." if avoid_list else ""
    brief = (
        f"Research layer: {entry_posture} entries, {exit_posture} exits — focus {theme_note}."
        f"{avoid_note} {len(x_weights)} trusted-X cashtag(s) in play."
    ).strip()

    lessons = (learning_memory or {}).get("lessons") or []
    if lessons and isinstance(lessons[0], dict):
        title = str(lessons[0].get("title") or "")
        if title:
            brief = f"{brief} Top lesson: {title[:120]}."

    return {
        "brief": brief[:1200],
        "entry_themes": [str(t)[:120] for t in priority_themes[:3]],
        "exit_themes": [str(a)[:120] for a in avoid_list[:2]] or ["protect capital on rank fade"],
        "positions": positions,
        "research_used_grok": False,
    }


def run_research_agent(
    *,
    scout_candidates: list[dict[str, Any]],
    held_enriched: list[dict[str, Any]],
    regime_label: str,
    regime_detail: str,
    learning_memory: dict[str, Any] | None,
    x_research_snippets: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    allowed = {str(c.get("symbol", "")).upper() for c in scout_candidates or [] if c.get("symbol")}
    allowed |= {str(r.get("symbol", "")).upper() for r in held_enriched or [] if r.get("symbol")}

    fallback = deterministic_research(
        scout_candidates=scout_candidates,
        held_enriched=held_enriched,
        learning_memory=learning_memory,
        x_research_snippets=x_research_snippets,
        regime_label=regime_label or "moderate",
    )

    api_key = effective_grok_api_key(settings.grok_api_key)
    if not api_key:
        return fallback

    coach = coaching_payload_for_graph(learning_memory)
    user_payload = {
        "regime": regime_label,
        "regime_detail": regime_detail,
        **coach,
        "scout_candidates": (scout_candidates or [])[:12],
        "held_positions": held_enriched or [],
        "trusted_x_snippets": (x_research_snippets or [])[:8],
    }
    model = resolved_grok_model()
    timeout = float(getattr(settings, "grok_http_timeout_sec", None) or 45.0)
    blob = grok_json_object(
        api_key=api_key,
        base_url=str(settings.grok_base_url or "https://api.x.ai/v1"),
        model=model,
        system=RESEARCH_SYSTEM,
        user=json.dumps(user_payload, indent=2, default=str),
        timeout_sec=timeout,
    )
    if not blob or not isinstance(blob, dict):
        return fallback

    positions = _normalize_positions(
        blob.get("positions") if isinstance(blob.get("positions"), list) else [],
        allowed=allowed,
    )
    brief = str(blob.get("brief") or fallback.get("brief") or "").strip()
    if not positions and not brief:
        return fallback

    entry_themes = blob.get("entry_themes") if isinstance(blob.get("entry_themes"), list) else fallback.get("entry_themes")
    exit_themes = blob.get("exit_themes") if isinstance(blob.get("exit_themes"), list) else fallback.get("exit_themes")

    return {
        "brief": brief or fallback["brief"],
        "entry_themes": [str(t)[:120] for t in (entry_themes or []) if t][:4],
        "exit_themes": [str(t)[:120] for t in (exit_themes or []) if t][:4],
        "positions": positions or fallback["positions"],
        "research_used_grok": bool(positions or brief),
    }


def research_weight_map(recommendations: list[dict[str, Any]] | None) -> dict[str, dict[str, Any]]:
    return {
        str(r.get("symbol", "")).upper(): r
        for r in (recommendations or [])
        if r.get("symbol")
    }


def apply_research_to_entries(
    proposals: list[dict[str, Any]],
    recommendations: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    by_sym = research_weight_map(recommendations)
    if not by_sym:
        return proposals
    out: list[dict[str, Any]] = []
    for prop in proposals:
        sym = str(prop.get("symbol", "")).upper()
        rec = by_sym.get(sym)
        if not rec:
            out.append(prop)
            continue
        urgency = float(prop.get("urgency") or 0.5)
        action = str(rec.get("action") or "hold").lower()
        weight = float(rec.get("weight") or 0.5)
        if action == "enter":
            urgency = min(0.98, urgency + ENTRY_URGENCY_COACH_MULT * weight)
        elif action == "avoid":
            urgency = max(0.1, urgency - ENTRY_URGENCY_AVOID_MULT * weight)
        elif action == "hold":
            urgency = max(0.2, urgency - 0.08)
        out.append(
            {
                **prop,
                "urgency": round(urgency, 3),
                "research_action": action,
                "research_weight": weight,
                "research_rationale": rec.get("rationale"),
            }
        )
    out.sort(key=lambda p: -float(p.get("urgency") or 0))
    return out


def apply_research_to_exits(
    proposals: list[dict[str, Any]],
    recommendations: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    by_sym = research_weight_map(recommendations)
    if not by_sym:
        return proposals
    seen = {str(p.get("symbol", "")).upper() for p in proposals}
    out = list(proposals)
    for rec in recommendations or []:
        sym = str(rec.get("symbol", "")).upper()
        if not sym or sym in seen:
            if sym in seen and str(rec.get("action")).lower() == "exit":
                for p in out:
                    if str(p.get("symbol")).upper() == sym:
                        p["urgency"] = min(0.98, float(p.get("urgency") or 0.5) + 0.1 * float(rec.get("weight") or 0.5))
                        p["research_rationale"] = rec.get("rationale")
            continue
        if str(rec.get("action")).lower() != "exit":
            continue
        weight = float(rec.get("weight") or 0.5)
        if weight < 0.65:
            continue
        out.append(
            {
                "symbol": sym,
                "urgency": round(min(0.95, 0.7 + 0.2 * weight), 3),
                "reason": "research_exit",
                "rationale": str(rec.get("rationale") or "Research agent exit signal")[:280],
                "source": "research",
                "research_action": "exit",
                "research_weight": weight,
            }
        )
        seen.add(sym)
    out.sort(key=lambda p: -float(p.get("urgency") or 0))
    return out[:3]


def research_payload_for_strategists(state: dict[str, Any]) -> dict[str, Any]:
    """Attach research brief + top picks to Grok strategist calls."""
    recs = state.get("research_recommendations") or []
    enters = [r for r in recs if str(r.get("action")).lower() == "enter"][:5]
    exits = [r for r in recs if str(r.get("action")).lower() == "exit"][:3]
    avoids = [r for r in recs if str(r.get("action")).lower() == "avoid"][:5]
    payload: dict[str, Any] = {}
    if state.get("research_brief"):
        payload["research_agent"] = {
            "brief": state.get("research_brief"),
            "entry_themes": state.get("research_entry_themes") or [],
            "exit_themes": state.get("research_exit_themes") or [],
            "enter_candidates": enters,
            "exit_candidates": exits,
            "avoid": avoids,
        }
    return payload
