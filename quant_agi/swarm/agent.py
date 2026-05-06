"""
Single swarm agent — personality traits + belief state updated through debate rounds.

Lightweight tensors optional; numeric belief in [0,1] rebound probability horizon.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
import random
from typing import List, Literal

import numpy as np


Persona = Literal["bullish", "bearish", "fearful", "contrarian", "neutral"]


class InfluenceMode(str, Enum):
    DEBATE = "debate"
    PANIC_SPREAD = "panic_spread"
    EUPHORIA_SHOCK = "euphoria_shock"


@dataclass
class Personality:
    """Static agent traits sampled at spawn."""

    persona: Persona
    bullish_bias: float  # additive to logistic input
    herding_coef: float  # 0 = independent … 1 = strong neighbor pull
    loss_aversion: float  # >1 reacts more when seeing drawdown narratives
    social_rank: float  # 0–1 influencer weight others copy


@dataclass
class SwarmAgent:
    id: int
    personality: Personality
    short_memory: np.ndarray = field(default_factory=lambda: np.zeros(8, dtype=np.float64))
    long_memory_anchor: float = 0.5
    belief: float = field(default=0.5)  # P(rebound in horizon)
    social_influence: float = field(default=0.2)

    @staticmethod
    def sample_personality(rng: random.Random | None = None) -> Personality:
        r = rng or random
        personas: List[Persona] = ["bullish", "bearish", "fearful", "contrarian", "neutral"]
        return r.choice(personas)

    @classmethod
    def spawn(cls, agent_id: int, rng: np.random.Generator) -> SwarmAgent:
        ptype = cls.sample_personality(random.Random(int(rng.integers(0, 2**31 - 1))))
        bullish_bias = float(rng.normal(0.0, 0.35))
        herding = float(rng.uniform(0.2, 0.62))
        loss_av = float(rng.uniform(0.95, 1.8))
        social = float(rng.uniform(0.1, 0.42))

        if ptype == "bullish":
            bullish_bias += 0.55
        elif ptype == "bearish":
            bullish_bias -= 0.55
        elif ptype == "fearful":
            bullish_bias -= 0.25
            herding = float(rng.uniform(0.45, 0.95))
            loss_av = float(rng.uniform(1.2, 2.8))
            social = float(rng.uniform(0.08, 0.35))
        elif ptype == "contrarian":
            bullish_bias *= -0.3
            herding = float(rng.uniform(0.05, 0.35))
            loss_av = float(rng.uniform(0.8, 1.4))
            social = float(rng.uniform(0.15, 0.45))

        social_rank = float(rng.beta(2.0, 5.0))  # most agents low influence

        pers = Personality(
            persona=ptype,
            bullish_bias=bullish_bias,
            herding_coef=herding,
            loss_aversion=loss_av,
            social_rank=social_rank,
        )
        belief = float(1 / (1 + np.exp(-(bullish_bias * 1.05))))
        return cls(
            id=agent_id,
            personality=pers,
            belief=float(np.clip(belief + rng.normal(0, 0.02), 0.02, 0.98)),
            social_influence=social_rank,
            long_memory_anchor=belief,
        )

    def observe_seed(
        self,
        *,
        rsi: float | None,
        headline_sentiment: float,
        onchain_pulse: float,
        macro_stress: float,
        baseline_gap_pct: float,
    ) -> None:
        """Ingest fundamental + tape seed vector into short-memory ring buffer."""
        v = np.clip(
            np.array(
                [
                    headline_sentiment,
                    onchain_pulse,
                    macro_stress,
                    baseline_gap_pct / 30.0,
                    float(rsi or 50) / 120.0,
                    self.personality.bullish_bias,
                    self.personality.herding_coef,
                    self.personality.loss_aversion,
                ],
                dtype=np.float64,
            ),
            -20.0,
            20.0,
        )
        self.short_memory = np.clip(0.74 * self.short_memory + 0.26 * v, -33.0, 33.0)

    def update_belief_from_neighbors(self, neighborhood_mean_belief: float, rng: np.random.Generator, mode: InfluenceMode | str) -> None:
        """Coupled logistic update."""

        lm = neighborhood_mean_belief
        h = float(self.personality.herding_coef)
        raw_base = np.mean(self.short_memory[:5])
        if not np.isfinite(raw_base):
            raw_base = 0.0
        base = float(raw_base) + self.personality.bullish_bias
        reflex = (lm - self.belief) * h * 1.8

        m = InfluenceMode(mode) if isinstance(mode, str) else mode

        if m == InfluenceMode.PANIC_SPREAD:
            reflex -= 0.12 * abs(base)
            base -= 0.25 * float(self.personality.loss_aversion) * np.sign(base)
        elif m == InfluenceMode.EUPHORIA_SHOCK:
            reflex += 0.06
            base += 0.05

        jitter = float(rng.normal(0.0, 0.035))
        z = float(3.8 * base + reflex + jitter)
        new_belief = float(1.0 / (1.0 + np.exp(-np.clip(z, -14, 14))))
        blended = (
            self.long_memory_anchor * 0.12
            + new_belief * 0.68
            + lm * float(self.personality.herding_coef) * 0.2
        )
        self.belief = float(np.clip(blended, 0.01, 0.99))
