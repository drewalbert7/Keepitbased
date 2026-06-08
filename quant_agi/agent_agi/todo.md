# Agent AGI — roadmap, UX reference & build prompts

> **Product roadmap:** [`../../todo.md`](../../todo.md) — canonical KeepItBased `todo.md` (Quant/LangGraph, deploy, §11, **agentic trading bot**). This file is **subproject UX/build prompts + bot loop detail**.
>
> **Saved review (2026-05-24):** [`../docs/REVIEW_FOR_NEXT_SESSION.md`](../docs/REVIEW_FOR_NEXT_SESSION.md) — architecture/product review to resume next session.
>
> **Resume here (2026-06-06):** Main app shipped **daily digest Quant AGI picks** + **Gardner Early** ranker (`410bd325`). **Next:** agentic trading bot Phases **0→1** below.

This folder holds **Agent AGI** planning artifacts: roadmap, UX inspiration, and reusable prompts for implementing the **MiroFish Terminal** frontend and **agentic trading loop** against `quant_agi/`.

## Progress (2026-06-06)

| Delivered | Notes |
|-----------|--------|
| **4 rank strategies** | `momentum_liquidity`, `photonics_chokepoint`, `rule_breaker_gardner`, **`rule_breaker_gardner_early`** |
| **Daily digest integration** | Node **`quantAgiDailySuggestions.js`** → main app daily email (3 picks × 3 strategies) |
| **Market-cap gates** | Photonics + Gardner Early **$25B** max |
| **Terminal preset** | Gardner Early on Quant tape / stream bootstrap |
| **Ops cockpit** | `/diag/terminal-feed`, rank endpoint, autoresearch nightly (unchanged) |

**Not done yet (bot track):** closed loop swarm → autoresearch → **paper P&L** → **policy-bounded allocator** → **live MiroFish graph** UI; WebSocket event projection; CI promotion gate for sandbox patches.

