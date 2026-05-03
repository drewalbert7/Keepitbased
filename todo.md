# KeepItBased Professional Implementation Plan

Last updated: 2026-05-03 — **OpenBB ODP wired app-wide** (equity quotes/history/technical, crypto OHLC/ticker via **`openbb-yfinance`**, **`dailyAtrService`**, **`PriceMonitor`**) behind **`OPENBB_ENABLED`**; **`openbb-platform`** on PM2 + **`backend/.env`** keys merged into **`ecosystem.openbb.config.js`**. **Direct Polygon/Massive routes remain** as fallback unless exclusivity envs set. **`openbb-service/requirements.txt`** includes **`openbb-polygon`** + **`openbb-yfinance`**. Earlier same day: Polygon **retry/stale-quote** resilience in **`charts.js`**; **`cryptoService`** normalized bar **`time`** (seconds); crypto page **defensive ticker** formatting; dashboard **crypto on Main watchlist** (poll + add/remove **`assetType`**). **AGPL reminder:** OpenBB is AGPL—review before broad commercial rollout. **Massive tier:** Still required for serious **equity** data when using **`polygon`** through OpenBB; OpenBB routes calls, it does **not** replace vendor quotas/entitlements. **Deploy:** `npm run deploy`; **`pm2 start ecosystem.openbb.config.js`** (+ **`pm2 save`**).

## Execution status snapshot

| Track | Status | Notes |
|-------|--------|--------|
| **Phase 0** — Charts / regression | **✅ Complete (MVP)** | Same + **optional OpenBB-first** paths for **`/charts/*`** & **`/crypto/*`** (`sourceUsed`: `openbb_equity`, `openbb_polygon_daily`, etc.). Optional polish in §2 “Remaining known issues”. |
| **Phase 1** — LangGraph / agent gateway | **✅ Complete (core)** | `POST /agent/opportunities`, `/agent/dip-insight`, Node `/api/agent/chat`; persistence `agent_runs`/`agent_messages`; Grok dip emails + SES + Profile prefs. |
| **§11 Phase A** — Contracts | **✅ Complete** | `DeepAlertOutput` scaffold, prefs merge, `researchAlertGates`, `SECTION_11_PHASE_A.md`. |
| **§11 “speed path”** | **✅ Shipped** | Deterministic dip → Grok + **x_search** (no X API) → email; optional artifact gate when `researchDigestEmail` is on. |
| **§11 Phase B** — Ingestion | **🟡 MVP shipped** | `research_artifacts` + Polygon `/v2/reference/news` + cron worker; all-watchlist tickers; dedupe `content_hash`. **Open:** dedicated queue worker, X + EDGAR (see §11). |
| **§11 Phase D** — Fusion gate | **🟡 MVP shipped** | `researchFusionGate` + `correlationRuleV1` on dip-insight path when **`researchDigestEmail`** true → else plain opportunity email. **Open:** digest dedupe keys, async queue, full `ResearchAlertEvaluator`. |
| **§11 Phase C** — Agent context | **🟡 MVP shipped** | Internal **`/research/artifacts`** + **`research_context_loader`** + reply digest + **`opportunity_scout`** scoring/LLM (**`news_context`**, risk bumps). **Open:** **`signal_fusion_scorer`**, vol from history, filing rows. |
| **§9 Go-live checklist** | Open | Hard gates before declaring “launch”: queues, DR, etc. |
| **Situation room** — global awareness / “major events” | **Planned** | In-house feed (no reliance on monitor-the-situation.com); **dashboard UI directly under watchlist**; doubles as **live context for AI agents**. Full plan: **§ Situation room / global monitor** below. |

## Product vision (north star — whole project guide)

> We want the AI agent to identify dips and send out alert emails that **describe what is going on** and give a **recommendation on how much to allocate**. Sometimes these drops are due to **sentiment or news** that causes a **fire sale**.

**How we implement this safely:** **Dips are detected mechanically** (price vs baseline / watchlist rules), so alerts are auditable. The **LLM explains** context (e.g. Grok + X search, later news/filings), frames **sentiment / fire-sale** narratives, and suggests **allocation bands** only within **user caps and policy** — never unconstrained “model prices.”

## Agent planning principles (non-negotiables)

- **Grounding:** Prices, percentages, and sizes shown to users must come from **tools / computed data**, never from model recall. The LLM explains, ranks, and drafts text; **quotes and thresholds are tool-backed or deterministic**.
- **Eval early:** Keep a **minimal golden / smoke eval** (schema + a few fixed prompts) updated in parallel with graph changes—do not wait until Phase 5 for the first regression harness.
- **Bandwidth rule:** **Phase 0 chart hardening** continues on a separate track from **agent milestones**. If shipping the agent wins a sprint, defer non-blocking chart polish; if charts are blocking demos or prod stability, prioritize jitter fixes first.
- **Watchlist triggers:** Define **inputs** (last price, baseline/fair band, short-window return, vol proxy) and **dedupe/cooldown** (per user+symbol+trigger class, time bucket) before wiring schedulers—avoid duplicate or spam notifications.
- **Cost / abuse:** Track LLM usage per run where possible; enforce existing rate limits; optional per-user caps / backoff for chat and opportunity scans in production.

## Roadmap position (reality check)

