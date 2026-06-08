from datetime import datetime, timezone
import logging
import math
import os
import re
from typing import Any, Dict, List, Optional, Set

from .llm_client import LlmClient
from .agent_internal_tools import (
    create_user_alert,
    fetch_research_artifacts,
    fetch_user_alerts,
)
from .market_tools import fetch_stock_history, fetch_stock_quote
from .opportunity_state import OpportunityState


LLM_CLIENT = LlmClient()
logger = logging.getLogger(__name__)

_CRYPTO_HINT = {
    'BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ADA', 'AVAX', 'DOT', 'LINK', 'LTC'
}

# Lightweight headline scan — deterministic; does not claim NLP classification quality.
_NEGATIVE_HEADLINE_HINT = re.compile(
    r"lawsuit|subpoena|downgrade|bankruptcy|recall|fraud|probe|layoff|"
    r"profit\s+warning|trading\s+halt|investigation|indict|criminal|charg(es)?|restat(e|ement)",
    re.I,
)


def _format_live_price(price: Any, asset_type: str) -> str:
    try:
        p = float(price)
    except (TypeError, ValueError):
        return "—"
    if str(asset_type).lower() == "crypto" and p < 10:
        return f"${p:.4f}"
    return f"${p:.2f}"


def format_dashboard_watchlist_digest(ctx: Optional[Any]) -> str:
    """
    Render Node GET /api/agent/watchlist-context payload so the agent reply cites
    the same stocks, quotes, dip bands, and sizing hints as the dashboard.
    """
    if not isinstance(ctx, dict):
        return ""
    items = ctx.get("items") or []
    if not items:
        return ""

    lines = [
        "**Your watchlist & sizing (dashboard)** — stocks you’re tracking for dip alerts:",
        "",
    ]
    for it in items[:25]:
        sym = str(it.get("symbol", "?")).upper()
        atype = str(it.get("assetType", "stock"))
        sizing = it.get("sizing") if isinstance(it.get("sizing"), dict) else {}
        tier = sizing.get("tierLabel") or ""
        sug = sizing.get("suggestedPortfolioPct")
        rationale = str(sizing.get("rationale") or "").strip()
        live = it.get("currentPrice")
        drop = it.get("dropPctFromBaseline")
        baseline = it.get("baselinePrice")
        gap = it.get("nextThresholdGap") if isinstance(it.get("nextThresholdGap"), dict) else {}

        row_bits = [f"- **{sym}** ({atype})"]
        if live is not None:
            row_bits.append(f"live {_format_live_price(live, atype)}")
        if baseline is not None:
            row_bits.append(f"baseline {_format_live_price(baseline, atype)}")
        if isinstance(drop, (int, float)):
            row_bits.append(f"vs baseline {float(drop):+.2f}%")
        row_bits.append(f"**{tier}**" if tier else "")
        if isinstance(sug, (int, float)):
            row_bits.append(f"suggested scale up to **{float(sug)}%** of portfolio (per your max position %)")
        lines.append(" · ".join(x for x in row_bits if x))
        if rationale:
            lines.append(f"  _{rationale}_")
        if gap.get("next") and isinstance(gap.get("pctRemaining"), (int, float)):
            lines.append(
                f"  _Next threshold ({gap['next']}): ~{float(gap['pctRemaining']):.2f}% more dip from baseline._"
            )

    note = ctx.get("policyNote")
    if note:
        lines.extend(["", str(note)])
    mp = ctx.get("maxPositionPct")
    if mp is not None:
        lines.append(f"\n_Reference: max position sizing **{mp}%** from agent controls (educational)._")

    return "\n".join(lines)


