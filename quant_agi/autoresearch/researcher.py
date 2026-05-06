"""Proposer — heuristic experiments plus optional Anthropic/OpenAI JSON payloads."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, Optional

import numpy as np

from config import settings
from utils.logger import get_logger

_LOG = get_logger(__name__)

TOTAL_LLM_MICRO_USD: float = 0.0


def _charge_openai(prompt_tok: int, completion_tok: int) -> None:
    global TOTAL_LLM_MICRO_USD
    TOTAL_LLM_MICRO_USD += prompt_tok * 8e-6 + completion_tok * 2e-5


def _charge_anthropic(in_tok: int, out_tok: int) -> None:
    global TOTAL_LLM_MICRO_USD
    TOTAL_LLM_MICRO_USD += in_tok * 1.2e-5 + out_tok * 2.8e-5


def _openai(prompt: str) -> Optional[str]:
    try:
        import openai

        if not settings.openai_api_key:
            return None
        cli = openai.OpenAI(api_key=settings.openai_api_key)
        rsp = cli.chat.completions.create(
            model=settings.openai_model,
            max_tokens=min(settings.llm_call_max_tokens, 1536),
            messages=[
                {"role": "system", "content": "Reply VALID JSON ONLY — keys swarm_agents, debate_rounds, herding_pressure, rationale."},
                {"role": "user", "content": prompt},
            ],
        )
        u = rsp.usage or None
        if u:
            _charge_openai(int(getattr(u, "prompt_tokens", 0) or 0), int(getattr(u, "completion_tokens", 0) or 0))
        txt = rsp.choices[0].message.content
        return (txt or "").strip()
    except Exception as ex:  # noqa: BLE001
        _LOG.warning("OpenAI unavailable: %s", ex)
        return None


def _anthropic(prompt: str) -> Optional[str]:
    try:
        import anthropic

        if not settings.anthropic_api_key:
            return None
        cli = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        rsp = cli.messages.create(
            model=settings.anthropic_model,
            max_tokens=min(settings.llm_call_max_tokens, 1536),
            messages=[{"role": "user", "content": prompt}],
        )
        u = rsp.usage or None
        if u:
            _charge_anthropic(int(u.input_tokens or 0), int(u.output_tokens or 0))

        blk = rsp.content[0]

        return str(getattr(blk, "text", blk))

    except Exception as ex:  # noqa: BLE001
        _LOG.warning("Anthropic unavailable: %s", ex)

        return None


@dataclass
class Proposal:
    swarm_agents: int

    debate_rounds: int
    herding_pressure: float
    summary: str
    rationale: str
    edits: Dict[str, Any]


def deterministic_proposal(seed: int) -> Proposal:
    rng = np.random.default_rng(seed)

    swarm = int(
        np.clip(
            settings.swarm_default_agents * rng.uniform(0.62, 1.15),
            256,
            settings.swarm_max_agents,
        )
    )

    rnd = max(6, settings.swarm_debate_rounds + int(rng.choice([-4, -2, 0, 2])))

    herd = float(np.clip(settings.swarm_debate_rounds / 40.5 * rng.uniform(0.9, 1.25), 0.05, 0.93))

    return Proposal(
        swarm_agents=swarm,
        debate_rounds=rnd,
        herding_pressure=herd,
        summary=f"autospec-{seed}",
        rationale="Gaussian sweep over cardinality + contagion pacing (offline)",
        edits={},

    )


_PROMPT = """Suggest ONE Quant AGI swarm hyperparameter tweak as JSON only.
Fields:
- swarm_agents (integer, 512 .. {max_agents})
- debate_rounds (integer, 4..48)
- herding_pressure (float, 0..1)
- rationale (single short sentence)

Baseline today: swarm_default={swarm}, debate_rounds={rnd}.
"""


def propose_with_optional_llm(iteration_seed: int) -> Proposal:
    tmpl = _PROMPT.format(
        max_agents=settings.swarm_max_agents,
        swarm=settings.swarm_default_agents,
        rnd=settings.swarm_debate_rounds,
    )

    raw = None

    if settings.llm_provider == "openai":

        raw = _openai(tmpl)


    elif settings.llm_provider == "anthropic":

        raw = _anthropic(tmpl)


    if not raw:


        return deterministic_proposal(iteration_seed)


    try:

        trimmed = raw[raw.index("{") : raw.rindex("}") + 1]


        blob = json.loads(trimmed)


    except Exception:


        _LOG.warning("LLM malformed JSON fallback")


        return deterministic_proposal(iteration_seed)


    try:

        swarm = max(128, min(settings.swarm_max_agents, int(blob["swarm_agents"])))

        rnd = max(4, min(48, int(blob["debate_rounds"])))

        herd = float(min(1.0, max(0.0, float(blob["herding_pressure"]))))

        return Proposal(
            swarm_agents=swarm,
            debate_rounds=rnd,
            herding_pressure=herd,
            summary=f"llm-{iteration_seed}",
            rationale=str(blob.get("rationale", "llm")).strip()[:4000],

            edits=blob,

        )

    except Exception:


        return deterministic_proposal(iteration_seed)