- **Phase 0** (charts / regression): **✅ MVP complete** — non-blocking polish only if regressions appear (§2).
- **Phase 1** (LangGraph foundation): **✅ Core complete** — gateway, Opportunity Scout graph, dip-insight path, persistence, golden smoke tests.
- **Now:** **§11 Phase C** (tail) — **`signal_fusion_scorer`** + history vol; **§11 Phase B** — queue worker, EDGAR; **§11 Phase D** — dedupe + async send; **Phase E** briefing card.
- **Phases 2–5 & §9:** deferred until fusion + observability justify broader tooling and launch gates.

## Resume Here Next Session

### Recent session — Crypto dashboard parity with stocks (done)

- **`frontend/src/pages/CryptoPage.tsx`:** Same **`app-shell`** / header band / control strip as **`ChartPage`** (connection, Volume/Indicators, data source label, quote status, cadence **updates every 10s**, stale timer, Refresh). Main column **`lg:[grid-template-columns:minmax(0,3fr)_minmax(320px,1fr)]`**, feed-status bar above chart, period **presets** (1D–All mapped to Kraken interval + time range; YTD uses **6M** window — API has no true YTD). Sidebar: quote card (stock-like styling), crosshair panel (crosshair time handles **ms vs s**), **Pair info**, **Indicators** block when toggled on.
- **`frontend/src/components/charts/cryptoChartTechnical.ts`:** Shared SMA/EMA/RSI/MACD math; MACD signal uses **EMA on numeric MACD line** (fixes bad `.close` on numbers). **`summarizeCryptoIndicators`** for last bar.
- **`frontend/src/components/charts/CryptoChart.tsx`:** Uses shared technical series; optional **`onIndicatorSummary`** callback for sidebar. Removed dead duplicate indicator block; wiring uses **`useMemo` + `computeCryptoTechnicalSeries`**.
- **URL:** Pair selection calls **`setSearchParams({ pair })`** (with existing `?symbol=` → `X:SYMUSD` parsing).
- **Data loading:** OHLC cache in **`useRef`** (avoids unstable `loadCryptoData` deps). No success toast on every load (closer to stocks).
- **Not in this pass:** Deeper `SimpleChart` vs `CryptoChart` feature parity (e.g. full `TradingViewTimeline` wire-up if desired); true **YTD** range if backend adds it.

### Last deploy (pick up here)

- **Frontend + Node:** `npm run deploy` or `bash scripts/deploy-production.sh` — builds **`frontend/build`**, **`pm2 reload keepitbased-api`**, checks **`http://127.0.0.1:3001/api/health`**.
- **OpenBB sidecar:** `pm2 start ecosystem.openbb.config.js` (loads **`backend/.env`** into **`openbb-platform`** for **`POLYGON_API_KEY`** / **`MASSIVE_*`** merge into **`~/.openbb_platform/.env`**). Probe **`http://127.0.0.1:6900/docs`**. **`OPENBB_*`** toggle in **`backend/.env`**; **`GET /api/health/config`** → **`config.OPENBB_ENABLED`**, **`OPENBB_STOCK_HISTORY_EXCLUSIVE`**, etc.
- **Python / LangGraph:** deploy script does **not** restart **`stock-service`** — after backend/agent changes run **`pm2 restart stock-service`** (and verify **`http://127.0.0.1:5001/health`** — `opportunityGraphReady`, etc.).
- **Persist PM2:** `pm2 save` after successful reloads (include **`openbb-platform`** whenever OpenBB should survive reboot **`pm2 resurrect`**).

### Where things stand

- **Charts:** **`/charts`** — stock dashboard (`ChartPage`); **`/crypto`** — crypto dashboard (when **`OPENBB_ENABLED`**: OpenBB **`yfinance`** OHLC/ticker **first**, else **Polygon → Binance → CoinGecko**). **UX-aligned** with stocks (see **Recent session — Crypto dashboard** above). Watchlist deep links use **`/charts?symbol=…`** vs **`/crypto?symbol=…`** / **`?pair=…`**.
- **Dashboard:** `/dashboard` — chat + **watchlist table** (quotes, baseline, dip signals). **`/api/agent/chat`** → Python **`POST /agent/opportunities`** with **`watchlistContext`**. **Planned:** **`Situation room`** panel **immediately below the watchlist** — live geopolitical / macro / maritime / aviation awareness (see **§ Situation room / global monitor**).
- **Alerts:** **`evaluateWatchlistOpportunity`** + **`PriceMonitor`** → Socket **`opportunitySignal`**, **`opportunity_signals`** DB, **`GET /api/opportunity-signals`**.
- **Dip briefing emails:** **`ENABLE_DIP_INSIGHT_EMAIL`** + Profile **`dipInsightEmail`** / **`agentMaxPositionSizePct`** → Python **`POST /agent/dip-insight`** (Grok + **`x_search`**) → SES; fallback plain opportunity email; audit **`agent_runs`** (`source=dip_insight`). **`docs/RESEARCH_AGENT.md`**, **`npm run golden:dip-insight`**, **`GET /api/health/config`** (`smtpConfigured`, `dipInsightGloballyEnabled`).
- **Research fusion (Phase D slice):** If Profile **`researchDigestEmail`** is **true**, **`evaluateDipInsightFusionGate`** requires **`correlationRuleV1`** (dip flags ∧ ≥1 **`research_artifact`** in **`RESEARCH_FUSION_LOOKBACK_HOURS`**); otherwise **plain** opportunity email only. If **`researchDigestEmail`** is **false**, dip-insight behavior is unchanged (speed path).
- **Research in agent (Phase C MVP):** **`GET /api/internal/research/artifacts`** → **`research_context_loader`** → **`opportunity_scout`** adjusts **`event_risk`** / **`riskFlags`** from headline count + keyword hint; **`summarize_candidate(..., news_context=)`**; optional candidate fields **`researchHeadlinesInWindow`**, **`researchNegativeKeywordHint`**. Reply digest still prepends headline block in **`response_formatter`**.