def format_research_artifacts_digest(rc: Optional[Any]) -> str:
    """Render Node `research_context` (stored Polygon/news rows) for grounded chat context."""
    if not isinstance(rc, dict):
        return ""
    arts = rc.get("artifacts") if isinstance(rc.get("artifacts"), list) else []
    if not arts:
        return ""
    lines = [
        "**Recent headlines (ingested news)** — context only; verify material facts independently:",
        "",
    ]
    for a in arts[:18]:
        if not isinstance(a, dict):
            continue
        title = str(a.get("title") or "").strip()
        sym = str(a.get("symbol") or "").upper()
        src = str(a.get("source") or "").strip()
        summ = str(a.get("contentSummary") or "").strip()
        if len(summ) > 220:
            summ = summ[:217] + "…"
        row_bits = [f"- **{sym}**"]
        if src:
            row_bits.append(f"[{src}]")
        if title:
            row_bits.append(title)
        lines.append(" ".join(row_bits))
        if summ:
            lines.append(f"  _{summ}_")
    lh = rc.get("lookbackHours")
    if isinstance(lh, (int, float)):
        lines.extend(["", f"_Lookback: last **{int(lh)}** hour(s) from watchlist-scoped ingest._"])
    return "\n".join(lines)


def _watchlist_row_active(row: Any) -> bool:
    """Treat missing active as on (legacy rows); False / 0 = paused."""
    if not isinstance(row, dict):
        return False
    v = row.get("active")
    return v is not False and v != 0


def _active_symbols_from_watchlist_payload(state: OpportunityState) -> Set[str]:
    """Symbols from Node `watchlistContext` the same request already passed — no internal API needed."""
    wl = state.get("watchlist_context") or {}
    items = wl.get("items") if isinstance(wl.get("items"), list) else []
    out: Set[str] = set()
    for it in items:
        if _watchlist_row_active(it):
            sym = str(it.get("symbol") or "").upper().strip()
            if sym:
                out.add(sym)
    return out


def _infer_asset_type(symbol: str, prompt: str = '') -> str:
    s = str(symbol or '').upper()
    if s in _CRYPTO_HINT:
        return 'crypto'
    p = (prompt or '').lower()
    if 'crypto' in p and 'stock' not in p:
        return 'crypto'
    return 'stock'


_QA_HINTS = (
    "what is ",
    "what are ",
    "what does ",
    "what's ",
    "define ",
    "explain ",
    "why did ",
    "why does ",
    "why is ",
    "why are ",
    "how does ",
    "how do ",
    "meaning of ",
    "tell me about ",
    "can you explain",
    "difference between ",
    "what is rsi",
    "what is macd",
    "what is pe ",
    "what is a ",
    "what is an ",
)
_SCAN_HINTS = (
    "rank ",
    "scan ",
    "top opportunit",
    "analyze my watchlist",
    "analyze my active",
    "best candidates",
    "score my",
    "opportunities on my",
    "strongest dip",
    "ranked candidate",
    "rank symbols",
)


def _resolve_intent_from_ui_and_prompt(state: OpportunityState) -> str:
    """Return opportunity_scan (watchlist analyst) or grok_fast (default Grok chat)."""
    raw = str(state.get("assistant_intent") or "grok_chat").strip().lower()
    if raw == "scan_rank":
        return "opportunity_scan"
    # grok_chat (default) + legacy ask_question / smart → fast Grok path
    return "grok_fast"


def _format_conversation_for_llm(history: Optional[Any], max_turns: int = 8) -> str:
    if not isinstance(history, list) or not history:
        return "(No prior turns in this thread.)"
    lines: List[str] = []
    for turn in history[-max_turns:]:
        if not isinstance(turn, dict):
            continue
        role = str(turn.get("role") or "").strip().lower()
        content = str(turn.get("content") or "").strip()
        if not content:
            continue
        if role in ("user", "human"):
            lines.append(f"User: {content[:1200]}")
        elif role in ("assistant", "agent", "ai"):
            lines.append(f"Assistant: {content[:1200]}")
    if not lines:
        return "(No prior turns in this thread.)"
    return "\n".join(lines)


