"""Proposer — heuristic experiments plus optional Grok / OpenAI / Anthropic JSON (+ Grok code artifacts)."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

import numpy as np

from autoresearch.grok_client import effective_grok_api_key, grok_json_object
from config import settings
from utils.logger import get_logger

_LOG = get_logger(__name__)

TOTAL_LLM_MICRO_USD: float = 0.0

_ARTIFACT_NAME = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\.(py|md)$")
_MAX_ARTIFACT_FILES = 4
_MAX_ARTIFACT_CHARS = 16_384


def _charge_openai(prompt_tok: int, completion_tok: int) -> None:
    global TOTAL_LLM_MICRO_USD
    TOTAL_LLM_MICRO_USD += prompt_tok * 8e-6 + completion_tok * 2e-5


def _charge_anthropic(in_tok: int, out_tok: int) -> None:
    global TOTAL_LLM_MICRO_USD
    TOTAL_LLM_MICRO_USD += in_tok * 1.2e-5 + out_tok * 2.8e-5


def _charge_grok_heuristic() -> None:
    """Informal cost dial — Grok pricing varies by model tier."""
    global TOTAL_LLM_MICRO_USD
    TOTAL_LLM_MICRO_USD += 0.022


def _openai(prompt: str, *, system: str) -> Optional[str]:
    try:
        import openai

        if not settings.openai_api_key:
            return None
        cli = openai.OpenAI(api_key=settings.openai_api_key)
        rsp = cli.chat.completions.create(
            model=settings.openai_model,
            max_tokens=min(settings.llm_call_max_tokens, 3_096),
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
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


def _anthropic(prompt: str, *, system: str) -> Optional[str]:
    try:
        import anthropic

        if not settings.anthropic_api_key:
            return None
        cli = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        merged = system.strip() + "\n\n" + prompt.strip()
        rsp = cli.messages.create(
            model=settings.anthropic_model,
            max_tokens=min(settings.llm_call_max_tokens, 3_096),
            messages=[{"role": "user", "content": merged}],
        )
        u = rsp.usage or None
        if u:
            _charge_anthropic(int(u.input_tokens or 0), int(u.output_tokens or 0))

        blk = rsp.content[0]
        return str(getattr(blk, "text", blk))

    except Exception as ex:  # noqa: BLE001
        _LOG.warning("Anthropic unavailable: %s", ex)
        return None


def _text(x: Any) -> str:
    return str(x or "").strip()


def _sanitize_generated_modules(blob_list: Any) -> Dict[str, str]:
    """Strip path segments; enforce count + extension; cap size."""
    out: Dict[str, str] = {}
    if not isinstance(blob_list, list):
        return out
    for item in blob_list[:_MAX_ARTIFACT_FILES]:
        if not isinstance(item, dict):
            continue
        name = _text(item.get("filename") or item.get("name"))
        raw = item.get("source") if "source" in item else item.get("content")
        if not name or raw is None:
            continue
        src = str(raw)
        if not name or not _ARTIFACT_NAME.match(name):
            _LOG.warning("Rejected artifact filename %s", name)
            continue
        if len(src) > _MAX_ARTIFACT_CHARS:
            src = src[:_MAX_ARTIFACT_CHARS] + "\n# [... truncated by quant_agi ...]\n"
        out[name] = src
    return out


@dataclass
class Proposal:
    swarm_agents: int
    debate_rounds: int
    herding_pressure: float
    summary: str
    rationale: str
    edits: Dict[str, Any] = field(default_factory=dict)
    """Raw JSON minus heavy code bodies (stored for SQLite/debug)."""

    code_artifacts: Dict[str, str] = field(default_factory=dict)
    """Grok/agent-generated modules written under autoresearch git `grok_artifacts/` (not executed)."""


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
    )


_PROMPT_BODY = """Quant AGI autoresearch — propose the next swarm benchmark settings.

Hard requirements (JSON object only — no markdown fences):
- swarm_agents: integer in [512 .. {max_agents}]
- debate_rounds: integer in [4 .. 48]
- herding_pressure: float in [0, 1] (conceptual sociology gain for debrief text; simulation may evolve)
- rationale: single concise sentence stating the experiment hypothesis.

Optional reasoning:
- reasoning_trace: short bullet-style rationale chain (logged only).

