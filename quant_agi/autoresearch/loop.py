"""Orchestrator for overnight autoresearch / bounded synthetic benchmarks."""

from __future__ import annotations

import signal
import time
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from autoresearch.evaluator import ExperimentScore, run_synthetic_audit, statistically_better
from autoresearch.git_manager import GitExperimentManager
import autoresearch.researcher as researcher_mod

from config import settings
from db import ExperimentRow, engine, init_db
from swarm.swarm_manager import SwarmManager

from utils.logger import get_logger

_LOG = get_logger(__name__)

_ROOT = Path(__file__).resolve().parent.parent


_ABORT = False


def _handle_sig(_, __) -> None:  # noqa: ANN001
    global _ABORT
    _ABORT = True
    _LOG.warning("SIGINT/SIGTERM — finish current iteration then exit")


def persist_experiment(
    *,
    branch: str,
    sha: str,
    baseline: ExperimentScore,
    candidate: ExperimentScore,
    improved: bool,
    reason: Optional[str],
    code_artifact_filenames: Optional[list[str]] = None,
) -> None:
    row = ExperimentRow(
        branch=branch,
        commit_sha=sha,
        baseline_sharpe=baseline.sharpe_alert_proxy,
        candidate_sharpe=candidate.sharpe_alert_proxy,
        baseline_winrate=baseline.win_hit_rate_proxy,
        candidate_winrate=candidate.win_hit_rate_proxy,
        improved=1 if improved else 0,
        rejection_reason=reason,
        metrics_dump={
            "baseline_aggregate": baseline.aggregate,
            "candidate_aggregate": candidate.aggregate,
            "llm_spend_micro_est": researcher_mod.TOTAL_LLM_MICRO_USD,
            "code_artifact_filenames": sorted(code_artifact_filenames or []),
        },
    )

    with Session(engine) as s:

        s.add(row)

        s.commit()


def run_autoresearch_night(*, iterations: Optional[int] = None) -> None:


    """

    Bounded improvement loop. ``iterations=None`` uses ``nightly_max_iterations``.

    Set ``iterations`` very large in ``main`` for “infinite until SIGINT”.

    """


    init_db()

    gm = GitExperimentManager()

    iters = iterations if iterations is not None else settings.nightly_max_iterations

    signal.signal(signal.SIGINT, _handle_sig)

    signal.signal(signal.SIGTERM, _handle_sig)

    deadline = time.time() + settings.experiment_max_runtime_sec

    def baseline_ctor() -> SwarmManager:
        return SwarmManager(
            n_agents=settings.swarm_default_agents,
            rounds=settings.swarm_debate_rounds,
        )

    champ = run_synthetic_audit(swarm_ctor=baseline_ctor)

    snapshot_paths = [_ROOT / "swarm" / "swarm_manager.py", _ROOT / "swarm" / "emergence.py", _ROOT / "config.py"]

    mirror = [p for p in snapshot_paths if p.is_file()]



    _LOG.info(



        "Baseline | sharpe_proxy=%.4f win_proxy=%.3f",

        champ.sharpe_alert_proxy,

        champ.win_hit_rate_proxy,

    )

    seed_base = int(time.time()) % 1_000_000

    for i in range(iters):

        if _ABORT or time.time() > deadline:

            _LOG.info("Stop: abort=%s deadline=%s", _ABORT, time.time() > deadline)




            break

        seed = seed_base + i * 997



        proposal = researcher_mod.propose_with_optional_llm(seed)

        branch = gm.create_branch(f"itr-{seed}")


        def cand_ctor(p=proposal) -> SwarmManager:

            return SwarmManager(n_agents=p.swarm_agents, rounds=p.debate_rounds)

        cand = run_synthetic_audit(swarm_ctor=cand_ctor)

        win = statistically_better(cand, champ, alpha=settings.statistical_significance_alpha)

        msg = (
            f"WIN candidate | {proposal.summary}\n{proposal.rationale[:400]}"
            if win
            else f"discard | {proposal.summary}"
        )


        sha = gm.commit_mirror_files(
            msg,
            mirror,
            grok_artifacts=proposal.code_artifacts if proposal.code_artifacts else None,
            grok_dir_slug=branch.replace("/", "_"),
        )

        persist_experiment(
            branch=branch,
            sha=sha,
            baseline=champ,
            candidate=cand,
            improved=win,
            reason=None if win else "insufficient_aggregate_uplift",
            code_artifact_filenames=sorted(proposal.code_artifacts.keys()),
        )




        _LOG.info(




            "[%s/%s] %s improved=%s aggΔ=%+.4f",






            i + 1,






            iters,




            branch,




            win,




            cand.aggregate - champ.aggregate,






        )


        if win:

            champ = cand
