"""LangGraph nodes for quant paper-bot entry/exit planning."""

from __future__ import annotations

import json
import logging
from typing import Any

from autoresearch.grok_client import effective_grok_api_key, grok_json_object
from config import resolved_grok_model, settings
from paper_trading.bot_graph.bot_state import BotPlanState
from paper_trading.market_session import is_entry_window, is_exit_window, parse_run_at_iso
from paper_trading.bot_graph.research_agent import (
    apply_research_to_entries,
    apply_research_to_exits,
    research_payload_for_strategists,
    research_weight_map,
    run_research_agent,
)
from paper_trading.learning_memory import (
    apply_regime_coaching_bias,
    coaching_payload_for_graph,
    entry_score_adjustment,
    exit_urgency_boost,
    trusted_symbol_score_boost,
)

logger = logging.getLogger(__name__)

EXIT_SYSTEM = """You are the exit strategist for a US equities PAPER trading bot (educational, not advice).
Given held positions, rank metadata, and regime — propose exits only when momentum thesis weakens or risk rises.

Return a single JSON object:
{
  "exits": [
    {
      "symbol": "TICKER",
      "urgency": 0.0-1.0,
      "reason": "stop_loss | rank_fade | thesis_break | profit_rotate | trim",
      "rationale": "one sentence"
    }
  ],
  "summary": "one sentence on exit posture"
}
Rules:
- Max 3 exit proposals.
- Only symbols from the held list.
- urgency >= 0.85 only for clear risk (stop-level loss, rank collapse).
- Do not propose live trading, leverage, or options.
- When learning_coach is present, follow its exit_posture and avoid patterns.
- When research_agent is present, prioritize its exit_candidates and exit_themes."""

ENTRY_SYSTEM = """You are the entry strategist for a US equities PAPER trading bot (educational, not advice).
Given ranked candidates, cash headroom, regime, and open slots — propose entries for momentum leaders.

Return a single JSON object:
{
  "entries": [
    {
      "symbol": "TICKER",
      "urgency": 0.0-1.0,
      "reason": "momentum_leader | rank_breakout | strategy_confluence",
      "rationale": "one sentence"
    }
  ],
  "summary": "one sentence on entry posture"
}
Rules:
- Max 3 entry proposals, ordered best-first.
- Only symbols from the candidate list (not already held).
- Prefer higher rank scores and strategy confluence.
- Do not propose live trading, leverage, or options.
- When learning_coach is present, follow its entry_posture and agent_hints.
- When research_agent is present, favor enter_candidates and deprioritize avoid list."""


def _upper_symbols(symbols: list[str]) -> list[str]:
    return [str(s).upper().strip() for s in symbols if str(s).strip()]


def _with_coaching(state: BotPlanState, payload: dict[str, Any]) -> dict[str, Any]:
    coach = coaching_payload_for_graph(state.get("learning_memory"))
    if not coach:
        return payload
    return {**payload, **coach}


def load_context(state: BotPlanState) -> BotPlanState:
    positions = state.get("positions") or []
    prices = state.get("prices") or {}
    cash = float(state.get("cash_usd") or 0)
    invested = sum(
        float(p.get("quantity") or 0)
        * float(prices.get(str(p.get("symbol", "")).upper()) or p.get("avg_cost_usd") or 0)
        for p in positions
    )
    return {
        **state,
        "equity_usd": cash + invested,
        "error": state.get("error"),
    }


