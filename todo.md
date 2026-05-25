# KeepItBased — Canonical roadmap (`todo.md`)

> **Single source of truth:** `keepitbased/todo.md` in this repo. When you or Cursor reference **`todo.md`**, use **this file only**. A stub at `/home/dstrad/todo.md` redirects here.

Last updated: **2026-05-23** (deploy list checkbox fix; session save).

**Session checkpoint (2026-05-23) — Deploy list checkboxes + DL-1/DL-2 live:** **Shipped:** Capital **deploy list** (`2b5665eb`) — `user_deploy_list_items`, `/api/deploy-list` CRUD + **Optimize with Grok**, dashboard **Deploy** column + panel. **Fix (this session):** Checkbox state no longer stuck after uncheck (`af438ce5`) — `deployAlertIds` is source of truth after list loads; optimistic toggle + rollback; paused/TW/crypto disabled; omit `targetWeightPct: 0` (validation). **Deployed:** `npm run deploy` + `pm2 reload keepitbased-api`. **Uncommitted WIP (do not mix):** signup-admin (`is_signup_admin`, `ProfileAdminPage`, `seedAdminsFromEnv` in local `database.js` only). **Next ops:** SES production (us-east-1 case pending); SPF/DMARC (`npm run email:check-dns`). **Next engineering:** **DL-3** `DeployPlanV1` + approve UI; Quant rank → **`buildAgentWatchlistContext`**; broker (**DL-4**).

**Session checkpoint (2026-05-25) — Legacy alerts removed + email diagnosis:** **Shipped:** Removed legacy **5/10/15%** threshold polling (`AlertService.processAlerts`), **`sendAlert`** emails, **`ENABLE_LEGACY_THRESHOLD_ALERT_EMAILS`**, and health **`legacyThresholdAlertEmails`**. Watchlist dip notifications are **only** via **`priceMonitor`** → opportunity tiers (`on_sale` / `overreaction` / `capitulation`). **`AlertService`** retained for **`user_alerts`** CRUD (watchlist + baselines). **Git:** `8fb10fbd` on **`main`**, deployed (`pm2 reload keepitbased-api`). **Email ops (verified on host):** SMTP login **OK** (`us-east-1`); opportunity test send **OK** to verified Gmail; **554** to unverified addresses → **SES sandbox** until **production access in us-east-1**. Replied to AWS Support (prior limit increase was **us-east-2** Ohio; production app uses **us-east-1** N. Virginia) — awaiting case response. **App suppressions (not SES):** weekend/RTH **morning_batch_queued**, Profile **`overreaction_only`**, quiet hours, hourly digest. **DNS still open:** SPF missing `include:amazonses.com`, no DMARC (`npm run email:check-dns`). **UX note:** landing **Open charts** → login (charts are protected). **Next ops:** SES production approval + DNS + SNS webhook. **Next engineering:** Quant rank → **`buildAgentWatchlistContext`**.

**Session checkpoint (2026-05-17) — Deliverability (inbox / spam):** **Shipped:** RFC **8058** one-click — `List-Unsubscribe-Post`, signed **`GET/POST /api/email/unsubscribe?token=…`** (`emailUnsubscribeToken.js`, `marketingEmailUnsubscribe.js`); SNS **SubscriptionConfirmation** auto-confirm on webhook (amazonaws.com URLs only). **Docs:** **`docs/DELIVERABILITY_DNS.md`**; **`npm run email:check-dns`**. **Git:** `d315f3f7`. **Ops still required (Namecheap + SES console):** DKIM CNAMEs, SPF merge `include:amazonses.com`, DMARC `_dmarc` TXT, production access, bounce/complaint SNS → webhook with **`SES_WEBHOOK_SECRET`**.

**Session checkpoint (2026-05-17) — Taiwan watchlist UX:** Dashboard shows **English alias** + `TW:code` subtitle (`getTwPrimaryEnglishAlias`, `agentWatchlistContext` **`englishAlias`**). **Git:** `45539662`.

**Session checkpoint (2026-05-17) — Email efficiency & Grok digest:** Hit SES **`454 Daily message quota exceeded`** from legacy threshold blast + uncapped sends (legacy loop **removed 2026-05-25**, see above). **Shipped:** **`emailSendBudget.js`** — global opportunity pool (**80/day**, **12/hr**), separate **digest pool** (**150/day**), per-recipient cooldown, auto-pause on 454; **`opportunityEmailDeliveryMode`** default **`hourly_digest`**; outbox honest on budget block. **Daily Grok watchlist briefing** re-enabled: **`ENABLE_DAILY_WATCHLIST_DIGEST_EMAIL=true`** (PM2 + config default on), Profile **`dailyWatchlistDigestEmail`** opt-out; digest **does not** increment **`opportunityMaxEmailsPerDay`**. **Per-user dip cap** default **5** (was 3; Profile aligned). **Health:** `GET /api/health/config` → **`emailSendBudget`** (+ **`digestDayCount`**). **Git:** `f6f8cd9b`, `3bc62cfe`, `5931a83f` on **`main`**, deployed. **Manual test:** `cd backend && npm run digest:run-once`. **Still open:** SES production access; SPF/DMARC/DKIM; users who saved **`opportunityMaxEmailsPerDay: 3`** keep 3 until Profile edit.

**Session checkpoint (2026-05-17) — Taiwan watchlist (iTick):** **`ITICK_API_TOKEN`**; symbols **`STOCK:TW:2330`** / **`TW:2330`**; **`itickClient.js`**, **`stockMarketIdentity.js`**, FOCI search + **`twEnglishAliases.json`** (~1.9k). **Git:** `34c3bcdb`, `fb06fad0`. **Open:** TW charts on dashboard (quotes only today).

**Session checkpoint (2026-05-17) — AWS SES / SMTP:** Rotated **SMTP credentials**; **`SMTP_HOST=email-smtp.us-east-1.amazonaws.com`**. **`npm run email:verify-smtp`**; **`smtpConfigured`** on health. **Still open:** Sandbox **200/day**; production access; SPF/DMARC/DKIM. **Next engineering:** Quant rank → **`buildAgentWatchlistContext`**.

**Session checkpoint (2026-05-11):** Quant **`rule_breaker_gardner`** (`/diag/market-universe-rank?strategy=rule_breaker_gardner`) — six 0–100 Gardner-proxy legs + terminal preset; LangGraph **`opportunity_scout`** order-independent scores + live-price **`suggestedLimitBand`**; **`llm_client`** Grok/scan respects **`topCandidates`** order vs server score; **`scripts/deploy-production.sh`** starts **`quant-agi-api`** / **`quant-agi-frontend`** when missing; Quant tape sorts by score; **`npm run quant:autoresearch-nightly`**. **Next:** LangGraph ingests **all rank strategies** + batched fundamentals + macro/news/X (`buildAgentWatchlistContext`). **Prior (2026-05-09):** fundamentals pipeline + Financials modal + photonics/momentum rank defaults. **Prior (2026-05-06):** **Profile + marketing + notification defaults:** **`ProfilePage`** — one **Notifications** section (channels, opportunity **dip email** + toast/email **tiers**, **quiet hours**, **timezone**, US **RTH** option, Grok/digest toggles); removed **`AlertDeliveryPreferences.tsx`**; **`OpportunityPolicyPanel`** dashboard copy + link to Profile only. **`backend/utils/notificationPreferences.js`:** merged defaults — **`opportunityEmailNotifyLevel`** default **`all`** (was smaller-tier filter by default); **`researchDigestEmail`** + **`dailyWatchlistDigestEmail`** **opt-out** (`!== false`). **`backend/models/database.js`:** **`notification_preferences`** rich **JSONB DEFAULT** + **`ALTER COLUMN … SET DEFAULT`** on init for new inserts. **`HomePage`** — marketing copy aligned to **AI agent**, **deterministic tiers** (`on_sale` / `overreaction` / `capitulation`), notifications; removed **vanity metrics** & **fabricated testimonials**; **`Link`** CTAs. **Ship:** **`npm run deploy`**.

