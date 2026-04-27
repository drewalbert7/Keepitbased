# KeepItBased Professional Implementation Plan

Last updated: 2026-04-27 (LangGraph + Grok checkpoint saved)

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
- Redis caching added for `/charts/history` and `/charts/quote` with source/interval TTL strategy.
- Regression suite added:
  - `backend/scripts/chartRegressionCheck.js`
  - `npm run test:charts`
- Stock dashboard upgraded:
  - source + freshness status
  - stale data messaging
  - cleaner layout and controls
- Chart engine replaced with `lightweight-charts` for stocks.
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

### Phase 0 - Hardening Before Agent Backend (Now)

1. Finish chart jitter hardening and verify smoothness.
2. Add chart QA checklist and signoff criteria.
3. Keep regression suite green.

Definition of done:
- No visible top-bar jitter/flicker in normal polling.
- `npm run test:charts` passes consistently.

### Phase 1 - Backend Agent Skeleton (LangGraph foundation)

1. Create/extend Python service for LangGraph workflow.
2. Keep `/agent/chat` and `/agent/apply` as the backend gateway contract.
3. Define graph state schema:
   - user context
   - conversation history
   - proposed actions
   - policy decisions
   - ranked opportunities
4. Add initial nodes:
   - `intent_router`
   - `context_loader`
   - `opportunity_scout`
   - `planner`
   - `policy_guardrail`
   - `response_formatter`

Definition of done:
- Agent returns structured plan payloads from real LLM-backed graph.
- No direct action execution without policy pass.

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

## 7) Immediate Next Task Queue

1. Lock AgentOutputV1 schema contract (`schemaVersion`, `topCandidates`, `score`, `whyNow`, `riskFlags`, `confidence`, `suggestedLimitBand`).
2. Expose user-adjustable agent parameters in dashboard (`topN`, confidence floor, max position size, watchlist-only, scoring weights).
3. Implement LangGraph service scaffold for Agent 1 (Opportunity Scout) with typed state.
4. Add scoring pipeline (momentum + trend + liquidity + event risk flags) and top-N ranking output.
5. Add watchlist opportunity detector + notification trigger logic ("on sale" + overreaction conditions).
6. Add suggested limit-order range generator (entry band, invalidation note, risk hint).
7. Proxy `/api/agent/chat` from Node backend to LangGraph service while keeping `/api/agent/apply` policy-gated.
8. Persist agent runs/messages/notifications for audit and replay.
9. Add golden prompt tests for ranking quality, notification quality, and policy safety.

## 10) Next Session Kickoff Checklist

1. Verify `/api/agent/chat` and `/agent/opportunities` return `providerUsed=grok` on startup.
2. Begin persistence layer for agent runs (run table + message table + retention policy).
3. Add watchlist-opportunity trigger evaluator (sale conditions + overreaction flags).
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