def intent_router(state: OpportunityState) -> OpportunityState:
    prompt = (state.get("prompt") or "").strip()
    if not prompt:
        return {"error": "prompt is required"}
    resolved = _resolve_intent_from_ui_and_prompt(state)
    return {"intent": resolved}


def grok_fast_advisor(state: OpportunityState) -> OpportunityState:
    """Fast Grok Q&A — conversation + user prompt only (no watchlist scan)."""
    try:
        prompt = (state.get("prompt") or "").strip()
        conv = _format_conversation_for_llm(state.get("conversation_history"))
        body = LLM_CLIENT.answer_grok_fast(prompt, conv)
        return {"qa_reply_body": body}
    except Exception as exc:
        logger.warning("grok_fast_advisor: %s", exc)
        return {
            "qa_reply_body": f"Could not reach Grok ({exc}). Check Python service logs and API keys.",
        }


def qa_advisor(state: OpportunityState) -> OpportunityState:
    """Grounded educational Q&A using watchlist digest + optional recent headlines (no ranking)."""
    try:
        uid = int(state.get("user_id") or 0)
        prompt = (state.get("prompt") or "").strip()
        wl_digest = format_dashboard_watchlist_digest(state.get("watchlist_context"))
        conv = _format_conversation_for_llm(state.get("conversation_history"))

        syms = _extract_prompt_tickers(prompt)[:6]
        if not syms:
            syms = sorted(_active_symbols_from_watchlist_payload(state))[:6]
        rc: Dict[str, Any] = {"artifacts": [], "lookbackHours": 24}
        if uid > 0 and syms:
            hours = int(os.getenv("RESEARCH_CONTEXT_LOOKBACK_HOURS", "24") or "24")
            try:
                rc = fetch_research_artifacts(uid, syms, hours=hours, limit=24) or rc
            except Exception as exc:
                logger.warning("qa_advisor research fetch: %s", exc)
        research_digest = format_research_artifacts_digest(rc)

        body = LLM_CLIENT.answer_educational_qa(
            prompt,
            conv,
            watchlist_digest=wl_digest or "(No watchlist rows in context.)",
            research_digest=research_digest or "(No recent ingested headlines for these symbols.)",
        )
        return {"research_context": rc, "qa_reply_body": body}
    except Exception as exc:
        logger.warning("qa_advisor: %s", exc)
        return {
            "research_context": {"artifacts": [], "lookbackHours": 24},
            "qa_reply_body": f"Could not complete Q&A ({exc}). Try again or check Python logs.",
        }


def compose_scan_reply(state: OpportunityState) -> OpportunityState:
    """After scoring: one Grok pass to answer the user's question in plain language from the packet only."""
    try:
        prompt = (state.get("prompt") or "").strip()
        conv = _format_conversation_for_llm(state.get("conversation_history"))
        candidates = state.get("candidates") or []
        scanned = state.get("symbols") or []
        packet = {
            "symbolsScanned": [str(s).upper() for s in scanned[:12]],
            "topCandidates": candidates[:10],
        }
        body = LLM_CLIENT.compose_scan_user_reply(prompt, conv, packet)
        return {"composed_reply_body": body}
    except Exception as exc:
        logger.warning("compose_scan_reply: %s", exc)
        return {"composed_reply_body": ""}


def market_data_loader(state: OpportunityState) -> OpportunityState:
    """Pull live quote + shallow history from Node `/api/charts/*` for grounded scoring."""
    symbols = state.get("symbols") or []
    market_snapshots: Dict[str, Any] = {}
    for sym in symbols:
        quote = fetch_stock_quote(sym)
        if not quote:
            market_snapshots[sym] = {"error": "quote_unavailable"}
            continue
        hist = fetch_stock_history(sym, period="3mo", interval="1wk")
        bars = (hist or {}).get("data") or []
        market_snapshots[sym] = {
            "quote": quote,
            "historyBarCount": len(bars),
            "coverage": (hist or {}).get("coverage"),
        }
    return {"market_snapshots": market_snapshots}


