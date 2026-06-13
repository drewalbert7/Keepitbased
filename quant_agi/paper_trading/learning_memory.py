"""Persistent coaching memory from bot learning → multi-agent plan graph."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def build_learning_memory_from_cycle(data: dict[str, Any], *, source: str = "manual") -> dict[str, Any]:
    """Normalize learning-cycle output for storage and plan-tick injection."""
    directives = data.get("coaching_directives") if isinstance(data.get("coaching_directives"), dict) else {}
    lessons = data.get("lessons") if isinstance(data.get("lessons"), list) else []
    hints = data.get("agent_hints") if isinstance(data.get("agent_hints"), list) else []
    return {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "summary": str(data.get("summary") or "").strip()[:1200] or None,
        "lessons": lessons[:3],
        "agent_hints": [str(h)[:240] for h in hints[:5] if str(h).strip()],
        "coaching_directives": {
            "regime_bias": str(directives.get("regime_bias") or "neutral")[:32],
            "entry_posture": str(directives.get("entry_posture") or "balanced")[:32],
            "exit_posture": str(directives.get("exit_posture") or "balanced")[:32],
            "priority_themes": [
                str(t)[:120]
                for t in (directives.get("priority_themes") or [])
                if t
            ][:4],
            "avoid": [str(a)[:120] for a in (directives.get("avoid") or []) if a][:4],
            "trusted_symbols": [
                str(s).upper().strip()[:8]
                for s in (directives.get("trusted_symbols") or [])
                if str(s).strip()
            ][:8],
        },
        "research_queries": [
            str(q)[:160] for q in (data.get("research_queries") or []) if q
        ][:4],
        "source_count": len(data.get("sources") or []),
        "grok_used": bool(data.get("grok_used")),
    }


def coaching_payload_for_graph(memory: dict[str, Any] | None) -> dict[str, Any]:
    """Slice attached to every strategist / debate Grok payload."""
    if not memory or not isinstance(memory, dict):
        return {}
    if not memory.get("summary") and not memory.get("agent_hints") and not memory.get("lessons"):
        return {}
    return {
        "learning_coach": {
            "summary": memory.get("summary"),
            "lessons": memory.get("lessons") or [],
            "agent_hints": memory.get("agent_hints") or [],
            "coaching_directives": memory.get("coaching_directives") or {},
            "updated_at": memory.get("updated_at"),
        }
    }


def apply_regime_coaching_bias(
    label: str,
    detail: str,
    memory: dict[str, Any] | None,
) -> tuple[str, str]:
    """Nudge regime label using stored learning directives (deterministic safety layer)."""
    directives = (memory or {}).get("coaching_directives") or {}
    bias = str(directives.get("regime_bias") or "neutral").lower().strip()
    if bias == "prefer_cautious":
        if label == "risk_on":
            return "moderate", f"{detail} Coach: stay selective despite strong tape."
        if label == "moderate":
            return "cautious", f"{detail} Coach: prioritize capital preservation."
    if bias == "prefer_opportunistic" and label == "cautious":
        return "moderate", f"{detail} Coach: only top-ranked leaders if entering."
    return label, detail


def entry_score_adjustment(memory: dict[str, Any] | None) -> float:
    """Delta applied to candidate scores in deterministic entry path (+ stricter, - looser)."""
    posture = str(((memory or {}).get("coaching_directives") or {}).get("entry_posture") or "balanced").lower()
    if posture == "patient":
        return 8.0
    if posture == "aggressive_leader":
        return -5.0
    return 0.0


def trusted_symbol_score_boost(memory: dict[str, Any] | None, symbol: str) -> float:
    """Boost scout rank score for symbols flagged by trusted X monitors."""
    trusted = ((memory or {}).get("coaching_directives") or {}).get("trusted_symbols") or []
    sym = str(symbol or "").upper().strip()
    if sym and sym in {str(s).upper() for s in trusted}:
        return 15.0
    return 0.0
    """Add to exit urgency when coach says protect capital."""
    posture = str(((memory or {}).get("coaching_directives") or {}).get("exit_posture") or "balanced").lower()
    if posture == "protect_capital":
        return 0.08
    if posture == "let_winners_run":
        return -0.05
    return 0.0
