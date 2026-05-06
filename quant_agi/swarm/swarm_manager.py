"""Parallel swarm execution — chunked async + executor for CPU parallelism."""

from __future__ import annotations

import asyncio
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from functools import partial
from typing import List, Literal, Sequence, Tuple

import numpy as np

from config import settings
from swarm.agent import InfluenceMode, SwarmAgent
from swarm.emergence import EmergentForecast, emerge_forecast_from_beliefs


def _round_mode_for_index(ridx: int) -> InfluenceMode | str:
    cycle = (
        InfluenceMode.DEBATE,
        InfluenceMode.DEBATE,
        InfluenceMode.PANIC_SPREAD,
        InfluenceMode.DEBATE,
        InfluenceMode.EUPHORIA_SHOCK,
    )
    return cycle[ridx % len(cycle)]


def simulate_chunk(
    *,
    seeds: Sequence[int],
    base_seed_vectors: Tuple[float, float, float, float, float],
    rng_seed: int,
    rounds: int,
) -> List[Tuple[float]]:
    """Return list of beliefs (for ProcessPool-safe pickling stub). Actually return full agents is heavy."""

    rsi, headline_sentiment, onchain_pulse, macro_stress, baseline_gap_pct = base_seed_vectors
    rng_np = np.random.default_rng(rng_seed)
    agents_local: List[SwarmAgent] = [
        SwarmAgent.spawn(agent_id=i, rng=np.random.default_rng(int(rng_np.integers(0, 2**31))))
        for i in range(len(seeds))
    ]
    offset = rng_np.standard_normal(len(agents_local)) * 1e-3
    for j, agent in enumerate(agents_local):
        agent.observe_seed(
            rsi=(rsi + offset[j] * 40.0),
            headline_sentiment=headline_sentiment,
            onchain_pulse=onchain_pulse,
            macro_stress=macro_stress,
            baseline_gap_pct=baseline_gap_pct,
        )
    for rnd in range(rounds):
        mode = _round_mode_for_index(rnd)
        beliefs = np.array([a.belief for a in agents_local], dtype=np.float64)
        k = max(7, len(agents_local) // 90)
        for i_agent, agent in enumerate(agents_local):
            lo = max(0, i_agent - k)
            hi = min(len(agents_local), i_agent + k + 1)
            neigh = float(np.mean(beliefs[lo:hi]))
            agent.update_belief_from_neighbors(neigh, rng=np.random.default_rng(int(rng_np.integers(0, 2**31))), mode=mode)
    out = [(float(a.belief), float(a.personality.social_rank)) for a in agents_local]
    return out


class SwarmManager:
    """Spawns swarm, runs chunked simulation."""

    def __init__(self, n_agents: int | None = None, rounds: int | None = None) -> None:
        self.n_agents = n_agents or settings.swarm_default_agents
        self.rounds = rounds or settings.swarm_debate_rounds
        self.batch_size = settings.swarm_batch_size

    def run_sync(
        self,
        *,
        rsi: float | None,
        headline_sentiment: float,
        onchain_pulse: float,
        macro_stress: float,
        baseline_gap_pct: float,
        use_executor: Literal["threads", "process", "none"] = "threads",
    ) -> EmergentForecast:
        # Single-process fast path — vectorized surrogate for huge swarms:

        rng = np.random.default_rng()
        vectors = (
            float(rsi or 50),
            headline_sentiment,
            onchain_pulse,
            macro_stress,
            baseline_gap_pct,
        )
        futures: List = []

        remainder = self.n_agents
        agg_beliefs: List[float] = []
        agg_weights: List[float] = []

        frozen = partial(simulate_chunk, base_seed_vectors=vectors, rounds=self.rounds)

        if use_executor != "none" and self.n_agents > self.batch_size * 4:
            Ex = ThreadPoolExecutor if use_executor == "threads" else ProcessPoolExecutor
            max_workers = min(12, max(2, remainder // max(self.batch_size * 128, 256)))
            with Ex(max_workers=max_workers) as ex:
                offs = 0
                while remainder > 0:
                    take = min(self.batch_size * 256, remainder)
                    futures.append(
                        ex.submit(
                            frozen,
                            seeds=list(range(offs, offs + take)),
                            rng_seed=int(rng.integers(0, 2**31)),
                        )
                    )
                    offs += take
                    remainder -= take
                for fu in futures:
                    part = fu.result()
                    for belief, rk in part:
                        agg_beliefs.append(belief)
                        agg_weights.append(max(1e-3, float(rk)))
        else:
            out = simulate_chunk(
                seeds=list(range(self.n_agents)),
                base_seed_vectors=vectors,
                rng_seed=int(rng.integers(0, 2**31)),
                rounds=self.rounds,
            )
            for belief, rk in out:
                agg_beliefs.append(belief)
                agg_weights.append(max(1e-3, float(rk)))

        b_arr = np.array(agg_beliefs[: self.n_agents], dtype=np.float64)
        w_arr = np.array(agg_weights[: self.n_agents], dtype=np.float64)
        ef = emerge_forecast_from_beliefs(b_arr, w_arr)

        return ef

    async def run_async(self, **kw) -> EmergentForecast:
        loop = asyncio.get_event_loop()

        # Run CPU-heavy path in executor
        kw.setdefault("use_executor", "threads")
        return await loop.run_in_executor(None, lambda: self.run_sync(**kw))
