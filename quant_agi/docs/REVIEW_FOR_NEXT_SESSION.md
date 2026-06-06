# Quant AGI — system review (saved for next session)

**Date:** 2026-05-24  
**Context:** Architecture and product review of `keepitbased/quant_agi/` (sidecar, terminal, integration with main app).  
**Resume:** Read this file first, then `../../todo.md` § Quant AGI / `buildAgentWatchlistContext` checklist.

---

## Overall take

Quant AGI is a **well-scoped research sidecar** for KeepItBased: swarm-style belief simulation, optional Grok autoresearch in a **sandbox**, rules-based universe ranking, and a Next.js “operations cockpit.” It is **not** general AGI and does not auto-trade production — and the repo is unusually clear about that. For a personal quant/research stack, the architecture is coherent; the main gap is **closing the loop** from rankers → main LangGraph dashboard and from “theater UI” → live swarm visualization.

---

## What works well

### 1. Safety and boundaries

- Autoresearch only commits under `models/autoresearch_git/`
- `EXPERIMENT_MAX_RUNTIME_SEC`, flock on nightly cron, 429 → synthetic OHLC fallback
- Enrichment is **additive** (`SignalEnhancer` does not replace deterministic alerts)
- Disclaimers and “educational only” on rank strategies

### 2. Production integration is real

- Node `priceMonitor` → `QUANT_AGI_ENHANCE_URL` → `/webhook/swarm-enhance` → `ai_assessment.quant_agi`
- PM2 (`quant-agi-api`, `quant-agi-frontend`), nginx (`/quant-agi-terminal/`, `/quant-sidecar/`), embed tab in main CRA app
- Massive/Polygon daily bars with explicit `history_source` tagging

### 3. Deterministic rankers are substantive

`quant_strategies.py`: three presets (`momentum_liquidity`, `photonics_chokepoint`, `rule_breaker_gardner`) with liquidity gates, fundamentals bridge, SEC keyword scan, Gardner-style leg breakdown in terminal tape. Usable **screening layer** independent of the swarm.

### 4. Swarm + autoresearch are engineered

- Chunked `SwarmManager` (thread/process pools)
- Debate / panic / euphoria round modes
- Emergence layer with CIs and reflexivity scoring
- Synthetic audit harness + SQLite + git diff via `/diag/terminal-feed`

### 5. Frontend MVP matches Phase 0 intent

Terminal (timeline, diff panel, metrics, market tape, Jarvis coding chat) aligns with `agent_agi/todo.md` Phase 0: **telemetry + agent theater**, not full MiroFish force-graph yet.

---

## Where to be skeptical (honest)

### 1. “AGI” is marketing; eval loop is synthetic

Autoresearch benchmarks **hyperparameters** on a **synthetic price series** (`autoresearch/evaluator.py`). Grok artifacts are for humans, not auto-promoted. Nightly “improvement” = **internal consistency on a toy harness**, not validated alpha on real Massive history. Treat SQLite sharpe deltas as **tuning signals**, not edge claims.

### 2. Swarm outputs are heuristics

Coarse inputs (RSI approx, sentiment placeholders, macro stress). Webhook enrichment is **reflexivity seasoning** on dip alerts — useful for UX, not a calibrated forecast without backtest on your actual alert population.

### 3. Flagship UI vision is ahead of backend

`agent_agi/todo.md` still describes full Marketing101 terminal (force graph, order book, Monte Carlo). Shipped UI is **ops cockpit**. Either build `MiroFishGraph` or narrow marketing copy.

### 4. Biggest product gap: rankers ≠ dashboard brain

**`buildAgentWatchlistContext` does not ingest `/diag/market-universe-rank`** (confirmed in main `todo.md`). Quant terminal and LangGraph opportunity scout are **parallel brains**.

### 5. Photonics universe is partly curated

Static universe + keyword NLP on issuer text — fine for v1; document as **thesis screen**, not discovery.

---

## Architecture (ASCII)

```
[ KeepItBased main ]
  priceMonitor ──webhook──► Quant FastAPI :8844
  LangGraph / opportunity_scout
  buildAgentWatchlistContext  - - - (not wired) - - -► market-universe-rank

[ Quant terminal :3010 ]
  polls /diag/terminal-feed, /diag/market-universe-rank

[ autoresearch nightly ]
  SQLite experiments + sandbox git (no merge to main)
```

---

## Priorities (ranked)

| Priority | Why |
|----------|-----|
| **Wire rank → `buildAgentWatchlistContext`** | Single source of truth for dashboard chat, digest, scout |
| **Backtest rank + swarm on real alert history** | Supplement synthetic audit with Massive closes on alerted symbols |
| **SSE/WebSocket for terminal-feed + swarm snapshot** | Live graph needs push, not only poll |
| **Phase 1 paper P&L simulator** (roadmap) | Economically interpretable metrics before live sleeve |
| **Force-graph or drop the promise** | Implement graph or rebrand as autoresearch cockpit |

---

## Bottom line

**Strong** as internal research platform: module boundaries, ops hooks, safety on self-modifying code, real screening presets. **Weak** as closed autonomous quant AGI loop — mostly by design today.

Next leap: **unification with LangGraph** and **honest evaluation on real data** before scaling agent counts, Grok nights, or live capital.

---

## Deep-dive slices (optional next session)

- Autoresearch promotion logic (`autoresearch/loop.py`, `researcher.py`)
- One rank strategy (`quant_strategies.py`)
- LangGraph scout + `agentWatchlistContext.js` integration path

## Key paths

| Piece | Path |
|-------|------|
| README / ops | `quant_agi/README.md` |
| FastAPI | `quant_agi/keepitbased_integration/api_client.py` |
| Rank strategies | `quant_agi/keepitbased_integration/quant_strategies.py` |
| Swarm | `quant_agi/swarm/` |
| Autoresearch | `quant_agi/autoresearch/` |
| Terminal UI | `quant_agi/frontend/` |
| Agent AGI roadmap | `quant_agi/agent_agi/todo.md` |
| Main product todo | `keepitbased/todo.md` |
