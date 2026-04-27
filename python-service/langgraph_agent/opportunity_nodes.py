from datetime import datetime, timezone
import re

from .llm_client import LlmClient
from .opportunity_state import OpportunityState


LLM_CLIENT = LlmClient()


def intent_router(state: OpportunityState) -> OpportunityState:
    prompt = (state.get("prompt") or "").strip()
    if not prompt:
        return {"error": "prompt is required"}
    return {"intent": "opportunity_scan"}


def context_loader(state: OpportunityState) -> OpportunityState:
    prompt = (state.get("prompt") or "")
    matches = re.findall(r"\b[A-Z]{1,5}\b", prompt)
    symbols = []
    for token in matches:
        if token not in symbols:
            symbols.append(token)
    if not symbols:
        symbols = ["AAPL", "MSFT", "NVDA", "AMZN", "TSLA"]
    return {"symbols": symbols[:10]}


def opportunity_scout(state: OpportunityState) -> OpportunityState:
    preferences = state.get("preferences", {})
    weights = preferences.get("scoringWeights", {})
    momentum_w = float(weights.get("momentum", 0.35))
    trend_w = float(weights.get("trend", 0.3))
    liquidity_w = float(weights.get("liquidity", 0.2))
    risk_w = float(weights.get("eventRiskPenalty", 0.15))
    confidence_floor = float(preferences.get("confidenceFloor", 0.55))
    top_n = int(preferences.get("topN", 3))

    candidates = []
    for idx, symbol in enumerate(state.get("symbols", [])):
        momentum = max(0.35, 0.78 - idx * 0.04)
        trend = max(0.35, 0.72 - idx * 0.03)
        liquidity = 0.75 if symbol in ("AAPL", "MSFT", "NVDA") else 0.62
        event_risk = min(0.5, 0.12 + idx * 0.04)

        score = (momentum * momentum_w) + (trend * trend_w) + (liquidity * liquidity_w) - (event_risk * risk_w)
        score = max(0.0, min(1.0, score))
        confidence = max(0.0, min(1.0, score - event_risk * 0.08))

        risk_flags = ["normal_volatility"] if event_risk < 0.2 else ["news_shock_risk", "volatility_elevated"]
        llm_summary = LLM_CLIENT.summarize_candidate(symbol, score, risk_flags)
        candidates.append(
            {
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
        )

    candidates = [c for c in candidates if c["confidence"] >= confidence_floor]
    candidates = sorted(candidates, key=lambda c: c["score"], reverse=True)[: max(1, min(top_n, 10))]
    return {"candidates": candidates}


def policy_guardrail(state: OpportunityState) -> OpportunityState:
    # Keep recommendation-only behavior for early phases.
    return {"mode": "recommend_only"}


def response_formatter(state: OpportunityState) -> OpportunityState:
    if state.get("error"):
        return {
            "output": {"schemaVersion": "v1", "topCandidates": []},
            "reply": f"Agent error: {state['error']}",
        }

    candidates = state.get("candidates", [])
    reply = (
        f"Scanned opportunities and found {len(candidates)} candidate(s). "
        "Review scores, risk flags, and suggested limit bands before taking action."
    )
    return {
        "output": {"schemaVersion": "v1", "topCandidates": candidates},
        "reply": reply,
        "as_of": state.get("as_of") or datetime.now(timezone.utc).isoformat(),
    }