def universe_scout(state: BotPlanState) -> BotPlanState:
    if state.get("error"):
        return state

    universe = _upper_symbols(state.get("universe_symbols") or [])
    rank_map = state.get("quant_rank_by_symbol") or {}
    prices = state.get("prices") or {}
    held = {str(p.get("symbol", "")).upper() for p in state.get("positions") or [] if p.get("symbol")}
    memory = state.get("learning_memory")

    candidates: list[dict[str, Any]] = []
    for idx, sym in enumerate(universe):
        if sym in held:
            continue
        meta = rank_map.get(sym) if isinstance(rank_map.get(sym), dict) else {}
        score = float(meta.get("score", 0)) if meta else 0.0
        score += trusted_symbol_score_boost(memory, sym)
        strategy = str(meta.get("strategy", "")) if meta else ""
        if meta.get("x_trusted") and strategy == "x_trusted":
            strategy = "x_trusted"
        px = float(prices.get(sym) or 0)
        candidates.append(
            {
                "symbol": sym,
                "rank_index": idx,
                "score": score,
                "strategy": strategy,
                "price_usd": px,
                "x_trusted": bool(meta.get("x_trusted") or trusted_symbol_score_boost(memory, sym) > 0),
            }
        )

    candidates.sort(key=lambda c: (-float(c.get("score") or 0), int(c.get("rank_index") or 999)))

    held_enriched: list[dict[str, Any]] = []
    for p in state.get("positions") or []:
        sym = str(p.get("symbol", "")).upper().strip()
        if not sym:
            continue
        meta = rank_map.get(sym) if isinstance(rank_map.get(sym), dict) else {}
        px = float(prices.get(sym) or p.get("avg_cost_usd") or 0)
        avg = float(p.get("avg_cost_usd") or p.get("avg_cost") or 0)
        pnl_pct = ((px - avg) / avg * 100.0) if avg > 0 and px > 0 else 0.0
        held_enriched.append(
            {
                "symbol": sym,
                "quantity": float(p.get("quantity") or 0),
                "avg_cost_usd": avg,
                "price_usd": px,
                "pnl_pct": round(pnl_pct, 2),
                "rank_score": float(meta.get("score", 0)) if meta else 0.0,
                "rank_strategy": str(meta.get("strategy", "")) if meta else "",
                "rank_index": universe.index(sym) if sym in universe else None,
            }
        )

    return {**state, "scout_candidates": candidates[:15], "held_enriched": held_enriched}


def regime_analyst(state: BotPlanState) -> BotPlanState:
    if state.get("error"):
        return state

    run_at = parse_run_at_iso(state.get("run_at_iso"))
    allow_entries = is_entry_window(run_at)
    allow_exits = is_exit_window(run_at)

    candidates = state.get("scout_candidates") or []
    top_scores = [float(c.get("score") or 0) for c in candidates[:5] if float(c.get("score") or 0) > 0]
    avg_top = sum(top_scores) / len(top_scores) if top_scores else 0.0

    if not allow_entries and not allow_exits:
        label = "closed"
        detail = "Outside US entry/exit windows — plan is observe-only."
    elif avg_top >= 72:
        label = "risk_on"
        detail = f"Strong rank tape (top-5 avg {avg_top:.0f}) — favor selective entries."
    elif avg_top >= 55:
        label = "moderate"
        detail = f"Mixed tape (top-5 avg {avg_top:.0f}) — prioritize quality entries and trim weak holds."
    else:
        label = "cautious"
        detail = f"Weak tape (top-5 avg {avg_top:.0f}) — exits over new entries."

    label, detail = apply_regime_coaching_bias(label, detail, state.get("learning_memory"))

    return {
        **state,
        "regime_label": label,
        "regime_detail": detail,
        "allow_entries": allow_entries,
        "allow_exits": allow_exits,
    }


def research_strategist(state: BotPlanState) -> BotPlanState:
    """Synthesize papers + trusted X + coaching into weighted position guidance."""
    if state.get("error"):
        return state

    result = run_research_agent(
        scout_candidates=state.get("scout_candidates") or [],
        held_enriched=state.get("held_enriched") or [],
        regime_label=state.get("regime_label") or "moderate",
        regime_detail=state.get("regime_detail") or "",
        learning_memory=state.get("learning_memory"),
        x_research_snippets=state.get("x_research_snippets"),
    )
    used_grok = bool(result.get("research_used_grok"))
    return {
        **state,
        "research_brief": result.get("brief") or "",
        "research_entry_themes": result.get("entry_themes") or [],
        "research_exit_themes": result.get("exit_themes") or [],
        "research_recommendations": result.get("positions") or [],
        "research_used_grok": used_grok,
        "grok_used": bool(state.get("grok_used")) or used_grok,
    }


def _research_avoid_symbols(state: BotPlanState) -> set[str]:
    avoids: set[str] = set()
    for rec in state.get("research_recommendations") or []:
        if str(rec.get("action")).lower() == "avoid" and float(rec.get("weight") or 0) >= 0.65:
            sym = str(rec.get("symbol", "")).upper()
            if sym:
                avoids.add(sym)
    return avoids


