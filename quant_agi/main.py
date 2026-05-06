"""
Quant AGI CLI — run inside ``quant_agi/``:

  python main.py --help

"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import uvicorn
from sqlalchemy import select
from sqlalchemy.orm import Session

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from autoresearch.loop import run_autoresearch_night  # noqa: E402
from config import settings  # noqa: E402
from db import ExperimentRow, engine, init_db  # noqa: E402
from keepitbased_integration.data_fetcher import KeepItBasedDataFetcher  # noqa: E402
from keepitbased_integration.signal_enhancer import EnhancedAlertSignal, SignalEnhancer  # noqa: E402
from swarm.emergence import EmergentForecast  # noqa: E402
from swarm.swarm_manager import SwarmManager  # noqa: E402
from utils.logger import get_logger  # noqa: E402

_LOG = get_logger("quant_agi.main")


def _serialize_enhanced(obj: EnhancedAlertSignal) -> dict:
    f = obj.swarm_forecast
    return {
        "symbol": obj.symbol,
        "swarm": {**f.to_dict(), "confidence_summary": obj.swarm_confidence_summary},
        "reflexivity_tag": obj.reflexivity_tag,
        "reflexivity_score": obj.reflexivity_score,
    }


def cmd_enhance(args: argparse.Namespace) -> None:
    enh = SignalEnhancer()
    out = enh.enhance_flat_dict(
        alert_payload={"symbol": args.symbol, "baseline_price": args.baseline, "alertId": "cli"}
    )
    print(json.dumps(_serialize_enhanced(out), indent=2))


def cmd_swarm_once(args: argparse.Namespace) -> None:
    fetch = KeepItBasedDataFetcher()
    pulse = fetch.build_pulse_from_alert(symbol=args.symbol, baseline_price=150.0)
    mgr = SwarmManager(n_agents=args.agents, rounds=settings.swarm_debate_rounds)
    ef: EmergentForecast = mgr.run_sync(
        rsi=pulse.rsi_approx,
        headline_sentiment=pulse.headline_sentiment,
        onchain_pulse=pulse.on_chain_pulse,
        macro_stress=pulse.macro_stress,
        baseline_gap_pct=pulse.baseline_pct_gap,
        use_executor="threads",
    )
    print(json.dumps(ef.to_dict(), indent=2))


def cmd_run_loop(args: argparse.Namespace) -> None:
    iters = 10**9 if args.nights < 0 else args.nights
    _LOG.info("Starting autoresearch | iterations=%s", iters)
    run_autoresearch_night(iterations=iters)


def cmd_serve(args: argparse.Namespace) -> None:
    from keepitbased_integration.api_client import create_app  # noqa: WPS433

    uvicorn.run(create_app(), host=args.host, port=args.port, log_level="info")


def cmd_experiments_tail(args: argparse.Namespace) -> None:
    init_db()
    stmt = select(ExperimentRow).order_by(ExperimentRow.created_at.desc()).limit(args.limit)
    with Session(engine) as s:
        rows = s.execute(stmt).scalars().all()
    for r in rows:
        print(
            f"{r.created_at.isoformat()} | {r.branch} | improved={r.improved} | "
            f"sha={r.commit_sha[:8]} | cand_sh={r.candidate_sharpe}"
        )


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="quant_agi")
    subs = ap.add_subparsers(dest="cmd", required=True)

    p_en = subs.add_parser("enhance-alerts", help="Print JSON swarm enrichment for one alert")
    p_en.add_argument("--symbol", default="AAPL")
    p_en.add_argument("--baseline", type=float, default=210.0)
    p_en.set_defaults(func=cmd_enhance)

    p_sw = subs.add_parser("swarm-once", help="Diagnostic swarm forecast")
    p_sw.add_argument("--symbol", default="AAPL")
    p_sw.add_argument("--agents", type=int, default=2048)
    p_sw.set_defaults(func=cmd_swarm_once)

    p_lp = subs.add_parser("run-loop", help="Autoresearch synthetic loop")
    p_lp.add_argument(
        "--nights",
        type=int,
        default=1,
        help="Iterations (-1 ≈ unlimited until SIGINT / time fuse)",
    )
    p_lp.set_defaults(func=cmd_run_loop)

    p_sv = subs.add_parser("serve", help="Webhook FastAPI on 8844")
    p_sv.add_argument("--host", default=settings.webhook_host)
    p_sv.add_argument("--port", type=int, default=settings.webhook_port)
    p_sv.set_defaults(func=cmd_serve)

    p_ex = subs.add_parser("experiments-tail", help="SQLite experiment log tail")
    p_ex.add_argument("--limit", type=int, default=12)
    p_ex.set_defaults(func=cmd_experiments_tail)

    return ap


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
