# Quant AGI Bot — build plan

> **Filename note:** `GROK_PAPER_TRADING_BOT_PLAN.md` is the legacy path; product name is **Quant AGI Bot**.

**Date:** 2026-06-09  
**Status:** Phase 3 ✅ complete · **Phase 4 split** (4a → 4b) — see § Phase 4 below  
**Canonical roadmap:** [`../../todo.md`](../../todo.md) § [Quant AGI Bot](../../todo.md#quant-agi-bot) (Great + Amazing tier checklists)  
**Prerequisite review:** [`REVIEW_FOR_NEXT_SESSION.md`](./REVIEW_FOR_NEXT_SESSION.md)

---

## 1) Product summary

Build the **Quant AGI Bot** — a Grok-assisted **simulated** trading agent that:

1. Starts with **$10,000 simulated capital** (per user) before any live broker sleeve.
2. Accepts **user-written trading guidance** (“trade more photonics chokepoint names”, “max 5% per position”, “only buy on overreaction tier”).
3. **Proposes rules back to the user** — strategy presets, sizing caps, entry/exit heuristics tied to existing Quant rankers and dip tiers.
4. Runs a **daily closed loop**: paper P&amp;L → Grok + **Karpathy autoresearch** review → suggested **code/strategy patches** (sandbox git only until human approves).
5. Uses **MiroFish swarm** outputs as *belief/regime context* for decisions, not as unconstrained execution authority.

Educational tooling only — not investment advice. Kill switch and policy envelope before live money.

---

## 2) What exists today (honest inventory)

| Layer | Shipped | Gap for this bot |
|-------|---------|------------------|
| **Quant rankers** | 4 strategies, `/diag/market-universe-rank`, daily digest email | Not wired to a portfolio or order simulator |
| **MiroFish swarm** | `swarm/SwarmManager`, emergence, webhook enrich on dip alerts | No portfolio state in; no trade decisions out |
| **Autoresearch** | Nightly loop, Grok JSON proposals, `grok_artifacts/` in sandbox git, SQLite `ExperimentRow`, `/diag/terminal-feed` | Evaluates **synthetic** swarm benchmarks — **not** Quant AGI Bot simulated P&amp;L on Massive closes |
| **Terminal UI** | Next.js ops cockpit: timeline, diff, Jarvis, metrics (no stock suggestions) | Deep ops only; suggestions on dashboard |
| **Main dashboard** | Watchlist, **Deploy list** (DL-1/2), **`QuantAgiSuggestionsPanel`**, Grok assistant | **No bot UI** — deploy list feeds bot universe |
| **Quant AGI page** | **`PaperTradingBotPanel`** + autoresearch ops (Zone B + C) | Phase 1 ledger ✅; Phase 2 rules ✅; **2.5 brain** ✅ |
| **Deploy list** | Grok-optimized capital-ready symbols | No execution; natural feeder for bot universe later |
| **Dip engine** | Deterministic tiers (`on_sale` / `overreaction` / `capitulation`) | Bot should **read** tiers, not replace them |

**Bottom line:** You have strong **research infrastructure** and **ranking**. You do **not** yet have a **paper brokerage simulator**, **per-user bot policy store**, or **autoresearch feedback from real paper trades**.

---

## 3) Quant AGI page layout (canonical — bot lives here only)

**Do not add bot UI to `/dashboard`.** Dashboard keeps watchlist, deploy list, rank suggestions, and assistant only.

Target stack on **`/quant-agi`** (`quant_agi/frontend`) — top to bottom:

```text
┌─ Chrome ─────────────────────────────────────────────┐
│ MissionBanner · TerminalHeader (feed status + nav)   │
└──────────────────────────────────────────────────────┘
┌─ ZONE B: Quant AGI Bot ──────────────────────────────┐
│ PaperTradingBotPanel                                 │
│   BotHealthStrip · BotControls                       │
│   BotRulesInbox (Phase 2) ✅                         │
│   BotBrainPanel (Phase 2.5) — policy & dry-run ✅     │
│   BotPerformanceChart · BotPositionsTable            │
│   BotTradeBlotter (+ Explain this trade)             │
│   AutoresearchDailyStrip (Phase 3 summary)           │
└──────────────────────────────────────────────────────┘
┌─ ZONE C: Autoresearch & engineering ops ─────────────┐
│ EventTimeline │ JarvisCodingChat + CodeDiffPanel     │
└──────────────────────────────────────────────────────┘
```

**Dashboard (`/dashboard`)** — unchanged product surface:

```text
Watchlist → Deploy list → QuantAgiSuggestionsPanel → Assistant
```

Bot **reads** deploy list / watchlist via API; user **edits** those lists on dashboard only.

### Implementation notes (layout)

| Task | Approach |
|------|----------|
| Rank suggestions | ✅ **`QuantAgiSuggestionsPanel`** on dashboard — `/api/quant-agi/market-universe-rank` |
| Bot section | ✅ **`PaperTradingBotPanel`** on **`/quant-agi` only** — `/api/paper-bot/*` |
| Autoresearch ops | ✅ Zone C on same page — timeline, diff, Jarvis, scorecard |
| Deploy ↔ bot | Deploy list symbols = preferred universe when “trade deploy list only” |

---

## 4) System architecture

```text
┌──────────────── Main app (Node :3001) ─────────────────┐
│  paper_trading_* tables (per user)                       │
│  POST /api/paper-bot/rules (user suggestions)             │
│  GET  /api/paper-bot/state                              │
│  POST /api/paper-bot/rules/:id/approve                    │
│  cron: paper_bot_daily_close + autoresearch_trigger       │
└────────────┬───────────────────────────────┬────────────┘
             │                               │
             ▼                               ▼
┌──────────────────────── Quant AGI (:8844) ─────────────────────────┐
│  paper_simulator.py — fills, marks, P&amp;L (Massive daily/intraday)   │
│  bot_policy_engine.py — merge user rules + quant strategies        │
│  grok_bot_advisor.py — user↔bot rule suggestions                   │
│  autoresearch/paper_loop.py — daily perf → Grok → patch proposal │
│  swarm snapshot — regime context for advisor only                  │
└────────────────────────────────────────────────────────────────────┘
```

**Authority split (non-negotiable):**

| Decision | Who decides |
|----------|-------------|
| Enter/exit timing vs dip tiers | Deterministic engine + **approved** bot rules |
| Position size % | Policy envelope + user caps |
| Which symbols | Deploy list / watchlist / ranker universe (configurable) |
| Strategy weights (Gardner vs chokepoint) | User-approved rules only |
| Code changes to bot | Autoresearch → sandbox git → **human promote** (PR or admin button) |
| Live broker orders | **Phase 4+** only; paper must pass gates first |

---

## 5) Grok responsibilities (three distinct loops)

### A) Interactive — user ↔ bot (real-time)

- **Input:** User natural-language suggestions stored as `bot_user_notes` (append-only).
- **Grok job:** Parse into structured **candidate rules** (`BotRuleProposal`): e.g. `max_position_pct: 8`, `prefer_strategy: photonics_chokepoint`, `entry_min_tier: overreaction`.
- **Output to user:** Markdown explanation + “Add rule” / “Dismiss” cards.
- **Implementation:** `grok_bot_advisor.py` + Node route `POST /api/paper-bot/interpret-note` (Grok via Quant sidecar or stock-service).

### B) Proactive — bot → user (daily or on schedule)

- **Input:** Paper P&amp;L, open positions, ranker leaders, dip signals on watchlist/deploy list, swarm regime summary.
- **Grok job:** Suggest **2–4 rules** the user might want (“You held through three gap-downs; consider tightening stop rule”, “Chokepoint names outperformed — raise strategy weight cap”).
- **Output:** Same `BotRuleProposal` queue; nothing auto-applies.

### C) Autoresearch — performance → code (Karpathy nightly)

- **Input:** Daily Quant AGI Bot metrics (Sharpe proxy, win rate, max drawdown, slippage model), git SHA of active `bot_policy` bundle, last 7d trade blotter summary.
- **Grok job:** Extend existing `autoresearch/researcher.py` prompt with **Quant AGI Bot section** — propose:
  - parameter tweaks (swarm scale, evaluator weights),
  - **`generated_modules`** patches for `paper_simulator.py`, `bot_policy_engine.py`, ranker weights.
- **Eval:** Run candidate on **walk-forward Massive closes** for symbols the bot actually traded (supplement synthetic audit).
- **Promote:** Unchanged safety — sandbox git only; UI shows diff in dashboard autoresearch strip + full terminal.

---

## 6) Paper account — $10,000 starting capital

### Ledger model (Postgres via Node `database.js`)

```sql
-- illustrative; finalize in migration
paper_bot_accounts (
  user_id PK,
  starting_cash_usd NUMERIC DEFAULT 10000,
  cash_usd NUMERIC,
  mode TEXT DEFAULT 'paper',  -- paper | shadow | live (live gated)
  kill_switch BOOLEAN DEFAULT true,
  created_at, updated_at
)

paper_bot_positions (
  id, user_id, symbol, qty, avg_cost, opened_at, ...
)

paper_bot_trades (
  id, user_id, symbol, side, qty, price, notional,
  reason_json,  -- tier, rule_id, rank_score snapshot
  pnl_realized, traded_at
)

paper_bot_rules (
  id, user_id, source,  -- user | bot_suggested | autoresearch
  status,  -- proposed | active | dismissed
  rule_type, payload_json, grok_rationale, approved_at
)

paper_bot_daily_snapshots (
  user_id, as_of_date, equity, cash, day_pnl, cum_pnl, metrics_json
)
```

### Simulator rules (v1)

- **US equities only** (align with deploy list v1).
- **Market orders** at Massive **daily close** or **last quote** from existing price monitor (document latency).
- **Fractional shares** optional v2; v1 whole shares OK for MVP.
- **Fees:** flat bps slippage + commission placeholder.
- **No shorting** v1.
- **Reset account** button (admin or user) → back to $10k, archive trades.

### Bot decision loop (intraday / daily cron)

1. Load **active rules** + deploy list / watchlist universe.
2. Pull rank snapshots (same 4 strategies as `MarketTape`).
3. Pull opportunity tiers for symbols in universe.
4. Swarm **snapshot** (bounded agents) → `regime_label`, `reflexivity_score`.
5. **Policy engine** outputs `TradeIntent[]` (symbol, side, target_weight).
6. Simulator executes if within cash + caps + kill switch off.
7. Persist blotter + emit SSE event for UI.

---

## 7) Phased delivery

### Phase 0 — Layout + read-only (1–2 weeks)

- [x] Reorder dashboard per §3.
- [x] `QuantAgiSuggestionsPanel` on dashboard (rank fetch + strategy tabs + add-to-watchlist).
- [x] `PaperTradingBotPanel` shell: $10k display, health strip, kill switch, deploy-list-only toggle, chart/blotter placeholders.
- [x] API: `GET /api/paper-bot/state`, `POST /api/paper-bot/kill-switch`, `PATCH /api/paper-bot/settings`; tables `paper_bot_accounts`, `paper_bot_events`.

**Exit criteria:** Dashboard order matches spec; suggestions work without visiting `/quant-agi`. ✅ Bot shell visible on `/dashboard`.

> **Full UI + Great/Amazing tier checklists:** [`../../todo.md`](../../todo.md#quant-agi-bot)

### Phase 1 — Paper ledger + manual trades (2–3 weeks)

- [ ] DB tables + migrations.
- [ ] `paper_simulator.py` in Quant AGI; Node proxies `POST /api/paper-bot/simulate-day`.
- [ ] Manual “Paper buy $X of SYMBOL” for testing (admin/dev).
- [ ] Daily snapshot cron; simple P&amp;L line chart on dashboard.
- [ ] User **notes inbox** (text → stored; no Grok yet).

**Exit criteria:** User sees equity move from simulated fills; audit trail per trade.

### Phase 2 — Grok rules loop (2–3 weeks)

- [x] `grok_bot_advisor.py` — user note → proposed rules.
- [ ] Bot daily **suggested rules** job (Grok).
- [x] Approve/dismiss UI; active rules drive policy engine (deterministic execution).
- [ ] Wire rankers + dip tiers into policy engine.

**Exit criteria:** User adds “only trade overreaction tier”; bot respects it on next sim day.

### Phase 2.5 — Bot brain (transparency) (1–2 weeks)

**Goal:** Users can **read** what guides paper trades — deterministic policy + inputs — before and after simulate-day.

- [x] **`BotBrainPanel.tsx`** — Zone B panel below rules inbox.
- [x] **`GET /api/paper-bot/policy-snapshot`** — merged active policy, universe gates, input signal summary.
- [x] **`POST /api/paper-bot/dry-run`** — `TradeIntent[]` without persisting fills (Quant sidecar).
- [x] **`paper_bot_events`** tail in panel — skips (cap, tier, kill switch, universe).
- [x] **Explain this trade** — blotter row expands `reason_json`.

**`BotBrainPanel` sections (v1):**

| Section | Contents |
|---------|----------|
| **Policy snapshot** | Merged caps from `bot_policy_engine`, active rule ids, `policy_version`, precedence line |
| **Universe & gates** | Deploy-list-only, symbol count, kill switch, cash headroom |
| **Input signals** | Top rank candidates (4 strategies), dip tier counts, swarm `regime_label` when available |
| **Dry-run intents** | Per-symbol buy/skip/hold, target weight, rules fired, skip reason |
| **Decision log** | Recent `paper_bot_events` (last N skips/blocks) |

**Authority copy (non-negotiable in UI):** Grok proposes rules and journal text; **`bot_policy_engine` + approved rules** decide intents; simulator executes fills. Brain shows engine output, not raw LLM trade calls.

**Exit criteria:** User opens brain → sees approved rule in snapshot → dry-run respects cap → simulate-day → blotter explain matches dry-run intent for that symbol.

### Phase 3 — Autoresearch on paper P&amp;L (3–4 weeks)

- [x] Extend `run_autoresearch_night` with optional `PAPER_BOT_METRICS_PATH` → Grok prompt context.
- [x] `GET /api/paper-bot/autoresearch/latest` + `POST /diag/paper-bot/scorecard` + promotion gates.
- [x] **Karpathy strip**: paper P&amp;L, latest experiment, gate checklist, link to Zone C ops.
- [x] Walk-forward eval on traded symbols (Massive) — `POST /diag/paper-bot/walk-forward`.
- [x] Promote flow: approve patch → `promoted/staging` sandbox branch (no auto-merge to prod).
- [x] Rich nightly context — worst day, win rate, symbols, reason tags in strip + Grok prompt.
- [x] 24h cooldown after account reset — `POST /api/paper-bot/reset` + gate enforcement.

**Exit criteria:** Nightly run references real paper performance; at least one promoted parameter change logged.

### Phase 4 — split plan (2026-06-09 review)

Phase 3 closed the core loop (paper ledger → brain → autoresearch → human promote). Phase 4 was **split** so polish, bridge, and broker plumbing ship in the right order — not as one monolith.

**Principle:** Make the bot **trustworthy at the boundary to real execution** before adding visualization theater or broker credentials.

#### Phase 4a — Shadow + live feel (next sprint)

**Goal:** “What would the broker see?” without sending orders or changing the ledger.

| Item | Deliverable | Priority |
|------|-------------|----------|
| **Shadow mode** | `mode: shadow` on account; log hypothetical orders to `paper_bot_events` + shadow blotter UI; no external API | **P0** |
| **Socket/SSE bot events** | Push `fill`, `rule_applied`, `kill_switch`, `autoresearch_promoted` via existing Socket.IO pattern (optional `paperBotUpdate`) | P1 |
| **Proactive Grok rules (loop B)** | Daily 2–4 bot-suggested rules into `BotRulesInbox` from P&amp;L + rank context | P1 |
| **Namespace isolation** | Paper/shadow fills must not trigger opportunity emails or deploy-list side effects | **✅ Step 1** — `paperBotNamespace.js` + smoke audit |
| **Nightly cron** | `paper_bot_daily_close` + export metrics JSON for `PAPER_BOT_METRICS_PATH` | P1 |
| **Amazing-tier (pick 1–2)** | Daily bot journal strip in brain · chart day-replay · “Paper-test this deploy list” on dashboard | P2 |

**Exit criteria (4a):** User runs simulate-day in shadow mode → shadow blotter shows intended broker orders; events appear in brain log without polling; no opportunity email from paper fill.

**Explicitly defer in 4a:** MiroFish force-graph (full panel), broker API, live money.

#### Phase 4b — Execution envelope (after DL-3)

**Goal:** Broker **paper** account only — still no live money — with the same human-approve muscle memory as rules inbox.

**Hard prerequisite:** **DL-3** `DeployPlanV1` (approve/dismiss deploy plan, audit in `agent_runs`) **before** DL-4.

| Item | Deliverable | Priority |
|------|-------------|----------|
| **DL-3** | `DeployPlanV1` schema + approve/dismiss UI + audit trail | **P0** |
| **Shadow vs broker parity** | Reconcile shadow log to broker paper confirmations | P0 |
| **DL-4 broker paper** | Alpaca (or similar) paper API behind kill switch + approved deploy plan | P1 |
| **Dual scorecards** | “Did approved rules help?” vs “Did code patch help in backtest?” | P2 |

**Exit criteria (4b):** User approves deploy plan → disarms kill switch → shadow and broker paper fills match policy; zero live-money path.

#### Phase 4 — defer / optional (v1.5+)

- [ ] **MiroFish force-graph** — defer full panel; at most a small **regime badge** in `BotBrainPanel` (swarm is context only, not execution authority).
- [ ] **Live broker / real money** — separate explicit sign-off; not part of Phase 4b.
- [ ] **Dashboard** force-graph — remains deferred per Great tier explicit defer list.

#### Phase 4 — original checklist (mapped)

| Original item | Split |
|---------------|-------|
| SSE/WebSocket swarm + bot events | **4a** (bot events P1; swarm feed optional) |
| Optional force-graph panel | **Defer** (v1.5+) |
| Shadow mode | **4a P0** |
| Broker paper API (**DL-4**) | **4b** (after **DL-3**) |

---

## 8) API sketch

### Node (`backend/routes/paperBot.js`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/paper-bot/state` | Account, positions, active rules, today P&amp;L |
| GET | `/api/paper-bot/policy-snapshot` | Merged policy + universe gates + input signal summary (**brain**) |
| POST | `/api/paper-bot/dry-run` | `TradeIntent[]` preview — no fills (**brain**) |
| GET | `/api/paper-bot/events` | Paginated `paper_bot_events` for decision log (**brain**) |
| GET | `/api/paper-bot/trades` | Paginated blotter |
| POST | `/api/paper-bot/notes` | User trading suggestion (free text) |
| POST | `/api/paper-bot/rules/:id/approve` | Activate proposed rule |
| POST | `/api/paper-bot/rules/:id/dismiss` | Reject proposal |
| POST | `/api/paper-bot/kill-switch` | Arm/disarm |
| GET | `/api/paper-bot/autoresearch/latest` | Last nightly summary for dashboard strip |
| POST | `/api/paper-bot/autoresearch/promote` | Human promote patch (gates + cooldown) |
| POST | `/api/paper-bot/reset` | Reset paper ledger to $10k |

### Quant AGI (`keepitbased_integration/api_client.py`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/bot/interpret-note` | Grok → rule proposals |
| POST | `/bot/dry-run` | Policy engine → `TradeIntent[]` (no simulator persist) |
| POST | `/bot/suggest-rules` | Grok daily proactive rules |
| POST | `/bot/run-day` | Execute policy + simulator for user |
| POST | `/diag/paper-bot/scorecard` | Metrics + promotion gates for autoresearch |
| POST | `/diag/paper-bot/walk-forward` | Massive holdout Sharpe on traded symbols |
| POST | `/diag/autoresearch/promote` | Copy experiment commit → `promoted/staging` |

---

## 9) UI components (Quant AGI Zone B — `/quant-agi` only)

| Component | Contents |
|-----------|----------|
| **`PaperTradingBotPanel`** | Zone B shell: health, controls, chart, footer |
| **`BotRulesInbox`** | User notes textarea; pending bot proposals with approve/dismiss |
| **`BotBrainPanel`** | **Policy snapshot**, universe gates, rank/tier/swarm inputs, **dry-run intents**, decision log; daily Grok journal strip (Amazing tier) |
| **`BotPositionsTable`** | Symbol, qty, cost, mkt value, unrealized P&amp;L |
| **`BotTradeBlotter`** | Recent fills; expandable **Explain this trade** (`reason_json`, tier, rank, policy version) |
| **`AutoresearchDailyStrip`** | Last run: improved Y/N, Sharpe Δ, one-line Grok rationale, “View diff” |

**Dashboard (`/dashboard`)** — no bot UI; unchanged:

| Component | Contents |
|-----------|----------|
| **`QuantAgiSuggestionsPanel`** | Strategy tabs, top N cards, add-to-watchlist |

**Karpathy section** lives **inside** `PaperTradingBotPanel` via **`AutoresearchDailyStrip`** (bottom of Zone B), not a separate page.

**Brain vs rules inbox:** `BotRulesInbox` is where users **approve** strategy; `BotBrainPanel` is where they **read** the merged policy and preview intents before simulate-day.

---

## 10) Integration map (reuse, don’t rewrite)

| Existing module | Reuse in bot |
|-----------------|--------------|
| `quant_strategies.py` / rank API | Universe scoring + bot rationale |
| `priceMonitor` / opportunity tiers | Entry gates |
| `deployListService` | Preferred symbols |
| `SwarmManager` | Regime context (bounded run) |
| `autoresearch/loop.py` | Extend eval input with paper metrics |
| `autoresearch/git_manager.py` | Patch storage |
| `/diag/terminal-feed` | Full terminal still serves deep diff/timeline |
| `JarvisCodingChat` | Keep on full terminal; dashboard gets read-only summary |

---

## 11) Safety & compliance

- Disclaimers on every bot panel (educational simulation).
- **Kill switch default: armed** (no trades until user explicitly enables).
- Grok never receives live broker credentials.
- LLM-generated code **never** executed in prod without CI + human promote.
- Log: `model_id`, `prompt_hash`, `policy_version`, `rule_ids`, `history_source` per trade.
- Paper results **not** marketed as validated alpha.

---

## 12) Open decisions (pick before Phase 2)

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | One paper account per user or multiple strategies? | **One** paper account per user v1 |
| 2 | Bot runs when? | **Daily close** cron + optional manual “Run now” |
| 3 | Universe default | **Deploy list** if non-empty, else **watchlist** US stocks |
| 4 | Grok calls from Node or Quant? | **Quant sidecar** (already has Grok keys + autoresearch) |
| 5 | User rule conflicts | Deterministic precedence: kill switch > user caps > active rules > defaults |

---

## 13) Success metrics (90-day)

| Metric | Target |
|--------|--------|
| Dashboard layout | 100% users see Deploy → Suggestions → Bot order |
| Paper account | Every user can reset to $10k and see blotter |
| Rule loop | ≥1 user-approved rule affects sim trades |
| Autoresearch | Nightly job cites paper P&amp;L in SQLite `metrics_dump` |
| Live money | **Zero** until Phase 4 explicit sign-off |

---

## 14) First implementation sprint (recommended)

1. **Dashboard layout PR** — move `QuantAgiSuggestionsPanel` under `DeployListPanel`; add empty `PaperTradingBotPanel`.
2. **Migration** — `paper_bot_accounts` with $10k default on first visit.
3. **Quant `paper_simulator.py` MVP** — single buy/sell at last price, Node proxy.
4. **Kill switch + disclaimers** wired before any automated `run-day`.

Start here when ready to code; do not enable automated trading until Phase 2 rules engine is tested.
