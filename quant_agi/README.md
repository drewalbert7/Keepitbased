# Quant AGI

Self-contained **research + swarm simulation** sidecar for KeepItBased. It adds **probability-style forecasts and reflexivity tags** on top of your existing deterministic alerts **without changing the production UI** (enrichment is opt-in via CLI, HTTP, or future Node bridge).

> **Disclaimer:** Educational / research software. Not investment advice. Swarm outputs are **heuristic simulations**, not exchange-traded forecasts.

## Architecture

- `swarm/` — personality agents, parallel debate rounds, emergence layer, knowledge graph seed.
- `autoresearch/` — nightly benchmark loop, optional LLM proposals, sandbox `git` commits, SQLite experiment log.
- `keepitbased_integration/` — synthetic price cache, `SignalEnhancer`, FastAPI webhook stub.
- `models/` — SQLite DB + optional Parquet cache (auto-created).

## Quick start

```bash
cd quant_agi
python3.11 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install --upgrade pip
pip install torch --index-url https://download.pytorch.org/whl/cpu  # or CUDA wheel for GPU
pip install -r requirements.txt
```

Copy env (optional):

```bash
cp .env.example .env   # Quant-only overrides; Grok keys often already live in ../python-service/.env
```

Quant AGI merges dotenv files (when present): repo `../.env`, `../backend/.env`, `../python-service/.env`, then `quant_agi/.env` (last wins). It uses **`GROK_API_KEY`**, **`XAI_API_KEY`**, **`GROK_BASE_URL`**, and **`LLM_MODEL`** the same way as `python-service/langgraph_agent/llm_client.py`.

Use **`QUANT_AGI_LLM_PROVIDER`** (`grok`|`none`|…) if you already set **`LLM_PROVIDER`** for LangGraph alone and want a different Quant autoresearch mode; otherwise **`LLM_PROVIDER`** is read too.

| Variable | Meaning |
|----------|---------|
| `KEEPITBASED_ROOT` | Path to main KeepItBased repo (default: parent of `quant_agi/`) |
| `QUANT_AGI_LLM_PROVIDER` | Overrides `LLM_PROVIDER` when set — avoids clashes with LangGraph on the Python service |
| `LLM_PROVIDER` | Fallback: `none` (default after merge), **`grok`**, `openai`, `anthropic` |
| `GROK_API_KEY` or `XAI_API_KEY` | Same as Python service — usually already in `python-service/.env` |
| `GROK_BASE_URL` / `GROK_MODEL` | Optional; **`LLM_MODEL`** from the Python service is used if `grok_model` / `GROK_MODEL` unset |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Alternative LLM proposers |
| `EXPERIMENT_MAX_RUNTIME_SEC` | Wall-clock fuse per `run-loop` invocation (default 3600) |
| `SWARM_DEFAULT_AGENTS` | Default particle count (CSV via pydantic `Settings` naming) — see `config.py` |

Pydantic reads `SWARM_DEFAULT_AGENTS` as `swarm_default_agents`, etc. (see `config.py`).

## CLI

```bash
# Single enrichment JSON (stdout)
python main.py enhance-alerts --symbol AAPL --baseline 205

# One swarm diagnostic pass
python main.py swarm-once --symbol NVDA --agents 4096

# Autoresearch loop (synthetic audit; SIGINT to stop)
python main.py run-loop --nights 4
python main.py run-loop --nights -1   # very long run until signal or time fuse

# HTTP sidecar (webhook stub)
python main.py serve --host 0.0.0.0 --port 8844

# Recent experiment rows
python main.py experiments-tail --limit 20
```

### HTTP

- `GET /health`
- `POST /webhook/swarm-enhance` body `{"symbol":"AAPL","baseline_price":205,"alertId":"..."}`
- `POST /v1/analyze` alias
- `GET /diag/keepitbased-health?base=http://127.0.0.1:3001`
- `GET /diag/experiments?limit=5` read-only tail of autoresearch rows (CORS for local dashboard when `QUANT_AGI_CORS_ORIGINS` is set)

## Docker

```bash
docker build -t quant-agi:latest .
docker run --rm -p 8844:8844 -e OPENAI_API_KEY=... quant-agi:latest
```

For **NVIDIA** hosts, change the base image to CUDA, install the matching `torch` wheel, and set `torch_device=cuda` via env override in `config.py` (extend as needed).

## Hooking into KeepItBased

1. **CLI / cron** — run `enhance-alerts` or `serve` beside `keepitbased-api`.
2. **Main backend (optional)** — set `QUANT_AGI_ENHANCE_URL=http://127.0.0.1:8844` in the Node API `.env`. When the price monitor emits an opportunity signal, it POSTs the symbol and user baseline price to `/webhook/swarm-enhance`, merges the JSON into websocket payloads under `quantAgi`, and stores the same blob under `opportunity_signals.ai_assessment.quant_agi` via a merge update (preserve other keys such as dip insight output).
3. **In-app tab** — set `REACT_APP_QUANT_AGI_URL` so the Quant AGI page can poll `/diag/experiments`; otherwise the table shows setup instructions only.

## Monitoring improvement history

- Git: `models/autoresearch_git/` sandbox repository (`git log`).
- SQLite: `models/quant_agi.sqlite3` table `experiments` (use `python main.py experiments-tail`).
- When `LLM_PROVIDER=grok` (or JSON models return `generated_modules`), each commit may include `grok_artifacts/<branch>/` with `.py`/`.md` sketches for human review — they are **not** auto-imported or executed.

## Grok autoresearch

Set `LLM_PROVIDER=grok` and `GROK_API_KEY` (or `XAI_API_KEY`). The loop still benchmarks only **hyperparameters** (`SwarmManager` agents/rounds) on the synthetic harness; Grok-produced code is persisted as artifacts for iterative human merge, aligned with sandbox safety.

## Safety rails

- Hard **runtime ceiling** (`EXPERIMENT_MAX_RUNTIME_SEC`).
- **LLM budget** tracking (informal micro-dollar estimate in `researcher.TOTAL_LLM_MICRO_USD`).
- Autoresearch commits only inside the **sandbox git** path — never touches KeepItBased `main` history.
- Roll back experiments by checking out an earlier commit inside the sandbox repo.

## Example swarm output

See `python main.py swarm-once`. Fields include `rebound_probability_mean`, `ci_recovery_low_pct`, etc.

## Note on TA-Lib

This starter uses **pure NumPy** helpers in `utils/metrics.py`. Optional `TA-Lib` C library can be layered later for parity with classic technical studies.