**Prior (2026-05-05):** **Watchlist UX + mail + daily briefing:** Polygon/Massive-backed **Open / VWAP / Bid–Ask / `quoteSourceUsed`** end-to-end (PriceMonitor → Redis → **`buildAgentWatchlistContext`** → **`watchlistDerived`** merge + **`overlayFresherWatchlistQuotes`**); crypto **`dayChangeAbs`** stock-only in **`agentWatchlistContext.js`**. **`Opportunity email tier`** split from toasts: **`opportunityEmailNotifyLevel`** via **`passesOpportunityEmailTierFilter`** in **`priceMonitor.js`**; **`AlertDeliveryPreferences`** (later **removed** 2026-05-06) + **`notificationPreferences.js`**. **Fix:** missing `}` after RTH suppression branch in **`priceMonitor.js`** (deploy blocker). **Dashboard:** **`AIAgentPage`** — removed **Latest plan**, **Top opportunities**, **Run metadata** card; kept backup-mode strip. **Daily market briefing:** Node **`researchArtifacts`** → **`dailyWatchlistDigestWorker`**; Python **`generate_daily_watchlist_digest`**; **`sendDailyWatchlistDigestEmail`**. **§11 / dip:** `opportunity_signals.ai_assessment`, UltimateDipBuyer / confluence / email copy. **`npm run deploy`** + **`pm2 restart stock-service`** when Python changes.

**Prior (2026-05-04):** **Dashboard agent UX:** modes **Scan & rank** / **Ask a question** / **Smart**; LangGraph **`educational_qa`** + **`compose_scan_reply`**; Node→Python **`AGENT_PYTHON_TIMEOUT_MS`**; **`assistantIntent`** + **`conversationHistory`**; UI **backup-mode** banner + **progressive reply**. **Auth / signup:** **`username`**, personal **signup passcode**, **`invited_by_user_id`**. **Ops:** Navbar file ownership note if needed.