### What to do next (ordered)

1. **§11 Phase C tail:** **`signal_fusion_scorer`** node or fold **realized vol** from **`fetch_stock_history`** into **`opportunity_scout`** `event_risk` (todo bullets in **`## 11)` Phase C**).
2. **§11 Phase B tail:** BullMQ/pg-boss **queue** for ingestion (optional); **EDGAR / X** artifacts.
3. **§11 Phase D tail:** digest **dedupe** keys + **async** email enqueue.
4. **Phase E:** dashboard **“latest briefing / headlines”** card (parity with email/agent).
5. **Phase F:** frozen-response goldens; **`DISABLE_RESEARCH_EMAILS`** when fused mail grows.

### Parallel (optional, smaller)

- **Situation room (global monitor):** phased plan + GitHub starting points in **§ Situation room / global monitor**; **dashboard** section **below watchlist**; agent feed **SR-5**.
- **OpenBB / market data:** post-deploy **`openbb-service`** `pip install -r requirements.txt` after **`requirements.txt`** changes; optional **`OPENBB_EXCLUSIVE_ALL=true`** smoke test vs hybrid mode; **`scripts/smoke-openbb.sh`** TBD if we want CI parity.
- **Phase E slice:** dashboard card “**last dip briefing**” / link to recent **`agent_runs`**.
- **Phase F:** **frozen-response** golden for `/agent/dip-insight` (no live LLM spend in CI).
- **Infra:** **`DISABLE_RESEARCH_EMAILS`** when fused digests ship; DMARC DNS (ops).

### Previous immediate items (now largely shipped)

- ~~Agent runs persistence~~, ~~watchlist opportunity integration~~, ~~golden scripts~~ — done.

### Working checklist (order)

1. ~~Verify provider routing / graph readiness on startup (via Python `/health` + logs; no LLM spend).~~
2. ~~Implement run + message persistence + write path from `/api/agent/chat`.~~
3. ~~**Integrate** watchlist opportunity evaluator with price polling (`PriceMonitor` + Redis dedupe + Socket `opportunitySignal` to `user_{id}`).~~
4. ~~Smoke script: `npm run smoke:opportunity` (Python `POST /agent/opportunities`).~~
5. ~~In-app notification: Socket.IO toast on `opportunitySignal` (authenticated handshake); **persist** `opportunity_signals` + **prefs** `opportunityToasts`.~~
6. ~~**GET /api/agent/runs** for recent persisted chat runs (audit / future UI).~~
7. ~~**GET /api/opportunity-signals** + golden suite **`npm run golden:opportunity`**.~~
8. ~~**Dashboard watchlist table** (stock-app columns + live quote age); **`scripts/deploy-production.sh`** / **`npm run deploy`**.~~
9. **§11 Phase C (tail):** optional **history-based vol** in **`opportunity_scout`**; Python **`signal_fusion_scorer`** node. **Parallel:** Phase B queue + EDGAR; Phase D dedupe.
10. **Deploy hygiene:** after Python agent changes, **`pm2 restart stock-service`**; after Node/UI changes, **`npm run deploy`** (or `deploy-production.sh`). See **Resume Here → Last deploy**.

### Backlog (non-blocking)

- [ ] **Upgrade market-data API tier** — Same need **even with OpenBB** for **equity** paths that use **`openbb-polygon`**: OpenBB proxies Polygon/Massive; it does **not** lift rate limits or unlock snapshots by itself. Move to a plan with depth + entitlements consistent with dashboards + **`PriceMonitor`**. (**Crypto via `yfinance`** in OpenBB can reduce Polygon crypto load but is not a substitute for Polygon crypto where you rely on Massive aggregates.)
- [ ] **True streaming market data — defer until Execution agent** — Current stack uses **snapshot** REST pulls, chart **polling** (~3–10s when snapshot-backed), and watchlist **`PriceMonitor` ~1 min** cadence → Redis → Socket **`priceUpdate`** (push of batch snapshots, not exchange tick-by-tick). When integrating an **execution agent** (orders, slips, NBBO-aware logic), plan: vendor **WebSocket** trade/quote streams, correct **entitlements**, a small ingestion/fan-out service, and socket scaling — out of scope for the **research + alert** agent milestone.
- [ ] **Situation room / global monitor** — See **§ Situation room / global monitor (build plan)** below (dashboard placement + agent-facing feed).

## Situation room / global monitor (build plan)