def research_context_loader(state: OpportunityState) -> OpportunityState:
    """§11 Phase C — headlines from Node `research_artifacts`, scoped to this user's watchlist symbols."""
    uid = int(state.get("user_id") or 0)
    syms = list(state.get("symbols") or [])
    hours = int(os.getenv("RESEARCH_CONTEXT_LOOKBACK_HOURS", "24") or "24")
    limit = int(os.getenv("RESEARCH_CONTEXT_ARTIFACT_LIMIT", "50") or "50")
    hours = max(1, min(168, hours))
    limit = max(1, min(200, limit))
    if uid <= 0:
        return {"research_context": {"artifacts": [], "lookbackHours": hours}}
    data = fetch_research_artifacts(uid, syms, hours=hours, limit=limit)
    return {"research_context": data}


def user_context_loader(state: OpportunityState) -> OpportunityState:
    """
    When watchlistOnly is true, scopes candidate tickers to the user's **Main** watchlist
    via Node GET `/api/internal/agent/alerts` (already filtered to Main there) and **active**
    alerts only — aligned with dashboard monitoring.

    Order: explicit prompt tickers (that are active + on Main) → dashboard row order filtered
    to active → sorted(active) capped at 10. Never return a subset skewed by a hardcoded index
    list missing real watchlist names.
    """
    prefs = state.get("preferences") or {}
    watchlist_only = prefs.get("watchlistOnly", True)
    uid = int(state.get("user_id") or 0)

    alerts = fetch_user_alerts(uid) if uid > 0 else []
    active_symbols_set = {
        str(a.get("symbol", "")).upper()
        for a in alerts
        if a.get("active") is True or a.get("active") == 1
    }

    out: Dict[str, Any] = {"user_alert_context": alerts}

    if not watchlist_only or uid <= 0:
        return out

    if not active_symbols_set:
        fallback = _active_symbols_from_watchlist_payload(state)
        if fallback:
            active_symbols_set = fallback
        else:
            return {**out, "symbols": [], "error": "watchlist_empty"}

    cap = 10
    dash_order = list(state.get("symbols") or [])
    ps = [
        str(s).upper()
        for s in (state.get("prompt_symbols") or [])
        if str(s).strip()
    ]

    if ps:
        chosen = []
        seen: Set[str] = set()
        for s in ps:
            if s in active_symbols_set and s not in seen:
                seen.add(s)
                chosen.append(s)
            if len(chosen) >= cap:
                break
        if chosen:
            out["symbols"] = chosen
            return out

    dash_active = []
    dash_seen: Set[str] = set()
    for s in dash_order:
        u = str(s).upper()
        if u in active_symbols_set and u not in dash_seen:
            dash_seen.add(u)
            dash_active.append(u)
        if len(dash_active) >= cap:
            break

    if dash_active:
        out["symbols"] = dash_active
        return out

    out["symbols"] = sorted(active_symbols_set)[:cap]
    return out


def _extract_prompt_tickers(prompt: str) -> List[str]:
    """NYSE-style tickers in ALL CAPS inside the prompt (best-effort)."""
    matches = re.findall(r"\b[A-Z]{1,5}\b", prompt or "")
    out: List[str] = []
    for token in matches:
        if token not in out:
            out.append(token)
    return out