def _deterministic_exit_proposals(state: BotPlanState) -> tuple[list[dict[str, Any]], str]:
    universe = _upper_symbols(state.get("universe_symbols") or [])
    rank_map = state.get("quant_rank_by_symbol") or {}
    proposals: list[dict[str, Any]] = []

    severity = {"stop_loss": 1.0, "rank_drop": 0.85, "rank_score_floor": 0.75, "profit_rotate": 0.65}
    urg_boost = exit_urgency_boost(state.get("learning_memory"))

    for row in state.get("held_enriched") or []:
        sym = str(row.get("symbol", "")).upper()
        reason = evaluate_exit_reason(
            symbol=sym,
            avg_cost_usd=float(row.get("avg_cost_usd") or 0),
            price_usd=float(row.get("price_usd") or 0),
            quant_rank_by_symbol=rank_map,
            ordered_universe=universe,
        )
        if not reason:
            continue
        proposals.append(
            {
                "symbol": sym,
                "urgency": round(min(1.0, severity.get(reason, 0.6) + urg_boost), 3),
                "reason": reason,
                "rationale": f"Policy exit signal: {reason}",
                "source": "deterministic",
            }
        )

    proposals.sort(key=lambda p: -float(p.get("urgency") or 0))
    proposals = apply_research_to_exits(proposals, state.get("research_recommendations"))
    summary = (
        f"Deterministic exits: {len(proposals)} symbol(s) with policy signals."
        if proposals
        else "Deterministic exits: hold — no policy exit signals."
    )
    return proposals[:3], summary


def _deterministic_entry_proposals(state: BotPlanState) -> tuple[list[dict[str, Any]], str]:
    if not state.get("allow_entries"):
        return [], "Entry window closed — no new entries."

    regime = state.get("regime_label") or "moderate"
    if regime == "cautious":
        return [], "Cautious regime — defer new entries."

    policy = state.get("policy") or {}
    max_open = int(policy.get("max_open_positions") or 5)
    open_count = len(state.get("held_enriched") or [])
    slots = max(0, max_open - open_count)
    if slots <= 0:
        return [], "Max open positions reached."

    score_adj = entry_score_adjustment(state.get("learning_memory"))
    min_score = 52.0 + score_adj

    proposals: list[dict[str, Any]] = []
    avoids = _research_avoid_symbols(state)
    for cand in state.get("scout_candidates") or []:
        sym = str(cand.get("symbol", "")).upper()
        if sym in avoids:
            continue
        score = float(cand.get("score") or 0)
        if score <= 0 or score < min_score:
            continue
        urgency = min(0.95, max(0.5, score / 100.0))
        if regime == "moderate":
            urgency *= 0.92
        proposals.append(
            {
                "symbol": sym,
                "urgency": round(urgency, 3),
                "reason": "momentum_leader",
                "rationale": f"Rank score {score:.0f} ({cand.get('strategy') or 'rank'})",
                "source": "deterministic",
            }
        )
        if len(proposals) >= min(3, slots):
            break

    proposals = apply_research_to_entries(proposals, state.get("research_recommendations"))
    summary = (
        f"Deterministic entries: top {len(proposals)} candidate(s) by rank score."
        if proposals
        else "Deterministic entries: none qualify."
    )
    return proposals, summary


def _grok_strategist(
    *,
    system: str,
    user_payload: dict[str, Any],
    parse_key: str,
) -> dict[str, Any] | None:
    api_key = effective_grok_api_key(settings.grok_api_key)
    if not api_key:
        return None
    model = resolved_grok_model()
    timeout = float(getattr(settings, "grok_http_timeout_sec", None) or 45.0)
    user = json.dumps(user_payload, indent=2)
    return grok_json_object(
        api_key=api_key,
        base_url=str(settings.grok_base_url or "https://api.x.ai/v1"),
        model=model,
        system=system,
        user=user,
        timeout_sec=timeout,
    )