**Why build (not embed a third-party “situation” site):** [monitor-the-situation.com](https://monitor-the-situation.com) is **not open-source** and has **no documented public API**, so a **first-party pipeline** from public / licensed sources gives **full control**, **“major events only”** gating, **clean embedding** on **keepitbased.com**, and a **stable contract** for **LangGraph / opportunity / research** agents.

### Product placement

- **UI:** On **`/dashboard`**, a **full-width section immediately below the watchlist table** (above or beside chat per final layout): map + **event stream** + filters (region, category, min severity, time window).
- **Agent use:** Persist normalized **`situation_events`** (or reuse/extend **`research_artifacts`** with a `source_kind` / `payload` schema) + **`GET /api/internal/situation/recent`** (or Python tool) so **`opportunity_scout`**, **dip-insight**, and future **research** nodes can pull **last N hours of major global context** without scraping HTML.

### Architecture (high level)

1. **Ingest workers** (Python cron or Node `bull`/Redis queue): poll or stream each provider on a **conservative cadence**; respect **rate limits** and **ToS**; write **raw** blobs only if needed for audit.
2. **Normalize** to a single schema: `id`, `occurred_at`, `lat`, `lon` (optional), `title`, `summary`, `category` (conflict / protest / aviation / maritime / macro / health / weather / other), `severity` (0–5 or S0–S5), `source`, `source_url`, `dedupe_key`.
3. **Filter:** **Stage 1** rules (keywords, GDELT **Goldstein** / quad class, ACLED **disorder_type**, AIS anomaly heuristics). **Stage 2** optional **LLM skim** (Grok/xAI already in stack) → bool `major_only` + 1-line rationale; **never** invent facts—only **classify/filter** sourced rows.
4. **Serve:** Node **`/api/situation/feed`** (auth) + Redis cache; optional **Socket.IO** “pulse” for new **S4+** items.
5. **Map:** **`react-leaflet`** + OSM (**or** **[MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js)** if we want vector tiles / heavier styling later).

### Recommended OSS / repos (starting points — verify license & activity before pinning)

| Area | Recommendation | Links |
|------|----------------|--------|
| **GDELT** (events / news-derived signals) | Modern Python client covering REST surfaces; **`gdeltdoc`** for Doc API-only simplicity; **`gdeltPyR`** legacy reference | [RBozydar/py-gdelt](https://github.com/RBozydar/py-gdelt) · [alex9smith/gdelt-doc-api](https://github.com/alex9smith/gdelt-doc-api) · [linwoodc3/gdeltPyR](https://github.com/linwoodc3/gdeltPyR) |
| **RSS / wires** | Curated **Reuters / AP / UN / reliefweb** etc. (**ToS**/robots permitting); **`feedparser`** + **`httpx`/`aiohttp`** fetch | Standard [feedparser](https://github.com/kurtmckee/feedparser) · optional fast path [bug-ops/feedparser-rs](https://github.com/bug-ops/feedparser-rs) |
| **ACLED** (conflict & protest — **registration + terms**) | Official **OAuth API** ([docs](https://acleddata.com/acled-api-documentation)); **no** first-party SDK — thin internal `requests` wrapper | Implement **`acled_client.py`** in-repo; optionally mirror **Humanitarian Data Exchange** ACLED snapshots for bulk backfill ([HDX org](https://data.humdata.org/organization/acled)) |
| **Aviation / ADS-B** | **OpenSky** is the safest default OSS story (rate limits / auth evolve — check latest policy) | [openskynetwork/opensky-api](https://github.com/openskynetwork/opensky-api) · [open-aviation/pyopensky](https://github.com/open-aviation/pyopensky) (live + historical patterns) · **ADS-B Exchange** alternatives: evaluate **commercial ToS** before production |
| **Maritime AIS** | **`aisstream.io`** WebSocket (free tier, API key); official examples multi-language | [aisstream/example](https://github.com/aisstream/example) · [aisstream/ais-message-models](https://github.com/aisstream/ais-message-models) · **AISHub** “contribute-to-receive” model if self-host AIS stream |
| **Map (React)** | **`react-leaflet`** + **`leaflet`**; cluster plugin if dense points | [PaulLeCam/react-leaflet](https://github.com/PaulLeCam/react-leaflet) · [Leaflet](https://github.com/Leaflet/Leaflet) · optional clustering [yuzhva/react-leaflet-markercluster](https://github.com/yuzhva/react-leaflet-markercluster) |

### Build phases (suggested order)

| Phase | Scope | Outcome |
|-------|--------|--------|
| **SR-0 — Schema & API** | DB table + **`/api/situation/feed`**, pagination, **`dedupe_key`**, admin env flags | Blank UI shell on dashboard stub |
| **SR-1 — GDELT + RSS MVP** | Ingest hourly (or 15m) slices; rule-based **severity** + cap N/day | Scrollable feed under watchlist; map optional |
| **SR-2 — Map** | Lat/lon from GDELT/ACLED/RSS geo; **heat / markers**; region filter | Parity with “situation board” feel |
| **SR-3 — ACLED** | Registered API; conflict layer toggles | Richer conflict/protest fidelity |
| **SR-4 — OpenSky + AIS** | Bounding-box subscriptions; throttle; **never** overload free APIs | Aviation + shipping “activity” overlays (density, not brokerage advice) |
| **SR-5 — Agent** | Internal tool + prompts: “summarize verified major events last 24h”; inject into **`research_context`** path | Agents cite **situation_feed** row IDs |

### Risks / compliance

- **ToS:** Wire services, AIS vendors, and **ACLED** have **explicit use/redistribution clauses** — legal review before public SaaS caching.
- **Rate limits:** Use ** backoff**, **aggregation**, avoid per-user scraping of upstream.
- **False positives:** “Major” filtering is **heuristic + optional LLM**; surface **provider + link** always.
- **Security:** Treat URLs as untrusted; **sanitize** summaries for XSS; SSRF-safe fetcher for server-side preview if any.

### Parallel work with §11

- Complements **Phase B** (`research_artifacts`) as a **macro/geopolitical** channel; **do not** conflate with **ticker news** from Polygon—keep **separate ingestion** jobs and **fuse in agent layer** only when relevant (e.g. energy shipping + oil names).

## 1) Program Goals

### Primary business goals

- Deliver a production-grade stock/crypto dashboard with stable charting and actionable alert workflows.
- Build the first AI Agent as an opportunity-identification planner for high-quality stock ideas.
- Evolve to a multi-agent system where specialized agents (research, risk, execution) collaborate through policy controls.
- Maintain strong security, observability, and change control.

### Success criteria

- Dashboard is stable (no visible jitter/flicker in normal use).
- Alert actions are reliable and auditable.
- AI Agent supports recommend mode first, auto-execute only behind policy gates.
- Agent #1 consistently produces ranked opportunities with rationale, risk notes, and confidence bands.

## 2) Current State (Checkpoint)

### Completed

- Massive/Polygon market-data migration completed; Yahoo Finance removed.
- Backend contracts hardened:
  - candle/quote sanitization
  - quote/history metadata (`sourceUsed`, `partialData`, `lastUpdated`)
  - stock quote source fallback (`snapshot` -> `agg_minute` -> `agg_day`)
- Redis caching added for `/charts/history` and `/charts/quote` with source/interval TTL strategy; **extended stale quote key** (**`charts:quote:stale:*`**) for resilience; **upstream retries** (429/transient 5xx) on Massive REST in **`charts.js`**, **`crypto.js`**, **`dailyAtrService`**.
- Regression suite added:
  - `backend/scripts/chartRegressionCheck.js`
  - `npm run test:charts`
- Stock dashboard upgraded:
  - source + freshness status
  - stale data messaging
  - cleaner layout and controls
- Chart engine replaced with `lightweight-charts` for stocks.
- **Crypto charts (`/crypto`):** Layout and controls aligned with stock **`ChartPage`** (see **Resume Here → Recent session — Crypto dashboard**); shared technical helpers in **`cryptoChartTechnical.ts`**; indicator sidebar fed via **`onIndicatorSummary`** on **`CryptoChart`**.
- Indicators v1 implemented:
  - SMA20/SMA50
  - EMA20/EMA50
  - RSI14
  - MACD/Signal/Histogram
- AI Agent section scaffolded in UI:
  - `/ai-agent` route
  - chat-like interaction panel
  - draft-plan display
  - alert apply hook
- AI agent backend gateway is live:
  - `/api/agent/chat` (auth + rate-limited)
  - `/api/agent/apply` (auth + rate-limited)
  - frontend wired to real backend responses
- AgentOutputV1 contract is active end-to-end:
  - `schemaVersion`, `topCandidates`, `score`, `confidence`, `whyNow`, `riskFlags`, `suggestedLimitBand`
  - dashboard controls for user-tunable agent parameters (`topN`, confidence floor, max position size, watchlist-only, scoring weights)
- LangGraph Opportunity Scout scaffold is live in Python service:
  - endpoint: `POST /agent/opportunities`
  - nodes: `intent_router`, `context_loader`, `opportunity_scout`, `policy_guardrail`, `response_formatter`
- LLM integration baseline is working with Grok:
  - provider routing via env vars only (no hardcoded secrets)
  - run metadata added (`runId`, `nodeTimings`, `providerUsed`, `fallbackUsed`)
  - current verified state: `providerUsed=grok`, `fallbackUsed=false` on successful runs

### Remaining known issues / verification

- Final jitter elimination under sustained polling/symbol switching.
- Verify quote connection status behavior does not flicker on transient misses.
- Validate chart UX at all key breakpoints (desktop/tablet).

## 3) AI Agent Architecture (Target)

### Orchestration model

- Use LangGraph as workflow engine.
- Use external LLM API for planning/reasoning nodes.
- Use deterministic tool nodes for market data + alert actions.

### Multi-agent target model (planned)

- Agent 1 (Opportunity Scout): identifies and ranks candidate stocks to buy.
- Agent 2 (Risk Analyst): validates exposure, volatility, and drawdown constraints.
- Agent 3 (Execution Agent): converts approved plans into alert/execution actions.
- A policy coordinator gate controls cross-agent approvals and escalation.

### Required agent capabilities

- Interpret user strategy intent.
- Build alert plans with threshold logic and risk notes.
- Retrieve context (quote/history/indicators/active alerts).
- Propose actions and request approval.
- Execute actions safely when approved.
- Score opportunities using a transparent framework (trend, momentum, valuation proxy, liquidity/event risk).
- Return ranked candidates with explainable rationale and confidence.
- Emit real-time watchlist notifications when assets appear "on sale" versus configured fair-value/range signals.
- Suggest limit-order entries (price bands + sizing hints) for review, never auto-submit in early phases.
- Detect hyperreactive market states (news/geopolitical shocks, volatility spikes, liquidity dislocations) and tighten risk guidance.

### Safety model

- Mode A: `recommend_only` (default at launch).
- Mode B: `auto_apply_low_risk` (feature-flagged).
- Mode C: broader automation only after evaluation targets are met.

## 4) Step-by-Step Execution Plan

### Phase 0 - Hardening Before Agent Backend — **✅ Complete (MVP)**

**Delivered:** Chart regression (`npm run test:charts`), lightweight-charts integration, Redis-backed quote caching, stale-quote UX.

**Non-blocking follow-ups:** §2 “Remaining known issues / verification” (occasional jitter under rapid symbol switch, breakpoint QA).

### Phase 1 - Backend Agent Skeleton (LangGraph foundation) — **✅ Complete (core)**

**Delivered:** Python LangGraph service (`POST /agent/opportunities`, `/agent/buy-alert/:symbol`, `/agent/dip-insight`); Node gateway `/api/agent/chat` → Python; `agent_runs` / `agent_messages` persistence; Opportunity Scout nodes (`intent_router`, `context_loader`, `opportunity_scout`, `policy_guardrail`, `response_formatter`); Grok-backed dip briefing email path + SES + Profile prefs.

**Deferred to Phase 2+:** Full tool catalog item-by-item; explicit `planner` node split where the graph needs it.

### Phase 2 - Tooling + Alert Control Integration

1. Implement agent tools:
   - `get_quote(symbol)`
   - `get_history(symbol, period, interval)`
   - `get_technical(symbol)`
   - `list_alerts(userId)`
   - `create_alert(...)`
   - `update_alert(...)`
   - `toggle_alert(...)`
   - `get_watchlist(userId)`
   - `stream_watchlist_quotes(userId)` (or poll equivalent with cadence controls)
   - `get_market_regime()` (volatility/risk-on-risk-off classifier)
   - `get_news_risk_signals(symbol?)`
2. Validate all tool calls are user-scoped and authenticated.
3. Add standardized tool result/error envelopes.

Definition of done:
- Agent can propose actionable alert plans using live app context.
- Apply endpoint can execute a vetted single action with audit log.
- Agent emits timely opportunity notifications with suggested limit-order ranges and rationale.

### Phase 3 - Policy & Risk Controls

1. Add policy rules:
   - max threshold bounds
   - max actions per request
   - symbol allow/deny logic
   - high-risk confirmations
2. Add execution approval state machine:
   - proposed
   - approved
   - rejected
   - executed
3. Add rate limits for agent action endpoints.
4. Add order-suggestion safety constraints:
   - max suggested position size by risk profile
   - volatility-adjusted entry spacing
   - "news shock" cooldown windows before aggressive entries

Definition of done:
- Agent cannot execute disallowed actions.
- All actions have policy decision trace.

### Phase 4 - Frontend Agent UX (Professional)

1. Replace local heuristic agent logic with backend API calls.
2. Render structured plan cards:
   - summary
   - proposed actions
   - risk notes
   - confidence / rationale snapshot
3. Add action controls:
   - approve/reject/apply
   - retry plan
   - switch mode (`recommend_only` vs `auto_apply_low_risk`)
4. Add activity timeline and action receipts.

Definition of done:
- User can safely review and apply agent plans end-to-end.

### Phase 5 - Evaluation, QA, and Release Readiness

1. Build golden prompt suite with expected behavior.
2. Add metrics:
   - plan latency
   - execution success rate
   - policy rejection rate
   - user approval rate
3. Add incident playbook and rollback procedures.

Definition of done:
- Agent meets launch thresholds and is operationally supportable.

## 5) Security & Compliance Checklist

- LLM API keys stored server-side only (never frontend).
- Redact PII/secrets in logs.
- Audit every applied action with user, timestamp, payload.
- Enforce authn/authz on all agent endpoints.
- Add abuse limits for chat/apply endpoints.

## 6) Delivery Workflow

For each phase:

1. Create small scoped implementation PR.
2. Include test plan + rollback notes.
3. Merge only after:
   - lint/tests pass
   - manual QA checklist complete
   - no known critical regressions.

## 7) Immediate Next Task Queue — migrated

Most of the original queue **shipped** (AgentOutput contract, LangGraph gateway, watchlist opportunity pipeline, persistence, golden suites). **Active focus:** **`## 11) Phase C`** signal fusion + vol; **Phase B** EDGAR/queue; **Phase D** dedupe; **Phase E** card. **Parallel:** Phase F goldens; §9 go-live.

## 10) Next Session Kickoff Checklist

1. Verify `/api/agent/chat` and `/agent/opportunities` return `providerUsed=grok` on startup — **startup:** Python `/health` `agent.*` + Node logs when `ENABLE_LANGGRAPH_AGENT=true`; **full routing** still requires an actual scan (uses LLM quota).
2. ~~Persistence layer for agent runs (`agent_runs` + `agent_messages`) + write path from `/api/agent/chat`.~~ Retention policy / pruning job still optional.
3. **Integrate** watchlist-opportunity evaluator (`backend/services/watchlistOpportunityEvaluator.js`) with polling + dedupe — pure logic is in place.
4. Define notification transport contract (in-app first, then optional email/push).
5. Draft initial golden prompt set (normal market, high-volatility, news-shock scenarios).

## 8) Commands

### Development

- Backend: `cd backend && npm run dev`
- Frontend: `cd frontend && npm start`

### Quality checks

- Chart regression: `npm run test:charts`

### Build

- Frontend production build: `cd frontend && npm run build`

### Production deploy (this host)

- **App + static:** from repo root `npm run deploy` (runs `scripts/deploy-production.sh` — build, `pm2 reload keepitbased-api`, `/api/health` check, `pm2 save`).
- **OpenBB:** first time per host: `cd openbb-service && ./start.sh` (or rely on PM2). **`pm2 start ecosystem.openbb.config.js`** reads **`backend/.env`** automatically. Set **`OPENBB_ENABLED=true`** in **`backend/.env`** (api process load). After OpenBB dep changes: refresh venv `pip install -r openbb-service/requirements.txt`.
- **Python agent:** `pm2 restart stock-service` then `curl -sf http://127.0.0.1:5001/health` (opportunity graph + LLM must be healthy).
- **Ingestion cron** runs inside **`keepitbased-api`**; enable with **`ENABLE_RESEARCH_INGESTION=true`** in `backend/.env`.
- **Test opportunity email (plain HTML, same template as PriceMonitor):** `npm run email:test-opportunity` from repo root — requires an active **stock** **`user_alerts`** row with **`baseline_price`**, and email notifications on. Optional **`TEST_USER_ID`**. Subject prefix **`[TEST]`**.

## 9) Go-Live Infrastructure Checklist (Must Complete Before Launch)

Use this as a hard launch gate. Do not mark launch-ready until each item is reviewed and signed off.

- [ ] Load test completed with documented breakpoints and recovery plan.
- [ ] Session state is externalized (Redis/DB), not in process memory.
- [ ] File uploads are stored in object storage (not app server disk).
- [ ] Email sending is asynchronous through a queue worker.
- [ ] Background jobs run in a dedicated queue system (no request-thread blocking).
- [ ] No hardcoded secrets in scripts or CI; all secrets from env/secret manager.
- [ ] Database scaling plan in place (read replica/caching strategy for read-heavy paths).
- [ ] CDN configured for static assets and media.
- [ ] DB migrations are run as a controlled deployment step (not automatic app startup).
- [ ] Backup restore drill performed and documented.
- [ ] Foreign key columns and high-frequency query paths are indexed.
- [ ] Rate limiting is enforced on public and sensitive endpoints.
- [ ] API compression enabled for JSON/static responses.
- [ ] Error alerting configured (on-call notifications for critical failures).
- [ ] Multi-step writes use transactions for atomic consistency.
- [ ] Health check endpoints exist and are wired to load balancer checks.
- [ ] Long-running services checked for memory leaks and restart policies set.
- [ ] Graceful shutdown is implemented and verified during deploy.
- [ ] Third-party dependencies have fallback/degraded mode behavior.
- [ ] Logs are centralized with retention (not local disk only).
- [ ] External API calls have circuit breaker and retry/backoff policy.
- [ ] Search/query paths are parameterized and performance tested with production-like data.
- [ ] Outbound HTTP calls enforce connect/read timeouts.
- [ ] Real-time/WebSocket infrastructure is state-aware for horizontal scaling.
- [ ] Incident runbook exists for common outages (DB down, provider down, queue lag, deploy rollback).

## 11) Multi-source research agent + dip-triggered deployment alerts (execution roadmap)

**Product intent:** Extend the agent from **pull-based chat** (and today’s deterministic **price vs baseline** opportunity emails) to a **research-grounded alerting pipeline** that fuses **X / social sentiment**, **news**, **SEC filings (10-K/10-Q)**, and **financial reporting datapoints**, with **dip / valuation context** from existing watchlists and quotes—and emails the user an **audit-style recommendation** framed as educational output: **timing**, **staged sizing**, **invalidation**, and **confidence caveats**.

**Non-negotiables (same as § Agent planning principles):**  
All **numbers shown to users** (prices, % vs baseline, position %, floats) must originate from **tools / DB / vendor APIs**, not model recall. The LLM **synthesizes and explains**; it does not invent filings, headlines, or prices. Maintain **explicit “not investment advice”** copy in email footers and in-app. Consider **commercial terms** for each data vendor (X API tiers, redistribution of SEC text, delayed vs real-time quotes).

---

### Phase A — Scope, policy, and data contracts

- [x] **Problem statement & user story:** See `docs/SECTION_11_PHASE_A.md` — ICP, caps, quiet hours (stored in `notification_preferences`, merge via `mergeNotificationPreferences`).
- [x] **Legal / compliance review (lightweight):** Same doc — disclaimers, EDGAR/news/X retention notes.
- [x] **`DeepAlertOutput` schema v1:** `backend/schemas/deepAlertOutputV1.js` (`validateDeepAlertOutputV1`, provenance pattern for numerics).
- [x] **Correlation rules (v1 baseline):** Same doc + `correlationRuleV1()` in `backend/utils/researchAlertGates.js` (dip flags ∧ research artifact count); NLP severity / tiering deferred to Phase C.

### Phase B — Ingestion & storage layer (foundation)

Split **fetch/cache** from **reasoning**. Prefer **scheduled jobs + idempotent ingestion** over doing heavy I/O inside a single LangGraph invoke.

- [ ] **Job runner:** Introduce **asynchronous worker** path (bullmq / pg-boss / Sidekiq-style in Node—or separate Python worker) consistent with §9 “background jobs dedicated queue”; avoid blocking `PriceMonitor` cron thread. *(MVP: cron in API + `scheduleResearchIngestion`.)*
- [x] **`research_artifacts`:** Table + `content_hash` dedupe, indexes; `researchArtifactsService`, **`npm run research:ingest-once`**.
- [ ] **X (Twitter):** Leverage **`xInvestorFeedService`** / bearer token pattern; extend to **per-symbol cashtag + curated list ingestion** where API allows; normalize to `ResearchArtifact`; respect **rate limits** and backoff; circuit breaker logs.
- [x] **News (MVP):** Polygon **`/v2/reference/news`** — **`polygonNewsIngestion`** + **`aggregatedWatchlistSymbols`** (all list names; **STOCK** + **CRYPTO** tokens).
- [ ] **SEC filings (10-K/10-Q/8-K earnings):**  
  - [ ] Resolve **CIK** from ticker (SEC company_tickers / mapping table).  
  - [ ] Poll **submission API** or EDGAR index for accepted filings; dedupe by `accession-number`.  
  - [ ] **Fetch primary HTML** + optional **XBRL instance** (`*.htm`/`ix?doc=`), store object reference (S3 or DB blob capped) per §9 infra when ready.  
  - [ ] **Extraction MVP:** Sections via regex/heuristics (Risk Factors MD&A summary length cap) → LLM summarize with **quoted spans max N chars**; **Phase B2:** XBRL facts for Revenue, EBITDA, debt (structured tool output).
- [ ] **Financial reporting / fundamentals snapshot:** Quarterly metrics from vendor API or XBRL-derived store; persist “as-of” and source; expose `get_fundamentals_snapshot(symbol)` tool to LangGraph.

### Phase C — LangGraph expansion (research + fusion nodes)

Extend Python graph (new workflow or subgraph) beyond `opportunity_scout`:

- [x] **`research_context_loader`:** After **`market_data_loader`**, **`GET /api/internal/research/artifacts`** (Node **`researchArtifactsReader`**, watchlist allowlist) → digest in **`response_formatter`**.
- [ ] **`market_and_dip_context`:** Reuse **`watchlist_context`**, **`market_snapshots`**, **`research_context`**, optional vol / drawdown from history tool.
- [x] Feed **`research_context`** into **`opportunity_scout`:** headline count + regex **negative hint** → **`event_risk`** bump; **`_risk_flags_from_event_and_news`**; **`summarize_candidate(..., news_context=)`**; candidate fields **`researchHeadlinesInWindow`**, optional **`researchNegativeKeywordHint`**.
- [ ] **`signal_fusion_scorer`:** Deterministic weighted features (filing freshness, negative news density, sentiment delta from X baseline) → **explainable numeric vector** fed to LLM as context (not replacing tool numbers).
- [ ] **`sizing_policy_node`:** Map user **`maxPositionSizePct`**, liquidity tier, volatility proxy, and **tranche schema** into **bounded** `% portfolio` recommendation (enforce caps server-side regardless of prose).
- [ ] **`email_composer`** (structured): Template + LLM for narrative; validator rejects send if mandatory fields missing or citations absent for claims tagged “filing-derived”.

### Phase D — Triggering, dedupe, and email delivery

- [x] **Fusion gate (MVP):** `backend/services/researchFusionGate.js` — on opportunity email path, if **`researchDigestEmail`** then **`correlationRuleV1`** + **`countArtifactsForSymbol`**; else Grok dip-insight unchanged. Config **`RESEARCH_FUSION_LOOKBACK_HOURS`**, health exposes lookback.
- [ ] **`ResearchAlertEvaluator` (full):** Standalone orchestrator + separate cadence for news/filings; merge with **all** email classes and metrics.
- [ ] **Dedupe keys:** `user + symbol + alert_class + time_bucket`, separate buckets for **“dip-only”** vs **“dip+fundamentals”** to avoid redundant mail.
- [ ] **SMTP / SES pipeline:** Batch HTML + plaintext; link to **`/dashboard` / signals** with deeplink token optional; **`researchDigestEmail`** on **Profile** (fusion gate).
- [ ] **Async send:** enqueue send job; retries with DLQ per §9.

### Phase E — Frontend & observability

- [ ] Dashboard **“Latest research briefing”** card per symbol / run with **same structured fields** as email (parity).
- [x] **`/profile`:** **`researchDigestEmail`** toggle + copy (fusion gate with stored headlines).
- [ ] **`/profile`:** Frequency cap + timezone for fused digests (`researchMaxEmailsPerDay`, quiet hours) — prefs exist in merge; expose when Phase D digest cadence ships.
- [x] **`/profile`:** **Grok dip briefing** (`dipInsightEmail`) + **max tranche %** (`agentMaxPositionSizePct`) — ships §11 speed-path controls in UI.
- [ ] Metrics: ingestion lag, emails sent, skips (dedupe/provider error), LLM tokens per digest, guardrail rejects.

### Phase F — QA, golden runs, rollout

- [x] **Dip insight smoke:** `npm run golden:dip-insight` (POST `/agent/dip-insight`, schema check; needs Python + Grok).
- [ ] Golden fixtures with **frozen tool responses** + expected schema pass/fail — including **contradiction** case (bullish filings + hostile news → lower confidence tier).
- [ ] Canary users + kill switch env (`DISABLE_RESEARCH_EMAILS`).
- [x] Documentation: **`docs/RESEARCH_AGENT.md`** — env matrix, kill switches, troubleshooting, architecture.

---

**Suggested execution order:** **A → B (X/news first, filings MVP second) → D (wired to existing dip email path with minimal fusion) → C (full LangGraph richness) → E → F**.  

**Speed path (shipped) does not replace B:** Live Grok **`x_search`** dip emails + Profile toggles complement §11 but **do not** persist artifacts for dedupe, dashboards, or offline QA—**Phase B** remains the dependency for fusion + `ResearchAlertEvaluator`.

**Estimated reality:** Phase B (EDGAR + XBRL) and licensing are **the long poles**; align scope to an **MVP** (headlines + 8-K earnings + XBRL-lite or vendor fundamentals) before “full 10-K semantic search.”