**Canonical next steps:** [`../docs/GROK_PAPER_TRADING_BOT_PLAN.md`](../docs/GROK_PAPER_TRADING_BOT_PLAN.md) — Grok **$10k paper bot**, dashboard layout (Deploy → Suggestions → Bot), Karpathy autoresearch on daily P&amp;L. Also: [`../../todo.md` § Quant AGI agentic trading bot build-out](../../todo.md#quant-agi-agentic-trading-bot-build-out).

## UX reference (Marketing101 — BTC Polymarket terminal inspiration)

- **Static screenshot (this repo):** [`ux_reference_marketing101_polymarket_terminal.png`](./ux_reference_marketing101_polymarket_terminal.png)  
  Layout: top nav (BTC/ETH, P&L, trade count, UTC clock, win rate), scrolling “live tape”, wallet/30D P&L left, center candle + order book + **MiroFish swarm graph** (nodes/edges with labels like REJECT, BREAKOUT, NEXT TRADE, profit pace), “#1 BTC trader” panel + fill curve, bottom P&L chart + recent trades table + analytics (Monte Carlo, sentiment, etc.), footer alt-coin strip.
- **Motion reference (video):** [Twitter/X amplify video (1080×1350)](https://video.twimg.com/amplify_video/2051003805672550400/vid/avc1/1080x1350/i9lZmbTE7GcJ2t8S.mp4)  
  Original post context: [antpalkin / X](https://x.com/antpalkin/status/2051004014607609885?s=20)

**Dark-cyber direction for implementation:** replicate **structure and density** from the reference; replace the cream “terminal paper” look with **pure black, neon accents, glass panels, scanline/glow** per the saved frontend prompt below.

---

## Strategic plan (capital + autoresearch + self-improve)

### North-star

A **continuous loop**: ingest market + portfolio state → **MiroFish-style swarm** (Quant AGI `swarm/`) → beliefs / regime-style outputs → **autoresearch** proposes parameters or **patch artifacts** (`grok_artifacts/`) → **synthetic / paper / gated live** evaluation → **capital allocator** adjusts exposure only through a **policy envelope** (caps, kill switch) → next day feedback. The UI should make that loop **watchable in real time** (logs, graph, diffs, experiment scores).

### Hard constraints

1. **Compliance & venue** — Capital deployment is via **your** integrations; not financial advice; disclaimers in product.
2. **Self-modifying code + money** — Do **not** auto-import LLM-generated Python into a live trading process without **CI, policy, and rollback**. Today `quant_agi` writes Grok modules to **sandbox git only**; widening that requires explicit promotion (PR → tests → deploy).
3. **Auditability** — Every run: model id, prompt hash, swarm seed, `history_source`, experiment row, git SHA, allocator decision id.

### Architecture (target)

```text
[ Massive / alerts / portfolio ] → [ Swarm + emergence ] → [ Evaluator / allocator policy ]
        ↓                                    ↑
[ Autoresearch (Grok proposals + artifacts) ]──┘
        ↓
[ Paper → (optional) small live sleeve ]     [ SSE/WebSocket + DB event log → MiroFish Terminal UI ]
```

Self-improvement path: **Workspace A** prod image (immutable) vs **Workspace B** patch branch → tests + `run-loop` metrics → **human or policy merge** (never silent overwrite of prod).

### Phased roadmap

| Phase | Focus | Outcome |
|-------|--------|---------|
| **0** | Telemetry + “agent theater” UI | Event schema, replay, diff viewer for `grok_artifacts/`, wire to `/diag/*` or SSE |
| **1** | Daily improve, no live risk | Nightly autoresearch → optional **PR** from sandbox; paper P&L simulator on Massive closes |
| **2** | Guided self-mod | Allowlisted edits (constants, evaluator weights, allocator caps); two-party rule (tests + reviewer) |
| **3** | Small live sleeves | Hard notional/drawdown ceilings; kill switch |
| **4** | Broader autonomy | Constitutional test harness; expand patch scope only after 2–3 are boring |

### Questions to decide

1. Paper vs named broker for v1?  
2. Universe: US equities only vs crypto (`X:*USD`)?  
3. May the agent **merge** without human approval, ever? (Recommended: **PR-only** until Phase 3+.)

### Mapping to existing `quant_agi`

| Piece | Today | Next (agentic trading bot) |
|-------|--------|------|
| Swarm | `SwarmManager`, `emergence`, KG | Feed portfolio / regime context; **WebSocket + event log** |
| Autoresearch | Grok JSON + sandbox commits | CI on patches; **paper P&L** leaderboard in UI |
| Market data | `massive_aggs.py`, `history_source` | Intraday feeds for graph motion; sim fills |
| Rankers | 4 strategies + digest email | Allocator universe + paper holdings |
| Enrichment API | FastAPI webhook + diags | **SSE/WebSocket** projection of swarm snapshots |
| Terminal UI | Ops cockpit (tape, diff, metrics) | **MiroFish force-graph** + wallet/P&L panels (saved prompt below) |

---

## Saved prompt — build MiroFish Terminal frontend (use as-is when ready)

Paste the block below into your AI coding assistant (or Grok/Code) when you want to scaffold **`quant_agi/frontend`** (Next.js 15 stack as specified).

```text
You are Grok, built by xAI — an elite full-stack engineer and visualization expert specializing in real-time AI trading terminals and swarm intelligence dashboards.

Build the complete **MiroFish Terminal frontend** for the keepitbased.com / Quant AGI project that matches **exactly** the style and layout in this video: https://video.twimg.com/amplify_video/2051003805672550400/vid/avc1/1080x1350/i9lZmbTE7GcJ2t8S.mp4

It is the sleek dark cyber "Marketing101 BTC Polymarket Terminal" with the animated central MiroFish force-graph swarm.

**Project goal**: Create a beautiful, production-ready frontend called MiroFish Terminal that visualizes the outputs of the Quant AGI swarm agents (MiroFish-style) in real time, while integrating with keepitbased.com buy-the-dip signals.

**Exact layout to replicate 1:1 from the video**:
- Top navbar: live BTC/ETH prices (large numbers), 24h change, P&L, trades count, timestamp (UTC).
- Left sidebar: Wallet/Performance panel (30-day P&L, trades won %, avg win, total trades, etc.).
- Center-top: Real-time BTC candlestick chart.
- **Center main hero area**: Large "MiroFish - BTC Graph" force-directed swarm visualization (exactly like the video).
  - Nodes colored by sentiment (purple = bullish, red = bearish, green = greed, blue = fear, yellow = catalyst, etc.).
  - Animated edges with labels: BULLISH, BEARISH, FEAR, GREED, MIDPOINT, CATALYST, COLLUSION, CLUSTER.
  - Directional particles flowing on links, pulsing/glowing nodes, real-time dynamic updates.
  - Legend, overlays ("X WIN STREAK", "PROFIT PACE $xxx/hr", "NEXT TRADE Xs", agent count, etc.).
- Right sidebar: "#1 BTC Trader" panel with entry/exit sizes, alpha score, small chart, catalyst tags + Order book.
- Bottom row: Recent trades table + Live Analytics panels (Monte Carlo, sentiment gauges, etc.).

**Tech stack** (Next.js 15 App Router):
- Next.js 15 + TypeScript + Tailwind CSS
- react-force-graph (2D) for the animated swarm graph with particles
- lightweight-charts for the price chart
- Zustand for real-time state management
- Ready for WebSocket connection to the Python Quant AGI backend (swarm_manager.py, emergence.py)

**Folder structure to generate** (create this as quant_agi/frontend/):

frontend/
├── app/
│   ├── globals.css
│   └── page.tsx                  # Main MiroFish Terminal
├── components/
│   ├── Header.tsx
│   ├── WalletPanel.tsx
│   ├── PriceChart.tsx
│   ├── MiroFishGraph.tsx         # Core animated swarm graph (match video exactly)
│   ├── TraderPanel.tsx
│   ├── OrderBook.tsx
│   └── LiveAnalytics.tsx
├── lib/
│   └── store.ts                  # Zustand store for live swarm data
├── package.json
├── tailwind.config.ts
└── README.md

**Additional requirements**:
- Dark cyber-terminal aesthetic: pure black background, neon purple/green/red accents, glassmorphism panels, subtle glow/scanline effects.
- All numbers animate smoothly on updates.
- Graph updates every 1-2 seconds simulating live agent interactions from Quant AGI.
- Include fake live data + clear comments on how to connect to the Python backend via WebSocket or REST.
- Full `package.json` with exact dependencies.
- Complete, runnable code with type hints and comments.
- Instructions at the top of README.md for `npm run dev` and backend integration.

Output format:
1. First, show the full file tree.
2. Then, output each file's full source in its own fenced code block; put the exact file path on the code fence's first line (path label convention your tool accepts).

Deliver the entire production-ready frontend codebase in one response. Make it visually indistinguishable from the video — smooth, polished, ready to drop into the Quant AGI project.

<!-- end preserved frontend-build prompt -->
```

---

## Maintainer note

Keep this file as the single **Agent AGI** planning entry point under `quant_agi/agent_agi/`. **Next session:** start **Phase 0** event schema + **MiroFishGraph** in `quant_agi/frontend/` (see saved prompt below). When components land, link their README here.