def _normalize_proposals(
    raw: list[Any],
    *,
    allowed_symbols: set[str],
    kind: str,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in raw[:3]:
        if not isinstance(item, dict):
            continue
        sym = str(item.get("symbol", "")).upper().strip()
        if sym not in allowed_symbols:
            continue
        try:
            urgency = float(item.get("urgency", 0.5))
        except (TypeError, ValueError):
            urgency = 0.5
        urgency = max(0.0, min(1.0, urgency))
        out.append(
            {
                "symbol": sym,
                "urgency": round(urgency, 3),
                "reason": str(item.get("reason") or kind)[:48],
                "rationale": str(item.get("rationale") or "")[:280],
                "source": "grok",
            }
        )
    return out


def exit_strategist(state: BotPlanState) -> BotPlanState:
    if state.get("error"):
        return state

    held_syms = {str(r.get("symbol", "")).upper() for r in state.get("held_enriched") or []}
    if not held_syms or not state.get("allow_exits"):
        proposals, summary = _deterministic_exit_proposals(state)
        return {
            **state,
            "exit_proposals": proposals,
            "exit_rationale": summary if not held_syms else "Exit window closed — holds only.",
            "grok_used": bool(state.get("grok_used")),
        }

    user_payload = _with_coaching(
        state,
        {
            **research_payload_for_strategists(state),
            "regime": state.get("regime_label"),
            "regime_detail": state.get("regime_detail"),
            "held_positions": state.get("held_enriched"),
            "universe_top": (state.get("scout_candidates") or [])[:8],
        },
    )
    blob = _grok_strategist(system=EXIT_SYSTEM, user_payload=user_payload, parse_key="exits")
    grok_used = bool(state.get("grok_used"))

    if blob and isinstance(blob.get("exits"), list):
        proposals = _normalize_proposals(blob["exits"], allowed_symbols=held_syms, kind="exit")
        proposals = apply_research_to_exits(proposals, state.get("research_recommendations"))
        summary = str(blob.get("summary") or "Grok exit strategist.")
        if proposals:
            grok_used = True
            return {**state, "exit_proposals": proposals, "exit_rationale": summary, "grok_used": grok_used}

    proposals, summary = _deterministic_exit_proposals(state)
    return {**state, "exit_proposals": proposals, "exit_rationale": summary, "grok_used": grok_used}


def entry_strategist(state: BotPlanState) -> BotPlanState:
    if state.get("error"):
        return state

    cand_syms = {str(c.get("symbol", "")).upper() for c in state.get("scout_candidates") or []}
    if not cand_syms or not state.get("allow_entries"):
        proposals, summary = _deterministic_entry_proposals(state)
        return {
            **state,
            "entry_proposals": proposals,
            "entry_rationale": summary,
            "grok_used": bool(state.get("grok_used")),
        }

    policy = state.get("policy") or {}
    cash = float(state.get("cash_usd") or 0)
    reserve = float(policy.get("min_cash_reserve") or 500)

    user_payload = _with_coaching(
        state,
        {
            **research_payload_for_strategists(state),
            "regime": state.get("regime_label"),
            "regime_detail": state.get("regime_detail"),
            "candidates": (state.get("scout_candidates") or [])[:12],
            "cash_usd": cash,
            "cash_headroom_usd": max(0.0, cash - reserve),
            "open_positions": len(state.get("held_enriched") or []),
            "max_open_positions": int(policy.get("max_open_positions") or 5),
        },
    )
    blob = _grok_strategist(system=ENTRY_SYSTEM, user_payload=user_payload, parse_key="entries")
    grok_used = bool(state.get("grok_used"))

    if blob and isinstance(blob.get("entries"), list):
        proposals = _normalize_proposals(blob["entries"], allowed_symbols=cand_syms, kind="entry")
        proposals = apply_research_to_entries(proposals, state.get("research_recommendations"))
        summary = str(blob.get("summary") or "Grok entry strategist.")
        if proposals:
            grok_used = True
            return {**state, "entry_proposals": proposals, "entry_rationale": summary, "grok_used": grok_used}

    proposals, summary = _deterministic_entry_proposals(state)
    return {**state, "entry_proposals": proposals, "entry_rationale": summary, "grok_used": grok_used}


DEBATE_SYSTEM = """You moderate a brief bull vs bear debate for a US equities PAPER bot (educational).
Given top entry candidates and regime — score each side and render a verdict.

Return a single JSON object:
{
  "debates": [
    {
      "symbol": "TICKER",
      "bull_score": 0-100,
      "bear_score": 0-100,
      "verdict": "enter | wait | avoid",
      "bull_case": "one short sentence",
      "bear_case": "one short sentence",
      "summary": "one sentence verdict"
    }
  ],
  "panel_summary": "one sentence on the panel consensus"
}
Rules:
- Max 3 symbols from the candidate list.
- verdict enter only when momentum thesis is clearly supported.
- Not investment advice; paper simulation only.
- When research_agent is present, align verdicts with enter/avoid guidance and cite research themes."""


def _top_entry_candidates(state: BotPlanState, limit: int = 3) -> list[dict[str, Any]]:
    props = list(state.get("entry_proposals") or [])
    if props:
        return props[:limit]
    return list(state.get("scout_candidates") or [])[:limit]


def _deterministic_debate(state: BotPlanState, candidates: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str]:
    regime = state.get("regime_label") or "moderate"
    regime_penalty = {"risk_on": 0, "moderate": 8, "cautious": 22, "closed": 40}.get(regime, 10)
    research_by_sym = research_weight_map(state.get("research_recommendations"))
    debates: list[dict[str, Any]] = []

    for cand in candidates[:3]:
        sym = str(cand.get("symbol", "")).upper()
        if not sym:
            continue
        rank_score = float(cand.get("score") or cand.get("rank_score") or 0)
        if rank_score <= 0:
            rank_score = float(cand.get("urgency") or 0.5) * 100.0
        bull = max(0.0, min(100.0, rank_score))
        bear = max(0.0, min(100.0, 100.0 - bull + regime_penalty))
        rec = research_by_sym.get(sym)
        if rec:
            action = str(rec.get("action") or "hold").lower()
            weight = float(rec.get("weight") or 0.5)
            if action == "enter":
                bull = min(100.0, bull + 6 * weight)
                bear = max(0.0, bear - 4 * weight)
            elif action == "avoid":
                bear = min(100.0, bear + 10 * weight)
                bull = max(0.0, bull - 8 * weight)
        if bull >= bear + 18 and regime != "cautious":
            verdict = "enter"
        elif bull >= bear + 5:
            verdict = "wait"
        else:
            verdict = "avoid"
        debates.append(
            {
                "symbol": sym,
                "bull_score": round(bull, 1),
                "bear_score": round(bear, 1),
                "verdict": verdict,
                "bull_case": f"Rank/momentum score {bull:.0f} in {regime} tape.",
                "bear_case": f"Tape risk score {bear:.0f} — rotation or mean-reversion risk.",
                "summary": f"Panel: {verdict} ({bull:.0f} vs {bear:.0f}).",
                "source": "deterministic",
            }
        )

    summary = (
        f"Deterministic debate on {len(debates)} candidate(s) — "
        f"{sum(1 for d in debates if d.get('verdict') == 'enter')} enter verdict(s)."
        if debates
        else "No entry candidates to debate."
    )
    return debates, summary


def _apply_debate_to_entries(
    entry_props: list[dict[str, Any]],
    debates: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not debates:
        return entry_props
    by_sym = {str(d.get("symbol", "")).upper(): d for d in debates}
    refined: list[dict[str, Any]] = []
    for prop in entry_props:
        sym = str(prop.get("symbol", "")).upper()
        debate = by_sym.get(sym)
        if not debate:
            refined.append(prop)
            continue
        verdict = str(debate.get("verdict") or "wait")
        urgency = float(prop.get("urgency") or 0.5)
        if verdict == "enter":
            urgency = min(0.98, urgency + 0.08)
        elif verdict == "avoid":
            urgency = max(0.15, urgency - 0.35)
        else:
            urgency = max(0.25, urgency - 0.1)
        refined.append(
            {
                **prop,
                "urgency": round(urgency, 3),
                "debate_verdict": verdict,
                "debate_summary": debate.get("summary"),
            }
        )
    refined.sort(key=lambda p: -float(p.get("urgency") or 0))
    return refined


def candidate_debate(state: BotPlanState) -> BotPlanState:
    if state.get("error"):
        return state

    candidates = _top_entry_candidates(state, 3)
    if not candidates or not state.get("allow_entries"):
        debates, summary = _deterministic_debate(state, candidates)
        return {
            **state,
            "debate_results": debates,
            "debate_summary": summary if candidates else "Entry window closed — no debate.",
            "debate_used": False,
        }

    allowed = {str(c.get("symbol", "")).upper() for c in candidates if c.get("symbol")}
    user_payload = _with_coaching(
        state,
        {
            **research_payload_for_strategists(state),
            "regime": state.get("regime_label"),
            "regime_detail": state.get("regime_detail"),
            "candidates": candidates,
            "held_positions": state.get("held_enriched"),
        },
    )
    blob = _grok_strategist(system=DEBATE_SYSTEM, user_payload=user_payload, parse_key="debates")
    grok_used = bool(state.get("grok_used"))
    debate_used = bool(state.get("debate_used"))

    debates: list[dict[str, Any]] = []
    if blob and isinstance(blob.get("debates"), list):
        for item in blob["debates"][:3]:
            if not isinstance(item, dict):
                continue
            sym = str(item.get("symbol", "")).upper().strip()
            if sym not in allowed:
                continue
            verdict = str(item.get("verdict") or "wait").lower()
            if verdict not in {"enter", "wait", "avoid"}:
                verdict = "wait"
            try:
                bull = float(item.get("bull_score", 50))
                bear = float(item.get("bear_score", 50))
            except (TypeError, ValueError):
                bull, bear = 50.0, 50.0
            debates.append(
                {
                    "symbol": sym,
                    "bull_score": round(max(0, min(100, bull)), 1),
                    "bear_score": round(max(0, min(100, bear)), 1),
                    "verdict": verdict,
                    "bull_case": str(item.get("bull_case") or "")[:200],
                    "bear_case": str(item.get("bear_case") or "")[:200],
                    "summary": str(item.get("summary") or "")[:280],
                    "source": "grok",
                }
            )
        if debates:
            grok_used = True
            debate_used = True
            summary = str(blob.get("panel_summary") or "Grok candidate debate.")
        else:
            debates, summary = _deterministic_debate(state, candidates)
    else:
        debates, summary = _deterministic_debate(state, candidates)

    entry_props = _apply_debate_to_entries(state.get("entry_proposals") or [], debates)
    entry_rationale = (state.get("entry_rationale") or "").strip()
    if summary:
        entry_rationale = f"{entry_rationale} {summary}".strip()

    return {
        **state,
        "debate_results": debates,
        "debate_summary": summary,
        "debate_used": debate_used,
        "entry_proposals": entry_props,
        "entry_rationale": entry_rationale,
        "grok_used": grok_used,
    }


def reconcile(state: BotPlanState) -> BotPlanState:
    if state.get("error"):
        return state

    exit_props = state.get("exit_proposals") or []
    entry_props = state.get("entry_proposals") or []

    exit_syms: list[str] = []
    seen: set[str] = set()
    for p in sorted(exit_props, key=lambda x: -float(x.get("urgency") or 0)):
        sym = str(p.get("symbol", "")).upper()
        if sym and sym not in seen:
            seen.add(sym)
            exit_syms.append(sym)

    entry_syms: list[str] = []
    seen_entry: set[str] = set()
    for p in sorted(entry_props, key=lambda x: -float(x.get("urgency") or 0)):
        sym = str(p.get("symbol", "")).upper()
        if sym and sym not in seen_entry and sym not in exit_syms:
            seen_entry.add(sym)
            entry_syms.append(sym)

    return {
        **state,
        "prioritized_exit_symbols": exit_syms,
        "prioritized_entry_symbols": entry_syms,
    }


def risk_manager(state: BotPlanState) -> BotPlanState:
    if state.get("error"):
        return state

    universe = _upper_symbols(state.get("universe_symbols") or [])
    universe_set = set(universe)
    rank_map = state.get("quant_rank_by_symbol") or {}
    max_sells = 2
    max_buys = 1

    validated_exits: list[str] = []
    for sym in state.get("prioritized_exit_symbols") or []:
        if sym not in universe_set and sym not in {str(r.get("symbol", "")).upper() for r in state.get("held_enriched") or []}:
            continue
        row = next((r for r in state.get("held_enriched") or [] if str(r.get("symbol")).upper() == sym), None)
        if not row:
            continue
        policy_reason = evaluate_exit_reason(
            symbol=sym,
            avg_cost_usd=float(row.get("avg_cost_usd") or 0),
            price_usd=float(row.get("price_usd") or 0),
            quant_rank_by_symbol=rank_map,
            ordered_universe=universe,
        )
        prop = next((p for p in state.get("exit_proposals") or [] if str(p.get("symbol")).upper() == sym), {})
        urgency = float(prop.get("urgency") or 0)
        research_exit = (
            str(prop.get("research_action") or "").lower() == "exit"
            and float(prop.get("research_weight") or 0) >= 0.72
        )
        if policy_reason or urgency >= 0.85 or research_exit:
            validated_exits.append(sym)
        if len(validated_exits) >= max_sells:
            break

    validated_entries: list[str] = []
    held = {str(r.get("symbol", "")).upper() for r in state.get("held_enriched") or []}
    policy = state.get("policy") or {}
    max_open = int(policy.get("max_open_positions") or 5)
    slots = max(0, max_open - len(held))

    if state.get("allow_entries") and slots > 0:
        for sym in state.get("prioritized_entry_symbols") or []:
            if sym not in universe_set or sym in held:
                continue
            validated_entries.append(sym)
            if len(validated_entries) >= min(max_buys, slots):
                break

    return {
        **state,
        "prioritized_exit_symbols": validated_exits,
        "prioritized_entry_symbols": validated_entries,
    }


def execution_planner(state: BotPlanState) -> BotPlanState:
    if state.get("error"):
        return state

    trade_intents: list[dict[str, Any]] = []
    for sym in state.get("prioritized_exit_symbols") or []:
        prop = next((p for p in state.get("exit_proposals") or [] if str(p.get("symbol")).upper() == sym), {})
        trade_intents.append(
            {
                "action": "sell",
                "symbol": sym,
                "urgency": prop.get("urgency"),
                "reason": prop.get("reason"),
                "rationale": prop.get("rationale"),
                "source": prop.get("source", "agent"),
            }
        )
    for sym in state.get("prioritized_entry_symbols") or []:
        prop = next((p for p in state.get("entry_proposals") or [] if str(p.get("symbol")).upper() == sym), {})
        trade_intents.append(
            {
                "action": "buy",
                "symbol": sym,
                "urgency": prop.get("urgency"),
                "reason": prop.get("reason"),
                "rationale": prop.get("rationale"),
                "source": prop.get("source", "agent"),
            }
        )

    rationale_parts = [
        state.get("research_brief") or "",
        state.get("regime_detail") or "",
        state.get("debate_summary") or "",
        state.get("exit_rationale") or "",
        state.get("entry_rationale") or "",
    ]
    rationale = " ".join(p for p in rationale_parts if p).strip()

    plan = {
        "phase": "5d",
        "regime_label": state.get("regime_label"),
        "regime_detail": state.get("regime_detail"),
        "grok_used": bool(state.get("grok_used")),
        "research_used_grok": bool(state.get("research_used_grok")),
        "research_brief": state.get("research_brief"),
        "research_entry_themes": state.get("research_entry_themes") or [],
        "research_exit_themes": state.get("research_exit_themes") or [],
        "research_recommendations": state.get("research_recommendations") or [],
        "debate_used": bool(state.get("debate_used")),
        "allow_entries": state.get("allow_entries"),
        "allow_exits": state.get("allow_exits"),
        "debate_results": state.get("debate_results") or [],
        "debate_summary": state.get("debate_summary"),
        "exit_proposals": state.get("exit_proposals") or [],
        "entry_proposals": state.get("entry_proposals") or [],
        "prioritized_exit_symbols": state.get("prioritized_exit_symbols") or [],
        "prioritized_entry_symbols": state.get("prioritized_entry_symbols") or [],
        "trade_intents": trade_intents,
        "rationale": rationale,
    }

    return {
        **state,
        "trade_intents": trade_intents,
        "rationale": rationale,
        "plan": plan,
    }
