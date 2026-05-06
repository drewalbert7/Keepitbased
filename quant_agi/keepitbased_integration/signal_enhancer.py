"""Enrich deterministic KeepItBased-style alerts — adds swarm-derived fields ONLY."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

from swarm.knowledge_graph import build_seed_graph, reflexive_backfire_score
from swarm.swarm_manager import SwarmManager
from swarm.emergence import EmergentForecast
from utils import reflexivity as soros
from keepitbased_integration.data_fetcher import KeepItBasedDataFetcher, TickerAsset, TickerPulse


@dataclass
class EnhancedAlertSignal:
    base_alert_id: str
    symbol: str
    deterministic_message: str
    swarm_forecast: EmergentForecast
    swarm_confidence_summary: float
    reflexivity_tag: str
    reflexivity_score: float
    knowledge_graph_bonus: Dict[str, Any] = field(default_factory=dict)
    history_source: str = "unknown"


def _infer_asset_type(payload: Dict[str, Any]) -> TickerAsset:
    raw = payload.get("assetType") or payload.get("asset_type") or ""
    return "crypto" if str(raw).strip().lower() == "crypto" else "stock"


class SignalEnhancer:
    """Non-invasive wrapper — callers merge fields into existing payloads client-side."""

    def __init__(self, swarm_agents: int | None = None) -> None:
        self.fetcher = KeepItBasedDataFetcher()
        self.swarm = SwarmManager(n_agents=swarm_agents)

    def enhance_flat_dict(self, *, alert_payload: Dict[str, Any]) -> EnhancedAlertSignal:
        """Accept a minimal dict: symbol, baseline_price OR baselinePrice, alertId/message optional."""
        symbol = str(alert_payload.get("symbol") or alert_payload.get("ticker")).upper()

        bp = alert_payload.get("baseline_price") or alert_payload.get("baselinePrice")
        ast = _infer_asset_type(alert_payload)

        pulse: TickerPulse = self.fetcher.build_pulse_from_alert(
            symbol=symbol, baseline_price=float(bp), asset_type=ast
        )

        G = build_seed_graph(
            ticker=pulse.symbol,
            sector=pulse.sector,
            macro_tags=pulse.narrative_tags,
        )
        kg_bonus = reflexive_backfire_score(G)

        forecast = self.swarm.run_sync(
            rsi=pulse.rsi_approx,
            headline_sentiment=pulse.headline_sentiment,
            onchain_pulse=pulse.on_chain_pulse,
            macro_stress=pulse.macro_stress,
            baseline_gap_pct=pulse.baseline_pct_gap,
            use_executor="threads",
        )

        reflex = soros.reflexivity_score(
            narrative_sentiment=pulse.headline_sentiment,
            swarm_mean_belief=forecast.rebound_probability_mean,
            polarization=forecast.polarization_std,
            price_vs_baseline_pct=pulse.baseline_pct_gap,
        )

        tag = classify_reflexivity(reflex)

        swarm_conf_summary = clamp01(
            kg_bonus * 0.35 + (1 - forecast.polarization_std * 3.8) * 0.44 + reflex * 0.21 + forecast.influence_weighted_probability * 0.08
        )

        base_msg = alert_payload.get("message") or alert_payload.get("deterministic_summary") or "baseline dip signal"
        ea = EnhancedAlertSignal(
            base_alert_id=str(alert_payload.get("alertId") or alert_payload.get("id") or f"{symbol}-shadow"),
            symbol=symbol,
            deterministic_message=base_msg,
            swarm_forecast=forecast,
            swarm_confidence_summary=swarm_conf_summary,
            reflexivity_tag=tag,
            reflexivity_score=reflex,
            knowledge_graph_bonus={"feedback_loop_proxy": kg_bonus},
            history_source=pulse.history_source,
        )

        return ea


def classify_reflexivity(score: float) -> str:
    if score >= 0.82:
        return "REFLEX_FEEDBACK_CRITICAL"
    if score >= 0.55:
        return "REFLEX_ELEVATED"
    if score >= 0.30:
        return "REFLEX_MODERATED"
    return "REFLEX_MUTED"


def clamp01(x: float) -> float:
    return float(max(0.0, min(1.0, x)))