def context_loader(state: OpportunityState) -> OpportunityState:
    """
    Seed symbol universe for downstream nodes.

    When watchlistOnly is true, prefer the **dashboard Main watchlist** from Node
    (`watchlistContext.items`) — same rows as GET /api/agent/watchlist-context with
    integrated quotes/sizing. Do **not** fall back to a hardcoded mega-cap list, or
    we would miss symbols that are on the user's list but not in that default set.

    When watchlistOnly is false, use tickers mentioned in the prompt, else a small
    default liquid set for exploratory scans.
    """
    prompt = state.get("prompt") or ""
    prefs = state.get("preferences") or {}
    watchlist_only = bool(prefs.get("watchlistOnly", True))

    prompt_symbols = _extract_prompt_tickers(prompt)

    if watchlist_only:
        wl_ctx = state.get("watchlist_context") or {}
        raw_items = wl_ctx.get("items") if isinstance(wl_ctx.get("items"), list) else []
        dash: List[str] = []
        for it in raw_items:
            if not isinstance(it, dict):
                continue
            if not _watchlist_row_active(it):
                continue
            sym = str(it.get("symbol") or "").upper().strip()
            if sym and sym not in dash:
                dash.append(sym)
        symbols = dash[:25]
        return {"symbols": symbols[:10], "prompt_symbols": prompt_symbols}

    symbols = []
    for token in prompt_symbols:
        if token not in symbols:
            symbols.append(token)
    if not symbols:
        symbols = ["AAPL", "MSFT", "NVDA", "AMZN", "TSLA"]
    return {"symbols": symbols[:10], "prompt_symbols": prompt_symbols}


def _artifacts_for_symbol(rc: Optional[Any], symbol: str) -> List[Dict[str, Any]]:
    if not isinstance(rc, dict):
        return []
    arts = rc.get("artifacts")
    if not isinstance(arts, list):
        return []
    sym_u = str(symbol).upper().strip()
    return [
        a
        for a in arts
        if isinstance(a, dict) and str(a.get("symbol") or "").upper().strip() == sym_u
    ]


def _research_signals_for_symbol(symbol: str, rc: Optional[Any]) -> Dict[str, Any]:
    """Derive deterministic headline count / keyword hint / LLM blurb from `research_context`."""
    items = _artifacts_for_symbol(rc, symbol)
    neg = False
    blurbs: List[str] = []
    for a in items[:10]:
        title = str(a.get("title") or "").strip()
        summ = str(a.get("contentSummary") or "").strip()
        blob = f"{title} {summ}"
        if _NEGATIVE_HEADLINE_HINT.search(blob):
            neg = True
        if title and len(blurbs) < 6:
            blurbs.append(title[:140])
    blurbs_txt = " | ".join(blurbs)
    return {
        "count": len(items),
        "negative_headline_hint": neg,
        "news_blurb": blurbs_txt[:900],
    }


def _risk_flags_from_event_and_news(event_risk: float, sig: Dict[str, Any]) -> List[str]:
    if sig.get("negative_headline_hint"):
        return ["news_shock_risk", "volatility_elevated"]
    count = int(sig.get("count") or 0)
    if count >= 3:
        return ["news_shock_risk", "volatility_elevated"]
    if event_risk < 0.2:
        return ["normal_volatility"]
    return ["news_shock_risk", "volatility_elevated"]


