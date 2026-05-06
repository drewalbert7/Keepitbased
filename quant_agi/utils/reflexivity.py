"""
Soros-style reflexivity proxy: measures divergence between fundamentals narrative
(price trend vs “story”) vs crowd positioning (swarm polarization).

Fully heuristic — suitable for tagging only, not causal proof.
"""

from __future__ import annotations

import math
from typing import Iterable


def reflexivity_score(
    narrative_sentiment: float,
    swarm_mean_belief: float,
    polarization: float,
    *,
    price_vs_baseline_pct: float,
) -> float:
    """
    Higher when price move and crowd conviction diverge sharply (boom/bust choreography).

    - narrative_sentiment: -1 bearish … +1 bullish (from NLP seed or heuristic)
    - swarm_mean_belief: avg agent belief rebound prob 0–1 mapped to [-1,1]
    - polarization: std of agent beliefs, 0–0.5 typical
    - price_vs_baseline_pct: deterministic dip depth from baseline (negative = dip)

    Returns 0–1 score.
    """
    belief_centered = (swarm_mean_belief - 0.5) * 2.0  # roughly -1 … 1
    narrative_story = narrative_sentiment
    ns = narrative_story if math.isfinite(narrative_story) else 0.0
    bc = belief_centered if math.isfinite(belief_centered) else 0.0
    pol = polarization if math.isfinite(polarization) else 0.0
    tape = price_vs_baseline_pct if math.isfinite(price_vs_baseline_pct) else 0.0
    # Reflexivity: amplified when story and positioning fight the tape magnitude
    tape_stress = min(1.0, abs(tape) / 25.0)
    divergence = abs(ns - bc)
    polarization_boost = min(1.0, pol * 4.0)

    raw = 0.45 * divergence + 0.35 * tape_stress + 0.25 * polarization_boost
    raw = raw / max(1e-9, math.sqrt(1.0 + 0.05 * abs(ns * bc)))
    return float(max(0.0, min(1.0, raw)))
