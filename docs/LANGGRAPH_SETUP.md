# LangGraph Setup (KeepItBased)

This project now includes a Phase-0 LangGraph workflow for stock buy-alert generation.

## What was added

- `python-service/langgraph_agent/state.py` - typed graph state
- `python-service/langgraph_agent/nodes.py` - data, feature, signal, guardrail, output nodes
- `python-service/langgraph_agent/graph.py` - compiled LangGraph workflow
- `python-service/run_buy_alert_graph.py` - CLI runner
- `python-service/stock_service.py` - new API route:
  - `GET /agent/buy-alert/<symbol>?period=6mo&interval=1d&maxAlertsPerDay=5`

## Install

From `python-service/`:

```bash
source venv/bin/activate
pip install -r requirements.txt
```

`requirements.txt` now includes:

- `langgraph>=0.2.0`

## Run with CLI

```bash
cd python-service
source venv/bin/activate
python run_buy_alert_graph.py --symbol AAPL --period 6mo --interval 1d
```

## Run via API

```bash
curl "http://127.0.0.1:5001/agent/buy-alert/AAPL?period=6mo&interval=1d&maxAlertsPerDay=5"
```

## Notes

- This is **Phase 0**: rules-based signal scoring with guardrails and structured JSON output.
- It is a scaffold for multi-agent expansion (research/planner/execution separation).
- Output includes a disclaimer and should be treated as decision support, not investment advice.