def opportunity_scout(state: OpportunityState) -> OpportunityState:
    preferences = state.get("preferences", {})
    weights = preferences.get("scoringWeights", {})
    momentum_w = float(weights.get("momentum", 0.35))
    trend_w = float(weights.get("trend", 0.3))
    liquidity_w = float(weights.get("liquidity", 0.2))
    risk_w = float(weights.get("eventRiskPenalty", 0.15))
    confidence_floor = float(preferences.get("confidenceFloor", 0.55))
    top_n = int(preferences.get("topN", 3))

    snapshots = state.get("market_snapshots") or {}
    rc = state.get("research_context") or {}

    candidates = []
    # Scores must not depend on watchlist iteration order — only quotes, research, and symbol-agnostic gates.
    for symbol in state.get("symbols", []):
        sig = _research_signals_for_symbol(symbol, rc)
        snap = snapshots.get(symbol) or {}
        quote = snap.get("quote") if isinstance(snap, dict) else None
        live_boost = 0.0
        if quote and isinstance(quote.get("changePercent"), (int, float)):
            live_boost = max(-0.08, min(0.08, float(quote["changePercent"]) / 500.0))

        news_ct = int(sig["count"])
        neg_hint = bool(sig.get("negative_headline_hint"))
        neg_pen = 0.14 if neg_hint else 0.0
        news_lift = min(0.12, news_ct * 0.014)
        momentum = max(0.35, min(0.95, 0.62 + live_boost + news_lift - neg_pen * 0.45))
        trend = max(0.35, min(0.92, 0.58 + live_boost * 0.48 + news_lift * 0.65))
        liquidity = 0.75 if symbol in ("AAPL", "MSFT", "NVDA") else 0.62
        base_event = min(0.5, 0.16 + min(0.22, news_ct * 0.034) + neg_pen)
        news_bump = min(0.15, float(news_ct) * 0.045)
        if neg_hint:
            news_bump += 0.1
        event_risk = min(0.5, base_event + news_bump)

        score = (momentum * momentum_w) + (trend * trend_w) + (liquidity * liquidity_w) - (event_risk * risk_w)
        score = max(0.0, min(1.0, score))
        confidence = max(0.0, min(1.0, score - event_risk * 0.08))

        risk_flags = _risk_flags_from_event_and_news(event_risk, sig)
        news_ctx = sig["news_blurb"] if sig["news_blurb"] else None
        llm_summary = LLM_CLIENT.summarize_candidate(
            symbol, score, risk_flags, news_context=news_ctx
        )
        px = None
        if quote and isinstance(quote.get("price"), (int, float)):
            px = float(quote["price"])
        if px and math.isfinite(px) and px > 0:
            span = max(0.005, min(0.04, 0.018 + (1.0 - score) * 0.02))
            lo = round(px * (1.0 - span), 4)
            hi = round(px * (1.0 - span * 0.45), 4)
            band = {"min": min(lo, hi), "max": max(lo, hi)}
        else:
            mid = 100.0
            span = 0.022 + max(0.0, min(0.04, (1.0 - score) * 0.05))
            band = {
                "min": round(mid * (1.0 - span), 2),
                "max": round(mid * (1.0 - span * 0.55), 2),
            }

        row = {
            "symbol": symbol,
            "score": round(score, 3),
            "confidence": round(confidence, 3),
            "whyNow": llm_summary.get("whyNow") or f"{symbol} has favorable multi-factor alignment.",
            "riskFlags": risk_flags,
            "researchHeadlinesInWindow": int(sig["count"]),
            "suggestedLimitBand": band,
        }
        if sig["negative_headline_hint"]:
            row["researchNegativeKeywordHint"] = True
        if quote and isinstance(quote.get("price"), (int, float)):
            row["liveQuote"] = {
                "price": float(quote["price"]),
                "changePercent": quote.get("changePercent"),
                "sourceUsed": quote.get("sourceUsed"),
            }
        candidates.append(row)

    candidates = [c for c in candidates if c["confidence"] >= confidence_floor]
    candidates = sorted(
        candidates,
        key=lambda c: (-(c["score"] or 0.0), -(c["confidence"] or 0.0), str(c.get("symbol") or "")),
    )[: max(1, min(top_n, 10))]
    return {"candidates": candidates}


def policy_guardrail(state: OpportunityState) -> OpportunityState:
    """Preserve recommend_only vs auto_apply_low_risk from the caller (Node / Flask)."""
    m = state.get("mode") or "recommend_only"
    if m not in ("recommend_only", "auto_apply_low_risk"):
        m = "recommend_only"
    return {"mode": m}


def alert_creator(state: OpportunityState) -> OpportunityState:
    """
    Optional server-side alert row via Node internal API.
    Enable with LANGGRAPH_ALLOW_INTERNAL_ALERT_CREATE=true.
    Do not use together with frontend auto-apply to the same symbol (duplicate 409 on second create).
    """
    if os.getenv("LANGGRAPH_ALLOW_INTERNAL_ALERT_CREATE", "").lower() != "true":
        return {}
    if state.get("mode") != "auto_apply_low_risk":
        return {}
    uid = int(state.get("user_id") or 0)
    if uid <= 0:
        return {}
    candidates = state.get("candidates") or []
    if not candidates:
        return {"internal_alert_result": {"skipped": True, "reason": "no_candidates"}}

    top = candidates[0]
    sym = str(top.get("symbol", "")).upper()
    if not sym:
        return {}
    prompt = state.get("prompt") or ""
    asset = _infer_asset_type(sym, prompt)
    run_id = state.get("run_id")
    if run_id:
        logger.info("alert_creator run_id=%s symbol=%s user=%s", run_id, sym, uid)
    result = create_user_alert(
        uid, sym, asset, 5.0, 10.0, 15.0, run_id=str(run_id) if run_id else None
    )
    return {"internal_alert_result": result}


