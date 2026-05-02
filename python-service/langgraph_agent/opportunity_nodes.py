from datetime import datetime, timezone
import logging
import os
import re
from typing import Any, Dict, List, Optional, Set

from .llm_client import LlmClient
from .agent_internal_tools import create_user_alert, fetch_user_alerts
from .market_tools import fetch_stock_history, fetch_stock_quote
from .opportunity_state import OpportunityState


LLM_CLIENT = LlmClient()
logger = logging.getLogger(__name__)

_CRYPTO_HINT = {
    'BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ADA', 'AVAX', 'DOT', 'LINK', 'LTC'
}


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


def intent_router(state: OpportunityState) -> OpportunityState:
    prompt = (state.get("prompt") or "").strip()
    if not prompt:
        return {"error": "prompt is required"}
    return {"intent": "opportunity_scan"}


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

    candidates = []
    for idx, symbol in enumerate(state.get("symbols", [])):
        snap = snapshots.get(symbol) or {}
        quote = snap.get("quote") if isinstance(snap, dict) else None
        live_boost = 0.0
        if quote and isinstance(quote.get("changePercent"), (int, float)):
            live_boost = max(-0.08, min(0.08, float(quote["changePercent"]) / 500.0))

        momentum = max(0.35, 0.78 - idx * 0.04 + live_boost)
        trend = max(0.35, 0.72 - idx * 0.03 + live_boost * 0.5)
        liquidity = 0.75 if symbol in ("AAPL", "MSFT", "NVDA") else 0.62
        event_risk = min(0.5, 0.12 + idx * 0.04)

        score = (momentum * momentum_w) + (trend * trend_w) + (liquidity * liquidity_w) - (event_risk * risk_w)
        score = max(0.0, min(1.0, score))
        confidence = max(0.0, min(1.0, score - event_risk * 0.08))

        risk_flags = ["normal_volatility"] if event_risk < 0.2 else ["news_shock_risk", "volatility_elevated"]
        llm_summary = LLM_CLIENT.summarize_candidate(symbol, score, risk_flags)
        row = {
            "symbol": symbol,
            "score": round(score, 3),
            "confidence": round(confidence, 3),
            "whyNow": llm_summary.get("whyNow") or f"{symbol} has favorable multi-factor alignment.",
            "riskFlags": risk_flags,
            "suggestedLimitBand": {
                "min": round(100 * (1 - 0.03 - idx * 0.002), 2),
                "max": round(100 * (1 - 0.015 - idx * 0.002), 2),
            },
        }
        if quote and isinstance(quote.get("price"), (int, float)):
            row["liveQuote"] = {
                "price": float(quote["price"]),
                "changePercent": quote.get("changePercent"),
                "sourceUsed": quote.get("sourceUsed"),
            }
        candidates.append(row)

    candidates = [c for c in candidates if c["confidence"] >= confidence_floor]
    candidates = sorted(candidates, key=lambda c: c["score"], reverse=True)[: max(1, min(top_n, 10))]
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
            "output": {"schemaVersion": "v1", "topCandidates": []},
            "reply": (
                "Watchlist-only mode found **no active** dashboard symbols to scan. "
                "Add tickers (or unpause rows), or turn off **Watchlist only** for a broader universe. "
                "If your table shows rows but this persists, check **NODE_BACKEND_URL** from Python to Node "
                "and optionally **AGENT_INTERNAL_SECRET** for internal alert syncing."
            ),
        }
    if err:
        return {
            "output": {"schemaVersion": "v1", "topCandidates": []},
            "reply": f"Agent error: {state['error']}",
        }

    candidates = state.get("candidates", [])
    scanned = state.get("symbols") or []
    scanned_txt = ", ".join(str(s).upper() for s in scanned[:12])
    if scanned_txt and len(scanned) > 12:
        scanned_txt += ", …"
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

    iar = state.get("internal_alert_result")
    out: Dict[str, Any] = {"schemaVersion": "v1", "topCandidates": candidates}
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