Optional code-generation (sandbox git only — never executed automatically by Quant AGI):
- generated_modules: array (max {_max_files}), each element:
  {{ "filename": "<name>.py or <name>.md", "source": "<utf-8 body; max {_max_chars} chars each>" }}

Use generated_modules for concrete Python sketches, refactors you would try on `simulate_chunk`, emergence math,
config constants, evaluator hooks, or notes for a human reviewer. Avoid secrets, hosts, tokens, shell, or subprocess.

Baseline today: swarm_default={swarm}, debate_rounds={rnd}.

Iteration seed hint: {seed}
"""

_SYSTEM_JSON = (
    "You are Quant AGI autoresearch. Reply with VALID JSON ONLY (one object). "
    "You may sketch code modules for reviewer merge — they are persisted to an isolated sandbox repository only."
)


def _compact_edits(blob: Dict[str, Any]) -> Dict[str, Any]:
    """Shrink metrics payload — drop verbatim sources already stored under grok_artifacts/."""
    out = dict(blob)
    out.pop("generated_modules", None)
    out.pop("code_artifacts", None)
    return out


def _proposal_from_parsed(blob: Dict[str, Any], iteration_seed: int, *, tag: str) -> Proposal:
    arts = _sanitize_generated_modules(blob.get("generated_modules"))
    swarm = max(128, min(settings.swarm_max_agents, int(blob["swarm_agents"])))
    rnd = max(4, min(48, int(blob["debate_rounds"])))
    herd = float(min(1.0, max(0.0, float(blob["herding_pressure"]))))
    rationale_parts = [str(blob.get("rationale", "llm")).strip()]
    if blob.get("reasoning_trace"):
        rationale_parts.append(str(blob["reasoning_trace"]).strip()[:2000])

    return Proposal(
        swarm_agents=swarm,
        debate_rounds=rnd,
        herding_pressure=herd,
        summary=f"{tag}-{iteration_seed}",
        rationale=" | ".join(rationale_parts).strip()[:8000],
        edits=_compact_edits(blob),
        code_artifacts=arts,
    )


def _blob_from_legacy_text(raw: str) -> Optional[Dict[str, Any]]:
    try:
        trimmed = raw[raw.index("{") : raw.rindex("}") + 1]
        blob = json.loads(trimmed)
    except Exception:
        return None
    return blob if isinstance(blob, dict) else None


def propose_with_optional_llm(iteration_seed: int) -> Proposal:
    user = _PROMPT_BODY.format(
        max_agents=settings.swarm_max_agents,
        swarm=settings.swarm_default_agents,
        rnd=settings.swarm_debate_rounds,
        seed=iteration_seed,
        _max_files=_MAX_ARTIFACT_FILES,
        _max_chars=_MAX_ARTIFACT_CHARS,
    )

    blob: Optional[Dict[str, Any]] = None

    if settings.llm_provider == "grok":
        key = effective_grok_api_key(settings.grok_api_key)
        if not key:
            _LOG.warning("Grok selected but GROK_API_KEY / XAI_API_KEY missing — deterministic fallback")
            return deterministic_proposal(iteration_seed)
        blob = grok_json_object(
            api_key=key,
            base_url=settings.grok_base_url,
            model=settings.grok_model,
            system=_SYSTEM_JSON,
            user=user,
            timeout_sec=float(settings.grok_request_timeout_sec),
        )
        if blob:
            _charge_grok_heuristic()

    elif settings.llm_provider == "openai":
        raw = _openai(user, system=_SYSTEM_JSON)
        if raw:
            blob = _blob_from_legacy_text(raw)
        if blob is None and raw:
            try:
                blob = json.loads(raw)
            except json.JSONDecodeError:
                blob = None

    elif settings.llm_provider == "anthropic":
        raw = _anthropic(user, system=_SYSTEM_JSON)
        if raw:
            blob = _blob_from_legacy_text(raw)

    if not blob:
        return deterministic_proposal(iteration_seed)

    try:
        return _proposal_from_parsed(blob, iteration_seed, tag=str(settings.llm_provider))
    except Exception:
        _LOG.warning("LLM JSON missing required numeric fields — fallback")
        return deterministic_proposal(iteration_seed)