def response_formatter(state: OpportunityState) -> OpportunityState:
    err = state.get("error")
    if err == "watchlist_empty":
        return {
            "output": {"schemaVersion": "v1", "topCandidates": [], "assistantPath": "scan"},
            "reply": (
                "Watchlist-only mode found **no active** dashboard symbols to scan. "
                "Add tickers (or unpause rows), or turn off **Watchlist only** for a broader universe. "
                "If your table shows rows but this persists, check **NODE_BACKEND_URL** from Python to Node "
                "and optionally **AGENT_INTERNAL_SECRET** for internal alert syncing."
            ),
        }
    if err:
        return {
            "output": {"schemaVersion": "v1", "topCandidates": [], "assistantPath": "scan"},
            "reply": f"Agent error: {state['error']}",
        }

    if state.get("intent") in ("grok_fast", "educational_qa"):
        qa_body = str(state.get("qa_reply_body") or "").strip()
        if not qa_body:
            qa_body = (
                "I could not generate an answer (Grok unavailable). "
                "Check **GROK_API_KEY** on the Python service and retry."
            )
        path = "grok" if state.get("intent") == "grok_fast" else "qa"
        return {
            "output": {"schemaVersion": "v1", "topCandidates": [], "assistantPath": path},
            "reply": qa_body,
            "as_of": state.get("as_of") or datetime.now(timezone.utc).isoformat(),
        }

    candidates = state.get("candidates", [])
    scanned = state.get("symbols") or []
    scanned_txt = ", ".join(str(s).upper() for s in scanned[:12])
    if scanned_txt and len(scanned) > 12:
        scanned_txt += ", …"
    composed = str(state.get("composed_reply_body") or "").strip()
    if composed:
        reply = composed
    else:
        prefix = (
            f"Analyzed **{len(scanned)}** active watchlist symbol(s): {scanned_txt}. "
            if scanned_txt
            else ""
        )
        reply = (
            f"{prefix}"
            f"Surfaced {len(candidates)} ranked candidate(s). "
            "Review scores, risk flags, and suggested limit bands before taking action."
        )

    wl_digest = format_dashboard_watchlist_digest(state.get("watchlist_context"))
    if wl_digest:
        reply = f"{wl_digest}\n\n---\n\n{reply}"

    research_digest = format_research_artifacts_digest(state.get("research_context"))
    if research_digest:
        reply = f"{research_digest}\n\n---\n\n{reply}"

    iar = state.get("internal_alert_result")
    out: Dict[str, Any] = {"schemaVersion": "v1", "topCandidates": candidates, "assistantPath": "scan"}
    if isinstance(iar, dict):
        out["internalAlertResult"] = iar
        if iar.get("alert"):
            sym = iar["alert"].get("symbol", "?")
            reply += (
                f"\n\nServer-side alert created for {sym} (5% / 10% / 15% thresholds) "
                "via internal API."
            )
        elif iar.get("skipped"):
            pass
        elif iar.get("status_code") == 409:
            reply += "\n\nInternal alert create skipped: an alert for that symbol already exists."
        elif iar.get("error"):
            reply += f"\n\nInternal alert create did not complete: {iar.get('error')}"

    return {
        "output": out,
        "reply": reply,
        "as_of": state.get("as_of") or datetime.now(timezone.utc).isoformat(),
    }
