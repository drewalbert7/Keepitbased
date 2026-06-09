# Grok Paper Trading Bot — build plan

**Date:** 2026-06-09  
**Status:** Phase 0 in progress — dashboard bot shell + plan refinements in `todo.md`  
**Canonical roadmap:** [`../../todo.md`](../../todo.md) § [Grok paper trading bot](../../todo.md#grok-paper-trading-bot) (Great + Amazing tier checklists)  
**Prerequisite review:** [`REVIEW_FOR_NEXT_SESSION.md`](./REVIEW_FOR_NEXT_SESSION.md)

---

## 1) Product summary

Build a **Grok-powered paper trading bot** that:

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
| **Autoresearch** | Nightly loop, Grok JSON proposals, `grok_artifacts/` in sandbox git, SQLite `ExperimentRow`, `/diag/terminal-feed` | Evaluates **synthetic** swarm benchmarks — **not** paper bot P&amp;L on Massive closes |
| **Terminal UI** | Next.js ops cockpit: timeline, diff, Jarvis, metrics (no stock suggestions) | Deep ops only; suggestions on dashboard |
| **Main dashboard** | Watchlist, **Deploy list** (DL-1/2), **`QuantAgiSuggestionsPanel`**, Grok assistant | **`PaperTradingBotPanel`** shell ✅; ledger Phase 1 🔲 |
| **Deploy list** | Grok-optimized capital-ready symbols | No execution; natural feeder for bot universe later |
| **Dip engine** | Deterministic tiers (`on_sale` / `overreaction` / `capitulation`) | Bot should **read** tiers, not replace them |

**Bottom line:** You have strong **research infrastructure** and **ranking**. You do **not** yet have a **paper brokerage simulator**, **per-user bot policy store**, or **autoresearch feedback from real paper trades**.

---

## 3) Dashboard layout (required UX reorder)

Target stack on **`/dashboard`** (`AIAgentPage.tsx`) — top to bottom:

```text
┌─────────────────────────────────────────────┐
│ 1. Watchlist (+ opportunity policy panel)   │
├─────────────────────────────────────────────┤
│ 2. Deploy list (capital-ready symbols)      │
├─────────────────────────────────────────────┤
│ 3. Quant AGI stock suggestions (`QuantAgiSuggestionsPanel`) │  ✅ dashboard
├─────────────────────────────────────────────┤
│ 4. Grok Paper Trading Bot (`PaperTradingBotPanel`)      │  🟡 shell live
│    ├─ Paper account ($10k) + positions      │
│    ├─ User trading notes / rules inbox      │
│    ├─ Bot-suggested rules (approve/dismiss)  │
│    ├─ Trade blotter + daily P&amp;L chart        │
│    └─ Karpathy autoresearch strip           │
│       (daily review, patch diff, promote)    │
├─────────────────────────────────────────────┤
│ 5. Assistant (Grok chat + Watchlist analyst)│
└─────────────────────────────────────────────┘
```

**`/quant-agi` terminal** becomes a **deep ops view** (full timeline, diff panel, Jarvis coding chat, scorecard) — link from bot section “Open full terminal”. Dashboard embeds **compact** versions of suggestions + bot + autoresearch summary.

### Implementation notes (layout)

| Task | Approach |
|------|----------|
| Move Quant suggestions | ✅ **`QuantAgiSuggestionsPanel`** on dashboard — `/api/quant-agi/market-universe-rank` |
| Bot section | ✅ **`PaperTradingBotPanel`** shell — `GET /api/paper-bot/state`; Phase 1 ledger next |
| Styling | Match `kib-card` / dashboard tokens — do not iframe the black Next terminal into the middle of the dashboard. |
| Deploy ↔ bot | Deploy list symbols = **preferred universe** for paper bot when user enables “trade deploy list only”. |

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

- **Input:** Daily paper bot metrics (Sharpe proxy, win rate, max drawdown, slippage model), git SHA of active `bot_policy` bundle, last 7d trade blotter summary.
- **Grok job:** Extend existing `autoresearch/researcher.py` prompt with **paper bot section** — propose:
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

> **Full UI + Great/Amazing tier checklists:** [`../../todo.md`](../../todo.md#grok-paper-trading-bot)

### Phase 1 — Paper ledger + manual trades (2–3 weeks)

- [ ] DB tables + migrations.
- [ ] `paper_simulator.py` in Quant AGI; Node proxies `POST /api/paper-bot/simulate-day`.
- [ ] Manual “Paper buy $X of SYMBOL” for testing (admin/dev).
- [ ] Daily snapshot cron; simple P&amp;L line chart on dashboard.
- [ ] User **notes inbox** (text → stored; no Grok yet).

**Exit criteria:** User sees equity move from simulated fills; audit trail per trade.

### Phase 2 — Grok rules loop (2–3 weeks)

- [ ] `grok_bot_advisor.py` — user note → proposed rules.
- [ ] Bot daily **suggested rules** job (Grok).
- [ ] Approve/dismiss UI; active rules drive policy engine (deterministic execution).
- [ ] Wire rankers + dip tiers into policy engine.

**Exit criteria:** User adds “only trade overreaction tier”; bot respects it on next sim day.

### Phase 3 — Autoresearch on paper P&amp;L (3–4 weeks)

- [ ] Extend `run_autoresearch_night` with `paper_bot_metrics` input.
- [ ] Walk-forward eval on traded symbols (Massive).
- [ ] Dashboard **Karpathy strip**: last night summary, Sharpe delta, diff preview, link to full terminal.
- [ ] Promote flow: approve patch → copies to sandbox branch (still no auto-merge to prod).

**Exit criteria:** Nightly run references real paper performance; at least one promoted parameter change logged.

### Phase 4 — MiroFish visualization + semi-auto (future)

- [ ] SSE/WebSocket feed for swarm + bot events.
- [ ] Optional force-graph panel (or scoped widget in bot section).
- [ ] Shadow mode: log hypothetical live orders without sending.
- [ ] Broker paper API (**DL-4**) behind kill switch + `DeployPlanV1` approval.

---

## 8) API sketch

### Node (`backend/routes/paperBot.js`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/paper-bot/state` | Account, positions, active rules, today P&amp;L |
| GET | `/api/paper-bot/trades` | Paginated blotter |
| POST | `/api/paper-bot/notes` | User trading suggestion (free text) |
| POST | `/api/paper-bot/rules/:id/approve` | Activate proposed rule |
| POST | `/api/paper-bot/rules/:id/dismiss` | Reject proposal |
| POST | `/api/paper-bot/kill-switch` | Arm/disarm |
| GET | `/api/paper-bot/autoresearch/latest` | Last nightly summary for dashboard strip |

### Quant AGI (`keepitbased_integration/api_client.py`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/bot/interpret-note` | Grok → rule proposals |
| POST | `/bot/suggest-rules` | Grok daily proactive rules |
| POST | `/bot/run-day` | Execute policy + simulator for user |
| GET | `/diag/paper-bot/scorecard` | Metrics for autoresearch |

---

## 9) UI components (dashboard)

| Component | Contents |
|-----------|----------|
| **`QuantAgiSuggestionsPanel`** | Strategy tabs, top N cards, add-to-watchlist (port from `MarketTape`) |
| **`PaperTradingBotPanel`** | Header: equity, cash, day P&amp;L, mode badge, kill switch |
| **`BotRulesInbox`** | User notes textarea; pending bot proposals with approve/dismiss |
| **`BotPositionsTable`** | Symbol, qty, cost, mkt value, unrealized P&amp;L |
| **`BotTradeBlotter`** | Recent fills with reason tags (tier, rule, rank) |
| **`AutoresearchDailyStrip`** | Last run: improved Y/N, Sharpe Δ, one-line Grok rationale, “View diff” |
| **`PaperTradingBotPanel` footer** | Link to `/quant-agi` full terminal |

**Karpathy section** lives **inside** `PaperTradingBotPanel` (bottom third), not a separate page — user asked for autoresearch analysis **as part of** the bot block.

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