**Prior (2026-05-03):** **OpenBB ODP** app-wide (equity/crypto via **`openbb-yfinance`** / Polygon, **`OPENBB_ENABLED`**, PM2 **`openbb-platform`**); **AI agent backlog** + **[TradingAgents](https://github.com/tauricresearch/tradingagents)** notes in **§3.1**; Polygon retry/stale-quote; crypto dashboard parity; **Supabase** global chat + **`FloatingChatDock`**; watchlist/52-week hardening. **AGPL / Massive / deploy:** unchanged — `npm run deploy`, OpenBB AGPL review. **Git:** [PR workflow](#pull-requests--doing-it-correctly) when `main` is protected.

**Also shipped (follow-on):** Same as prior line; **§3.1** checklist items marked done where implemented below.

## Execution status snapshot

| Track | Status | Notes |
|-------|--------|--------|
| **Phase 0** — Charts / regression | **✅ Complete (MVP)** | Same + **optional OpenBB-first** paths for **`/charts/*`** & **`/crypto/*`** (`sourceUsed`: `openbb_equity`, `openbb_polygon_daily`, etc.). Optional polish in §2 “Remaining known issues”. |
| **Phase 1** — LangGraph / agent gateway | **✅ Complete (core)** | `POST /agent/opportunities` (+ **QA / compose** branches, `assistantIntent`, history), `/agent/dip-insight`, Node `/api/agent/chat` + **`AGENT_PYTHON_TIMEOUT_MS`**; persistence `agent_runs`/`agent_messages`; Grok dip emails + SES + Profile prefs. |
| **Auth / signup & identity** | **✅ Shipped** | **`username`** register + profile; **personal signup passcode** + dual gate vs global invite; DB **`username`**, **`signup_passcode_hash`**, **`invited_by_user_id`** (`database.js` init); `userSignupPasscodeService`; email username recovery body. |
| **§11 Phase A** — Contracts | **✅ Complete** | `DeepAlertOutput` scaffold, prefs merge, `researchAlertGates`, `SECTION_11_PHASE_A.md`. |
| **§11 “speed path”** | **✅ Shipped** | Deterministic dip → Grok + **x_search** (no X API) → email; optional artifact gate when `researchDigestEmail` is on. |
| **§11 Phase B** — Ingestion | **🟡 MVP shipped** | `research_artifacts` + Polygon `/v2/reference/news` + cron worker; all-watchlist tickers; dedupe `content_hash`. **Open:** dedicated queue worker, X + EDGAR (see §11). |
| **§11 Phase D** — Fusion gate | **🟡 MVP shipped** | `researchFusionGate` + `correlationRuleV1` on dip-insight path when **`researchDigestEmail`** true → else plain opportunity email. **Open:** digest dedupe keys, async queue, full `ResearchAlertEvaluator`. |
| **§11 Phase C** — Agent context | **🟡 MVP shipped** | Internal **`/research/artifacts`** + **`research_context_loader`** + reply digest + **`opportunity_scout`** scoring/LLM (**`news_context`**, risk bumps). **Open:** **`signal_fusion_scorer`**, vol from history, filing rows. |
| **AWS SES (transactional mail)** | **🟡 SMTP working; sandbox** | Budgets + **one-click unsub** shipped; legacy % mail **removed** (`8fb10fbd`). **Open:** **us-east-1** production access (Support case replied 2026-05-23), **DNS**, SNS webhook. |
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

## Email / SES — do not repeat this mistake (2026-05-09)

**What went wrong:** Real **AWS SES SMTP credentials** (`SMTP_USER` / `SMTP_PASS`, often an `AKIA…` style username) were stored in **`backend/.env.example`**, a file meant to be **committed to git**. Anyone with the repo (or a leaked clone) could relay mail through your SES domain — leading to abuse (e.g. forged invoice spam), **Trust & Safety pausing sending**, and `554 Sending paused`.

**Hard rules — never violate:**

1. **Secrets live only** in **`backend/.env`** on the server (or AWS Secrets Manager / SSM — **never** in example files, README, screenshots, or tickets).
2. **`backend/.env.example`** contains **only placeholders** (`YOUR_SES_SMTP_USERNAME`, fake hosts, comments). Spot-check before every merge.
3. **Rotate SES SMTP IAM credentials immediately** after any suspicion of leakage; deactivate old keys in **IAM / SES SMTP settings**.
4. **AWS console:** MFA on human users; dedicated IAM principal for SES SMTP with **least privilege**.
5. **GitHub:** enable **secret scanning** and **push protection** where available; optional local hook (gitleaks) on `SMTP_PASS`, `AKIA…`, etc.

**Operational checks:**

- **`SMTP_HOST`** must match **SES region** (e.g. `email-smtp.us-east-1.amazonaws.com` vs `…us-east-2…`).
- **`SMTP_FROM`** must be an address/domain **verified in SES** in that region.
- **Test sends:** `backend/scripts/sendTestOpportunityEmail.js` — exits **non‑zero** if SES rejects (e.g. pause); `pm2 logs` should show **`Opportunity signal email sent`** only on success.
- **Trust & Safety pause** is resolved **only when AWS reinstate sending** — not by code changes alone.

**DNS / deliverability (checked 2026-05-09 via public DNS; re-verify after changes)**

| Record | Current | Action |
|--------|---------|--------|
| **SPF** (`keepitbased.com` TXT) | `v=spf1 include:spf.efwd.registrar-servers.com ~all` (Namecheap forwarding) | **Merge** SES: single apex TXT SPF only — e.g. `v=spf1 include:spf.efwd.registrar-servers.com include:amazonses.com ~all` (confirm in [SES SPF docs](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-spf.html); flatten if you hit lookup limits). |
| **DMARC** (`_dmarc.keepitbased.com` TXT) | **None found** | Add at least **`v=DMARC1; p=none; rua=mailto:…@keepitbased.com`** (monitoring), then tighten policy later when mail is stable. |
| **DKIM** | *Not verified from CLI* (selectors are per-identity in SES) | In **SES → Identities → keepitbased.com**, copy each **DKIM CNAME** host; run `dig <host> CNAME +short` until all resolve. |

**Reference:** [Rotate SMTP credentials (AWS)](https://repost.aws/knowledge-center/ses-rotate-smtp-access-keys)

### Current status (2026-05-25; was 2026-05-17)

| Item | Status |
|------|--------|
| **Region** | **us-east-1** (N. Virginia) — `SMTP_HOST`, verified identities, and SMTP credentials must all match |
| **SMTP auth** | **✅** `npm run email:verify-smtp` → `OK — SMTP login accepted` |
| **End-to-end send** | **✅** `npm run email:test-opportunity` (use real `TEST_USER_EMAIL` from `users` table; not the placeholder `your-verified-email@…`) |
| **Account mode** | **Sandbox** — 200 emails/24h, 1/sec; recipients must be **verified** in SES until production access |
| **Send budgets (app)** | **✅** Opportunity mail **80/day** + **12/hr**; daily Grok digest **150/day** (separate pool); per-user dip cap default **5** (Profile 1–50); digest does not count toward dip cap |
| **Daily Grok briefing** | **✅ Cron on** — `DAILY_WATCHLIST_DIGEST_CRON` default `0 7 * * *` UTC; opt-out via Profile |
| **Production access** | **Pending** — AWS Support asked why not **us-east-2** (Ohio had prior limit increase); **replied 2026-05-23** requesting **us-east-1** (verified domain + live `SMTP_HOST`); await case |
| **DNS** | **Open** — run `npm run email:check-dns`; follow **`docs/DELIVERABILITY_DNS.md`** (DKIM CNAMEs, SPF merge, DMARC) |
| **One-click unsubscribe** | **✅ Shipped** — `List-Unsubscribe-Post` + `POST/GET /api/email/unsubscribe?token=…` |

**Smoke commands (from repo root):**

```bash
npm run email:verify-smtp
pm2 restart keepitbased-api --update-env   # after .env SMTP_* changes

DISABLE_EMAIL_ENGAGEMENT_SUNSET=true \
TEST_USE_SYNTHETIC_BASELINE=true \
TEST_USER_EMAIL=<user@email-in-db> \
npm run email:test-opportunity
```

## Opportunity signal emails — efficiency & timing (plan)

**Goal:** Fewer low-signal emails, better send timing, no duplicate templates per dip, SES-safe volume.

**Architecture today:** Every **1 min**, `PriceMonitor.checkAllPrices` → quotes → `emitWatchlistOpportunitySignals` (requires **`user_alerts` + `baseline_price`**). **`AlertService`** is watchlist CRUD only (no legacy 5/10/15% polling; removed **2026-05-25**). Optional **Grok dip-insight** on opportunity path. Quiet hours + daily caps + RTH morning batch + outbox/digest shipped (Phases 1–6).

| Pain point | Mitigation |
|------------|------------|
| Default email tier `all` → noisy inbox | Code default **`overreaction_only`** for new/unspecified prefs (`notificationPreferences.js`); Profile UI may show broader options |
| ~~Legacy + opportunity double email~~ | **Removed** — legacy threshold loop deleted (`8fb10fbd`) |
| No daily cap on opportunity mail | **`opportunityMaxEmailsPerDay`** (per user, Redis; default **5**; hourly digest batches symbols) |
| No quiet hours | **`timezone` + quiet window** + `opportunityRespectQuietHours` |
| Grok on every fire | Phase 4: tier-gate dip insight (not Phase 1) |
| 1-min single-tick whipsaw | Phase 2: confirmation + RTH morning batch |

### Phase 0 — Metrics (shipped 2026-05-17)

- Structured logs: `opportunity_email_event` with `action` (`suppressed` \| `sent`), `reason`, `userId`, `symbol`, `flags`.
- **Acceptance:** grep PM2 logs / ship to aggregator later.

### Phase 1 — Quick wins (shipped 2026-05-17)

- [x] **`backend/utils/opportunityEmailPolicy.js`** — quiet hours, daily cap, legacy-alert block key, event logger
- [x] **`notificationPreferences.js`** — default email tier `overreaction_only`, `opportunityMaxEmailsPerDay`, quiet-hour fields
- [x] **`priceMonitor.js`** — enforce cap + quiet hours before send; hour-bucket block keys after opportunity send
- [x] ~~**`alertService.js`** legacy skip~~ — legacy path **removed 2026-05-25**
- [x] **`database.js`** default JSON for new users
- [x] **Profile** — quiet hours + max emails/day + baseline copy; persist new pref keys
- [x] **Tests** — `backend/utils/notificationPreferences.test.js`, `opportunityEmailPolicy.test.js` (`node --test utils/*.test.js`)

### Phase 2 — Smarter timing (shipped 2026-05-17)

- [x] Confirmation: 2-of-3 polls (`opportunityEmailConfirmation.js`; capitulation can skip)
- [x] RTH **pending queue** → morning flush at session open (`opportunityEmailPending.js`)
- [x] Stock poll cadence: 1m RTH / `OPPORTUNITY_STOCK_OFFHOURS_POLL_MIN` (default 5) off-hours
- [x] Separate **email-sent** dedupe per hour (`oppmail:sent:*`) so poll 2 can mail after poll 1 toasts

### Phase 3 — Outbox & batching (shipped 2026-05-17)

- [x] `email_outbox` table + `emailOutboxWorker` (cron, retries, instant + digest batches)
- [x] Profile `opportunityEmailDeliveryMode`: instant \| hourly_digest
- [x] `sendOpportunityHourlyDigestEmail` combined template

### Phase 4 — Grok discipline (shipped 2026-05-17)

- [x] Dip insight only for `overreaction` / `capitulation` (`DIP_INSIGHT_REQUIRE_OVERREACTION_TIER`)
- [x] Per-user `dipInsightMaxEmailsPerDay` (default 3, Redis counter)
- [x] Async Grok via `opportunity_dip_insight` outbox (`DIP_INSIGHT_ASYNC_VIA_OUTBOX`, max 2/tick)

### Phase 5 — SES quota protection (shipped 2026-05-17)

- [x] **`backend/utils/emailSendBudget.js`** — global opportunity cap, digest pool, recipient cooldown, SES 454 pause
- [x] Legacy threshold emails off by default; **`deliverMarketingMail`** on opportunity + digest paths
- [x] **Daily Grok watchlist digest** cron on; opt-out Profile pref; separate from dip daily cap
- [x] Default **`opportunityMaxEmailsPerDay`** → **5**; **`GET /api/health/config`** exposes budget counters

### Phase 6 — Deliverability (shipped 2026-05-17)

- [x] **`docs/DELIVERABILITY_DNS.md`** + **`scripts/check-email-dns.sh`** (`npm run email:check-dns`)
- [x] RFC 8058 **`List-Unsubscribe-Post`** + **`/api/email/unsubscribe`**
- [x] SNS subscription auto-confirm on **`/api/webhooks/ses-delivery`** (pre-auth for `SubscriptionConfirmation` only)

**Do not change in Phase 1:** ATR tier math (`watchlistOpportunityEvaluator`), opportunity DB logging, test script behavior beyond new gates.

## Roadmap position (reality check)

- **Phase 0** (charts / regression): **✅ MVP complete** — non-blocking polish only if regressions appear (§2).
- **Phase 1** (LangGraph foundation): **✅ Core complete** — gateway, Opportunity Scout graph, dip-insight path, persistence, golden smoke tests.
- **Now:** **§11 Phase C** (tail) — **`signal_fusion_scorer`** + history vol; **§11 Phase B** — queue worker, EDGAR; **§11 Phase D** — dedupe + async send; **Phase E** briefing card.
- **Also (Quant AGI + dashboard LangGraph, 2026-05-11):** **`/diag/market-universe-rank`** now has **`momentum_liquidity`**, **`photonics_chokepoint`**, and **`rule_breaker_gardner`**; momentum rank still uses **`QUANT_AGI_MOMENTUM_FUNDAMENTALS_WEIGHT`**; **dashboard chat does not yet auto-ingest** any rank snapshot. Planned: inject all three + batched fundamentals + macro card + news + X sentiment into **`buildAgentWatchlistContext`** / agent→Python payloads, optional deterministic fusion before Grok narrative. See § [Quant AGI — unified stock selection for dashboard LangGraph](#quant-agi--unified-stock-selection-for-dashboard-langgraph).
- **Phases 2–5 & §9:** deferred until fusion + observability justify broader tooling and launch gates.

## Resume Here Next Session

### Session save spot (2026-05-25) — continue here next time

**Email / AWS:** Opportunity-only mail path (legacy 5/10/15% loop removed, `8fb10fbd`). **Sandbox:** unverified recipients get **554**; verified test sends OK. **Awaiting** SES **production access in us-east-1** (Support case replied — Ohio vs Virginia). **DNS (Namecheap):** DKIM CNAMEs, SPF `include:amazonses.com`, DMARC — **`docs/DELIVERABILITY_DNS.md`**, **`npm run email:check-dns`**. Then SNS bounce/complaint → **`POST /api/webhooks/ses-delivery`** + **`SES_WEBHOOK_SECRET`**. Post-approval smoke: `TEST_USER_ID=4 npm run email:test-opportunity` (must not 554). Monitor **`/api/health/config`** → `emailSendBudget`.

**Opportunity emails:** Phases 1–6 shipped. Remember app gates: RTH morning batch, tier filters, quiet hours, digest mode — not SES failures.

**Product (next engineering):** Quant **`/diag/market-universe-rank`** (all three strategies) + fundamentals/macro/news/X → **`buildAgentWatchlistContext`** — § [Quant AGI — unified stock selection](#quant-agi--unified-stock-selection-for-dashboard-langgraph).

**Parallel / polish:** TW charts; landing **Open charts** CTA vs login-only `/charts`; Situation room; §9 go-live.

## Deploy list / capital deployment (plan — started 2026-05-25)

**Product:** One **deploy list** per user — symbols authorized for **capital deployment**. The **watchlist** is the wide monitoring universe; the deploy list is a **Grok-curated short list** (ideal dips + how much to deploy), later executed via **brokerage API**. Mechanical opportunity tiers still own **when** a dip fires; Grok + policy own **how much** and **which names** make the deploy list.

**Non-negotiables:** Deploy list ⊆ watchlist (must have `user_alerts` + Main watchlist token). Numbers from tools/quotes/baselines, not model recall. **No live orders** until broker phase. v1 deploy symbols: **US stocks only** (no `TW:*`, no crypto until broker supports).

### Architecture

| Layer | Storage / path | Role |
|-------|----------------|------|
| Watchlist | `user_watchlists` + `user_alerts` | Monitor + baselines + opportunity engine |
| Deploy list | `user_deploy_list_items` → FK `user_alerts.id` | Capital-ready subset |
| Grok optimize | `POST /api/deploy-list/optimize` → LangGraph scan | Rank + size % + limit bands |
| Broker (later) | `executionService` + paper/live flag | Place orders from approved list only |

### Phased delivery

| Phase | Scope | Status |
|-------|--------|--------|
| **DL-1** | DB `user_deploy_list_items`, CRUD API, dashboard checkbox + **Deploy list** panel, `onDeployList` on watchlist context | **✅ Shipped** (`user_deploy_list_items`, `/api/deploy-list`, dashboard) |
| **DL-2** | **Optimize with Grok** — replace list from `topCandidates` + persist rationale / `suggestedLimitBand` / `target_weight_pct` | **✅ Shipped** (`POST /api/deploy-list/optimize` → LangGraph scan) |
| **DL-3** | `DeployPlanV1` schema, user approve/dismiss, audit in `agent_runs` | Planned |
| **DL-4** | Broker paper (Alpaca/IBKR/etc.), `executionService`, Profile kill switch | Planned |
| **DL-5** | Optional auto-deploy on tier + hard caps | Planned |

### DL-1 / DL-2 implementation notes

- **API:** `GET/POST/DELETE /api/deploy-list`, `POST /api/deploy-list/optimize`
- **UI:** Watchlist **Deploy** column; panel below table with total target weight %, **Optimize with Grok**, remove
- **Checkbox UX (2026-05-23):** After `GET /api/deploy-list`, checked state = deploy list IDs only (not stale `onDeployList` on watchlist rows); optimistic toggle; paused rows disabled; `targetWeightPct` omitted when sizing is 0%
- **Optimize prompt:** Scan watchlist (US stocks), rank ideal dips vs baseline, suggest % within Profile max position % cap
- **Fields:** `target_weight_pct`, `source` (`manual` \| `grok_optimize`), `grok_rationale`, `suggested_limit_min/max`, `last_optimized_at`

### Session save spot (2026-05-17) — prior

**Email / AWS:** Code path complete through Phase 6 (budgets, digest, one-click unsub). DNS + production access were open (see **2026-05-25** checkpoint). Taiwan watchlist: English aliases live; **TW charts** still open.

### Session save spot (2026-05-11)

**Git:** `keepitbased` **`main`** pushed to **`origin`** (latest includes Rule Breaker rank + earlier Grok-rank / deploy fixes). Run **`git pull`** on other clones.

**Shipped this arc (2026-05-09 → 05-11):** Quant **`rule_breaker_gardner`** — **`quant_strategies.rule_breaker_gardner_scores`**, **`api_client._rank_rule_breaker_payload`**, terminal **`RankStrategyId`** + **`MarketTape`** leg breakdown UI; LangGraph **`opportunity_nodes.opportunity_scout`** — no enumerate-index score bias, stable sort **`(-score, -confidence, symbol)`**; **`llm_client`** — score authoritative + preserve **`topCandidates`** in scan prose; **`deploy-production.sh`** — PM2 start **`quant-agi-api`** / **`quant-agi-frontend`** if absent; **`StreamBootstrap`** — sort universe rows by score; auth/health/recover routes hardening (earlier commits). Still on **`main`:** fundamentals **`/stock/:symbol/fundamentals`**, photonics + momentum rankers, Financials modal.

**Ops:** **`bash scripts/deploy-production.sh`** (builds main CRA + Quant Next, reloads API, reloads **`quant-agi-api`**, restarts **`quant-agi-frontend`**). LangGraph / Flask changes → **`pm2 restart stock-service`** + **`curl -sf http://127.0.0.1:5001/health`**.

**Next:** Wire **`/diag/market-universe-rank`** for all three strategies + batched fundamentals + macro/news/X into **dashboard LangGraph** / **`buildAgentWatchlistContext`** — checklist in § [Quant AGI — unified stock selection](#quant-agi--unified-stock-selection-for-dashboard-langgraph).

### Quant AGI terminal integration (production)

- Terminal app: `quant_agi/frontend` (Next.js), PM2 **`quant-agi-frontend`** on port **3010**.
- Sidecar API: PM2 **`quant-agi-api`** on port **8844**; Massive access confirmed (`api.massive.com`, key present).
- **nginx** (`config/nginx/sites-available/app.keepitbased-https.conf`):
  - `/quant-agi-terminal/` → `127.0.0.1:3010`; `/_next/` → `127.0.0.1:3010/_next/`
  - **`/quant-sidecar/`** → `127.0.0.1:8844/` — browser must never call `127.0.0.1:8844` directly
- Quant build env: `NEXT_PUBLIC_QUANT_AGI_URL=https://app.keepitbased.com/quant-sidecar` (`quant_agi/frontend/env.production.example`); PM2 apps also in root `ecosystem.config.js`.
- **Landing auth** (`config/nginx/sites-available/keepitbased.com.landing`): `/login` → app subdomain; root `/api` proxies backend (avoids cross-domain login failures).
- **In-app tab** (`frontend/src/pages/QuantAgiPage.tsx`): on `keepitbased.com` / `www`, iframe `src` forced to `https://app.keepitbased.com/quant-agi-terminal/?embed=1` (fixes double navbars); on `app.keepitbased.com`, same-origin `/quant-agi-terminal/?embed=1`. Fail-safe redirect if Quant opens inside wrong iframe shell. No-cache headers on `/quant-agi-terminal/` in nginx.

### Quant AGI — unified stock selection for dashboard LangGraph

**Goal:** Dashboard assistant (LangGraph / Grok) should synthesize “best stock options” using the **same signal stack** as the Quant tape — not heuristic ranks in isolation. Today **`QUANT_AGI_MOMENTUM_FUNDAMENTALS_WEIGHT`** etc. affect **`momentum_liquidity`** only; **`photonics_chokepoint`** and **`rule_breaker_gardner`** have their own composites — **chat does not auto-ingest** rank snapshots.

- [ ] **`agentWatchlistContext` / internal agent payload:** Inject latest **`market-universe-rank`** for **`momentum_liquidity`**, **`photonics_chokepoint`**, **`rule_breaker_gardner`** — include `tape_score_raw` / `strategy_factors`, blended `score`, `valuation_score`, liquidity gate, `why`, `history_source`, **`rule_breaker_gardner` `breakdown`** legs, timestamp.
- [ ] **Fundamentals:** Batch + cache **EV/Revenue, P/S, margins** for watchlist symbols (python-service; avoid N+1).
- [ ] **Macro regime:** Small **macro card** (rates / curve / risk proxy / VIX or FRED); cite source + as-of.
- [ ] **News:** Ticker headlines (Polygon/Massive, OpenBB, research ingest) — bullets + URLs, max age, dedupe.
- [ ] **X / social:** `DIP_INSIGHT_USE_X_SEARCH`, `X_MONITORED_ACCOUNTS_JSON`, digest patterns — with manipulation/sarcasm disclaimers.
- [ ] **Fusion layer:** Optional deterministic **`signal_fusion_scorer`** before LLM narrative.
- [ ] **Safety / product:** Educational, watchlist- and cap-bounded; log tool payloads; never a standalone “model price” as advice.

**Honest limit:** Signals + LLM synthesis, not omniscient AGI; latency, OTC gaps, stale news remain risks.

### Recent session — Profile hub, landing page, notification defaults (2026-05-06, done)

- **`frontend/src/pages/ProfilePage.tsx`:** Single **Notifications** card — channels, **Email me dip alerts**, toast/email **tier** `<select>`s, **quiet hours** + **timezone**, **Grok** / **fusion** / **daily briefing** toggles, **tranche %**; save merges full **`notificationPreferences`** (no dropped keys). Initial/hydration defaults **on** for digest + research toggle + tier **`all`**.
- **Removed `frontend/src/components/AlertDeliveryPreferences.tsx`** — logic inlined into Profile; dashboard **`OpportunityPolicyPanel`** no longer embeds delivery form (link to **`/profile`**).
- **`backend/utils/notificationPreferences.js`:** **`opportunityEmailNotifyLevel`** default **`all`**; **`researchDigestEmail`** + **`dailyWatchlistDigestEmail`** default **on** unless explicit **`false`**; comment cleanup.
- **`backend/models/database.js`:** **`defaultNotificationPrefsJson`** for **`CREATE TABLE`** + **`ALTER … SET DEFAULT`** so new **`users`** rows persist dip + daily-digest prefs explicitly.
- **`frontend/src/pages/HomePage.tsx`:** Landing copy aligned to **AI agent**, deterministic **tiers**, **notifications** / Profile; pillars replace fake stats; **principles** block replaces fake reviews; illustrative demo card only.
- **`frontend/src/types/index.ts`:** Comments for merged defaults.

**Prior session — Watchlist, opportunity mail, dashboard trim, daily briefing (2026-05-05, done)**

- **`frontend/src/utils/watchlistDerived.ts`:** Crypto **`dayChangePct`** prefers **`changePercent`** then **`change24h`**; merge accepts **`sourceUsed`** / **`quoteSourceUsed`**; **`chartQuoteToPriceUpdatePayload`** forwards **`sourceUsed`**.
- **`frontend/src/pages/AIAgentPage.tsx`:** Bid/ask **one-sided** display + **day range** partial high/low; removed **Latest plan**, **Run metadata** panel, **Top opportunities** (+ related state / **`applyCandidateAsAlert`**).
- **`backend/services/agentWatchlistContext.js`:** **`dayChangeAbs`** only for **stocks** (crypto **`change24h`** is %).
- **`backend/utils/notificationPreferences.js` + `priceMonitor.js`:** **`opportunityEmailNotifyLevel`** + toast vs email gates (**superseded** by 2026-05-06 defaults — default tier now **`all`**); **`passesToastOutbound`** vs **`passesEmailOutbound`** unchanged.
- **`frontend/src/components/AlertDeliveryPreferences.tsx`** (later **deleted**): second dropdown + dashboard embed; **`OpportunityPolicyPanel.tsx`** / **`types/index.ts`** tier copy.
- **`backend/services/priceMonitor.js`:** Syntax fix: close **`else if (stockOutsideRth)`** before per-signal **`logger.info`**.
- **`backend/services/dailyWatchlistDigestWorker.js` + `researchArtifactsReader`:** Pass **`researchArtifacts`** + meta to Python; axios **180s**; **`config.DAILY_DIGEST_RESEARCH_LOOKBACK_HOURS`**.
- **`python-service/langgraph_agent/llm_client.py` + `stock_service.py`:** Expanded digest JSON + **`_grok_daily_digest_x_search`**; template accepts ingested artifacts.
- **`backend/services/emailService.js`:** **Daily market briefing** HTML sections (macro, tape, watchlist, headlines, X, two ideas).
- **§11 / signals / dip path:** DB + services + UI files as in working tree (`opportunity_signals`, dip insight email, golden script, etc.).

**Ops reminder:** `npm run deploy` does not restart **`stock-service`** — run **`pm2 restart stock-service`** after Python changes for daily briefing / dip-insight.

### Recent session — Crypto dashboard parity with stocks (done)

- **`frontend/src/pages/CryptoPage.tsx`:** Same **`app-shell`** / header band / control strip as **`ChartPage`** (connection, Volume/Indicators, data source label, quote status, cadence **updates every 10s**, stale timer, Refresh). Main column **`lg:[grid-template-columns:minmax(0,3fr)_minmax(320px,1fr)]`**, feed-status bar above chart, period **presets** (1D–All mapped to Kraken interval + time range; YTD uses **6M** window — API has no true YTD). Sidebar: quote card (stock-like styling), crosshair panel (crosshair time handles **ms vs s**), **Pair info**, **Indicators** block when toggled on.
- **`frontend/src/components/charts/cryptoChartTechnical.ts`:** Shared SMA/EMA/RSI/MACD math; MACD signal uses **EMA on numeric MACD line** (fixes bad `.close` on numbers). **`summarizeCryptoIndicators`** for last bar.
- **`frontend/src/components/charts/CryptoChart.tsx`:** Uses shared technical series; optional **`onIndicatorSummary`** callback for sidebar. Removed dead duplicate indicator block; wiring uses **`useMemo` + `computeCryptoTechnicalSeries`**.
- **URL:** Pair selection calls **`setSearchParams({ pair })`** (with existing `?symbol=` → `X:SYMUSD` parsing).
- **Data loading:** OHLC cache in **`useRef`** (avoids unstable `loadCryptoData` deps). No success toast on every load (closer to stocks).
- **Not in this pass:** Deeper `SimpleChart` vs `CryptoChart` feature parity (e.g. full `TradingViewTimeline` wire-up if desired); true **YTD** range if backend adds it.

### Recent session — Agent chat UX + auth (2026-05-04, done)

- **Python:** `intent_router` → **`educational_qa`** (`qa_advisor`) vs scan; **`compose_scan_reply`** after **`opportunity_scout`**; **`LlmClient`** `answer_educational_qa`, `compose_scan_user_reply`, `_markdown_chat`; **`stock_service`** passes `assistantIntent` / `conversationHistory`.
- **Node:** `agent.js` proxy timeout from **`config.AGENT_PYTHON_TIMEOUT_MS`**; chat body sanitization; **`runMetadata`** merge.
- **Frontend:** **`AIAgentPage`** mode tabs, backup banner, progressive reveal; **`aiAgentService`** `ChatWithAgentOptions`.
- **Auth:** **`auth.js`** register username + dual invite; **`users.js`** profile username + signup-passcode routes; **`emailService`** recovery; **`RegisterPage`** / **`ProfilePage`** / **`AuthContext`** / **`authService`** / **`types`**.

### Last deploy (pick up here)

- **2026-05-05:** If **`/api/health`** fails after reload, check **`pm2 logs keepitbased-api`** — a prior **`priceMonitor.js`** brace bug caused **SyntaxError** until fixed.
- **Git workflow:** When `main` is protected, use **`git checkout -b feature/…` → push branch → open PR on GitHub → merge** instead of relying on push bypass. Full checklist: § [Pull requests — doing it correctly](#pull-requests--doing-it-correctly).
- **Frontend + Node:** `npm run deploy` or `bash scripts/deploy-production.sh` — builds **`frontend/build`**, **`pm2 reload keepitbased-api`**, checks **`http://127.0.0.1:3001/api/health`**. Production chat needs **`REACT_APP_SUPABASE_URL`** + **`REACT_APP_SUPABASE_ANON_KEY`** in **`frontend/.env.production`** before build (script prints a reminder).
- **OpenBB sidecar:** `pm2 start ecosystem.openbb.config.js` (loads **`backend/.env`** into **`openbb-platform`** for **`POLYGON_API_KEY`** / **`MASSIVE_*`** merge into **`~/.openbb_platform/.env`**). Probe **`http://127.0.0.1:6900/docs`**. **`OPENBB_*`** toggle in **`backend/.env`**; **`GET /api/health/config`** → **`config.OPENBB_ENABLED`**, **`OPENBB_STOCK_HISTORY_EXCLUSIVE`**, etc.
- **Python / LangGraph:** deploy script does **not** restart **`stock-service`** — after backend/agent changes run **`pm2 restart stock-service`** (and verify **`http://127.0.0.1:5001/health`** — `opportunityGraphReady`, etc.).
- **Persist PM2:** `pm2 save` after successful reloads (include **`openbb-platform`** whenever OpenBB should survive reboot **`pm2 resurrect`**).

### Where things stand

- **Charts:** **`/charts`** — stock dashboard (`ChartPage`); **`/crypto`** — crypto dashboard (when **`OPENBB_ENABLED`**: OpenBB **`yfinance`** OHLC/ticker **first**, else **Polygon → Binance → CoinGecko**). **UX-aligned** with stocks (see **Recent session — Crypto dashboard** above). Watchlist deep links use **`/charts?symbol=…`** vs **`/crypto?symbol=…`** / **`?pair=…`**.
- **Dashboard:** `/dashboard` — assistant **modes** + chat + **watchlist table**. **`/api/agent/chat`** → Python **`POST /agent/opportunities`** with **`watchlistContext`**, **`assistantIntent`**, **`conversationHistory`**. **Planned:** **`Situation room`** (see **§ Situation room / global monitor**).
- **Auth / Profile:** **`/register`** — **`username`** + invite **or** personal passcode (8+); **`/profile`** — username + **Invite friends** passcode (`GET`/`PUT /api/users/profile/signup-passcode`); admin global invite unchanged (`/profile/signup-invite-admin`).
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

## Production ops (smoke & recovery)

**Last verified healthy: 2026-05-25** — `keepitbased.com` + `app.keepitbased.com` `/api/health` **200**; **`npm run email:verify-smtp`** **OK** (us-east-1); opportunity test to verified Gmail **OK**; unverified recipient **554** (sandbox); legacy alert log spam **gone** after `8fb10fbd`; DNS DMARC/SES-SPF still open.

**Historical incident (2026-05-08):** App returned **403/502** when `frontend/build` missing/unreadable, PM2 down, or nginx perms blocked `www-data`. Use this runbook if it recurs:

1. `cd /home/dstrad/keepitbased && npm run build` — restores `frontend/build/index.html`
2. `pm2 status` — **`keepitbased-api`**, **`quant-agi-api`**, **`quant-agi-frontend`** online
3. If **403:** `namei -l /home/dstrad/keepitbased/frontend/build/index.html` — fix traverse/read for `www-data`
4. `sudo nginx -t && sudo systemctl reload nginx`
5. Re-smoke:
   - `curl -sSI https://app.keepitbased.com/` → 200
   - `curl -sSI https://app.keepitbased.com/api/health` → 200
   - `curl -sS https://app.keepitbased.com/quant-sidecar/health` → JSON `{"ok":true,...}` (not HTML)
   - `curl -sSI https://app.keepitbased.com/quant-agi-terminal/` → 200; body contains `Autoresearch and execution cockpit`
   - Browser: one navbar on `https://app.keepitbased.com/quant-agi` with terminal in iframe
6. **Email:** `npm run email:verify-smtp` → OK; optional test send (see § Email / SES — Current status)

**SES 535 / auth failures:** `SMTP_HOST` region must match where SMTP credentials were created (`email-smtp.us-east-1.amazonaws.com` vs `…us-east-2…`).

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

### §3.1 Dashboard AI chat — improvement backlog + TradingAgents (future)

**Context:** `/api/agent/chat` → Python **`POST /agent/opportunities`**: watchlist scan **or** **`educational_qa`**, plus post-scan **`compose_scan_reply`**. Node **`ENABLE_LANGGRAPH_AGENT`**, configurable **`AGENT_PYTHON_TIMEOUT_MS`** (default 120s), and local-template fallback still shape behavior when Python is down.

#### Improvement checklist (dashboard agent / Grok-quality)

- [x] **Product clarity:** UI modes **Scan & rank** / **Ask a question** / **Smart** (`AIAgentPage`).
- [x] **Intent routing:** **`assistantIntent`** + Smart heuristics → **`educational_qa`** vs **`opportunity_scan`** (`intent_router` / graph edges).
- [x] **Compose-reply node:** **`compose_scan_reply`** + **`LlmClient.compose_scan_user_reply`** after **`opportunity_scout`**.
- [x] **Timeouts & transparency:** **`AGENT_PYTHON_TIMEOUT_MS`** + UI when **`fallbackUsed`**.
- [x] **Multi-turn memory:** **`conversationHistory`** (last turns) into QA + compose prompts.
- [ ] **Streaming:** True SSE/token stream from Grok (current UI: **progressive reveal** after full response only).
- [ ] **Parallelism / batching:** Reduce wall time for multi-symbol LLM work (bounded concurrency or one batched Grok call for blurbs).
- [ ] **Model tuning:** Expose or document per-task temperature / model tier (prose vs JSON extraction) via env (`LLM_*`).

#### [TradingAgents](https://github.com/tauricresearch/tradingagents) — how it differs + how we could use it later

Upstream project (**Apache-2.0**): **multi-agent** LangGraph-style framework modeled on a trading desk — **Fundamentals / Sentiment / News / Technical** analysts → **bullish vs bearish researcher debate** → **Trader** → **Risk** → **Portfolio Manager** approve/reject → **simulated exchange**. API shape: `TradingAgentsGraph().propagate(ticker, analysis_date)` with config for **LLM provider** (OpenAI, Google, Anthropic, **xAI Grok**, DeepSeek, Qwen, GLM, OpenRouter, Ollama, Azure), **debate rounds**, **deep vs quick** models. Ships **CLI**, **Docker**, **checkpoint resume** (LangGraph), and a **persistent decision log** (`~/.tradingagents/memory/…`) with **reflection** on next run (realized return vs SPY, inject into PM prompt).

| Dimension | KeepItBased (today) | TradingAgents (upstream) |
|-----------|---------------------|---------------------------|
| **Primary job** | User-scoped **watchlist** scan, dip context, **educational** alerts + emails; deterministic triggers | Per-ticker **research simulation** toward a **trade decision** in a sandbox narrative |
| **Agent shape** | One **linear** opportunity graph + separate **`/agent/dip-insight`** | Many **specialized roles** + **debate** + approval chain |
| **Inputs** | Node **`watchlistContext`**, internal alerts, charts/news **we already ingest** | CLI/config-driven ticker + date; external feeds (e.g. **Alpha Vantage** in their README) — would need mapping to our Polygon/OpenBB stack |
| **Outputs** | `AgentOutputV1` + `reply` + optional alert apply | Structured **decision** object + simulated execution story |
| **Persistence** | `agent_runs` / `agent_messages`, email audit | File-based memory + optional SQLite checkpoints |

**Integration ideas (when we pick this up):** Treat TradingAgents as an **optional depth layer**, not a replacement for our **policy-grounded** watchlist scan — e.g. **(1)** HTTP or subprocess **sidecar** / Python venv: “deep dive” on **one symbol** from dashboard → `propagate(SYMBOL, date)` → stream or paste summary back into our reply; **(2)** **borrow patterns** only (debate node, structured-output agents, checkpointing) inside our `python-service` LangGraph; **(3)** align **Grok** config with theirs (`xai` provider) but keep **our** tools as source of truth for quotes/alerts. **Caveats:** upstream is **research / non-advice** framing; **cost and latency** are much higher than our current scan; **no drop-in** for multi-symbol watchlist ranking without custom nodes or post-processing. **License:** Apache-2.0 is compatible with careful dependency hygiene (contrast **AGPL** notes elsewhere in this doc for OpenBB).

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

## 11) Quant AGI Terminal - Session Handoff (2026-05-07)

Completed this session:

1. Added J.A.R.V.I.S.-style Grok coding chat panel above code updates.
2. Added `POST /v1/coding-chat` integration and production-safe Quant base URL resolution.
3. Replaced market tape with Quant AGI stock suggestions and watchlist add action.
4. Added broad-universe rank endpoint: `GET /diag/market-universe-rank`.
5. Added Day 1-2 controls:
   - liquidity gates (`min_price`, `min_avg_dollar_vol_20d`)
   - accepted/excluded stats + exclusion reasons
   - canonical scorecard endpoint: `GET /diag/scorecard`
6. Updated terminal UI with:
   - gate metadata
   - ADV20 display
   - scorecard panel in metrics

Next steps for next session:

1. Add UI controls (sliders/inputs) for `min_price` and `min_avg_dollar_vol_20d` and persist to URL/local storage.
2. Expand universe from static 60 symbols to dynamic liquid-universe ingestion (with sector labels).
3. Add transaction-cost proxy into rank score (spread/slippage estimate) and expose in `why`.
4. Add position sizing fields (`target_weight`, `risk_budget`, `max_loss`) to rank payload.
5. Add regression tests:
   - rank endpoint schema + gate behavior
   - scorecard endpoint window/cache behavior
6. Add operational alert if gate excludes >80% of universe for sustained windows.

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
- **Verify SMTP (no send):** `npm run email:verify-smtp` from repo root.
- **Test opportunity email (plain HTML, same template as PriceMonitor):** `npm run email:test-opportunity` — requires a **`users.email`** match (`TEST_USER_EMAIL`) or **`TEST_USER_ID`**; optional **`TEST_USE_SYNTHETIC_BASELINE=true`** if no alert baseline. Use **`DISABLE_EMAIL_ENGAGEMENT_SUNSET=true`** for inactive accounts. Subject prefix **`[TEST]`**. Sandbox: recipient must be verified in SES.

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

---

## Appendix — project review, backlog & references

*Formerly split across `docs/PROJECT_REVIEW_TODO.md` and `/home/dstrad/todo.md`. Kept here so **`todo.md` is the only roadmap.*

### Stack overview

- **Backend:** Node.js/Express, PostgreSQL
- **Frontend:** React/TypeScript, TradingView-style charts
- **Python:** Flask (`stock-service`), LangGraph agent paths
- **Real-time:** Socket.IO price/opportunity updates
- **Security:** JWT, rate limits, audit logging, nginx TLS

### AI Stock Buy-Alert Agent (parallel track)

**Full plan:** [docs/AI_BUY_ALERT_AGENT_PLAN.md](docs/AI_BUY_ALERT_AGENT_PLAN.md)

- **Phase 0:** rules + indicators, fixed universe, scheduled job, no LLM first.
- **Phase 1+:** optional LLM explainer on fixed JSON; ML after labels/backtests.
- **Multi-agent (reserved):** research agents → planner → execution only behind policy (human approval / paper / kill switch / audit).

**Checklist:**

- [ ] Confirm MVP: universe size, timeframe, max alerts/day, delivery channel
- [x] Phase 0 scaffold: LangGraph schema + graph + API + CLI (`GET /agent/buy-alert/<symbol>`)
- [ ] Phase 0 remaining: Postgres persistence + scheduled job + alert/email wiring
- [ ] Outcome labels + backtest harness
- [ ] Optional LLM explainer (structured input only)
- [ ] Multi-agent message contract sketch
- [ ] If execution: paper mode, approvals, vault, audit, risk veto agent

### Pull requests — doing it correctly

When **`main`** is protected: **`git checkout -b feature/…`** → commit → **`git push -u origin feature/…`** → GitHub PR → merge → **`git checkout main && git pull`**. Self-review OK for solo. Admin bypass: still prefer small commits; adjust branch protection only if PRs are impractical.

### Shipped features (reference log)

**Security:** parameterized SQL, bcrypt JWT, rate limits, CSP/HSTS, credential rotation script, HTTPS.

**Charts:** crypto Kraken + stock Polygon/OpenBB paths; lightweight-charts; indicators SMA/EMA/RSI/MACD; `npm run test:charts`.

**Agent:** `/api/agent/chat`, Opportunity Scout graph, dip-insight emails, `agent_runs` persistence, golden scripts.

**Supabase chat:** migration `20260203120000_global_chat.sql`, `FloatingChatDock`, `REACT_APP_SUPABASE_*` in production build.

**Watchlist:** 52-week column hardening (`oppTech:v4`), dashboard first-load spinner in card only.

**Repo:** `main` default, `.gitignore` for env/venv, branch protection, `frontend/env.production.example`.

### Current ops issues (non-blocking)

- Fresh clone: `npm install` (root, backend, frontend) + Python venvs not in git
- Local secrets: copy `backend/.env.example` → `backend/.env` only on server
- Port **3001** `EADDRINUSE`: `pm2 stop all`, check `lsof -i :3001`, single API instance
- DB: verify PostgreSQL up, schema current (dev may use fallback creds)

### Architecture review (summary)

| Area | Strengths | Improve |
|------|-----------|---------|
| Backend | Security middleware, modular services, env config | Schema validation, tests |
| Frontend | TS, charts, sockets, responsive | Error boundaries, more loading patterns |
| Python | Flask, Redis cache, indicators | Rate limits, validation, tests |

### Priority backlog (generic — execution order is § Resume Here)

**Critical:** post-clone install + `.env`; `pm2` / `/api/health`; DB migrations.

**High:** PM2 health across services; React error boundaries; test coverage.

**Medium:** DB/query perf; Redis API cache; bundle size; APM/logs.

**Low:** portfolio tracking; mobile app; horizontal scale; CDN.

**Parallel:** §11 research phases; Situation room; Quant rank → LangGraph fusion (§ unified selection).

### Development commands (extended)

```bash
# Once per machine
cd keepitbased && npm run install:all
cp backend/.env.example backend/.env
cp frontend/env.production.example frontend/.env.production   # before prod build

# Dev
npm run dev | npm run dev:backend | npm run dev:frontend | npm run pm2:start

# Prod
npm run deploy          # or bash scripts/deploy-production.sh
pm2 restart stock-service   # after Python/LangGraph changes (not in deploy script)
cd backend && node scripts/rotateApiKeys.js
npm run email:verify-smtp
npm run email:test-opportunity   # TEST_USER_EMAIL must exist in users table
npm run golden:dip-insight | npm run golden:opportunity | npm run test:charts
```

### Documentation index

| Doc | Purpose |
|-----|---------|
| [README.md](README.md) | Project overview |
| [docs/README.md](docs/README.md) | Guides TOC |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deploy procedures |
| [docs/RESEARCH_AGENT.md](docs/RESEARCH_AGENT.md) | Research / dip-insight env |
| [docs/AI_BUY_ALERT_AGENT_PLAN.md](docs/AI_BUY_ALERT_AGENT_PLAN.md) | Buy-alert multi-agent plan |
| [docs/LANGGRAPH_SETUP.md](docs/LANGGRAPH_SETUP.md) | LangGraph quickstart |
| [SECURITY.md](SECURITY.md) | Security guide |

**Missing / wanted:** OpenAPI specs, Storybook, DB schema doc, troubleshooting one-pager.

### Status snapshot (2026-05-25)

| Area | Status |
|------|--------|
| Security | 🟢 Production-ready |
| Charts / watchlist | 🟢 MVP complete |
| LangGraph agent + dip email | 🟢 Core shipped (opportunity path only; legacy % alerts **removed**) |
| AWS SES SMTP | 🟡 Auth OK; **sandbox** (554 unverified); **us-east-1** production case pending; DNS open |
| §11 research fusion | 🟡 MVP; queue/EDGAR open |
| Quant → dashboard context | 🟠 **Next** (parallel to deploy list DL-3+) |
| Deploy list / Grok sizing | **✅ DL-1/DL-2** — broker + `DeployPlanV1` next (DL-3) |
| §9 go-live gates | Open |

*Consolidated 2026-05-17; refreshed 2026-05-25. Prior split files redirect here.*
