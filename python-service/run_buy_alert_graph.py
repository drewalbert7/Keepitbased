#!/usr/bin/env python3
import argparse
import json
from datetime import datetime, timezone

from langgraph_agent.graph import build_buy_alert_graph


def main():
    parser = argparse.ArgumentParser(description="Run KeepItBased buy-alert LangGraph.")
    parser.add_argument("--symbol", required=True, help="Stock symbol (e.g. AAPL)")
    parser.add_argument("--period", default="6mo", help="yfinance period (default: 6mo)")
    parser.add_argument("--interval", default="1d", help="yfinance interval (default: 1d)")
    parser.add_argument(
        "--max-alerts-per-day",
        type=int,
        default=5,
        help="Guardrail cap used by graph",
    )
    args = parser.parse_args()

    app = build_buy_alert_graph()
    result = app.invoke(
        {
            "symbol": args.symbol.upper(),
            "period": args.period,
            "interval": args.interval,
            "max_alerts_per_day": args.max_alerts_per_day,
            "as_of": datetime.now(timezone.utc).isoformat(),
        }
    )
    print(json.dumps(result.get("output", result), indent=2))


if __name__ == "__main__":
    main()
