# §11 Phase A — Scope, policy, and data contracts

**Status:** baseline for multi-source research + dip-triggered alerts.  
**Execution order (from implementation plan):** A → B (X/news) → D (wire to dip path) → C (LangGraph) → E → F.

## 1) Problem statement and ICP

**Primary ICP (v1):** watchlist-driven **long-horizon accumulators** who want **structured, tool-backed context** when a name they track is both **mechanically “on sale” vs their baseline** and there is **fresh public information** (headlines, filings, X cashtag flow) to justify *reviewing* a tranche plan — not a buy recommendation from the model alone.

**Non-goals for v1:** sub-minute trading signals, auto-execution, or “the model’s price target.”

**Frequency guardrails (product):**

- Default **max research+dip emails per user per day:** 5 (configurable in `notification_preferences.researchMaxEmailsPerDay`).
- **Per symbol:** avoid more than 1 **fused** (dip + research) email per **4h** bucket unless severity override (defined in Phase D dedupe).
- **Quiet hours:** user-local window (e.g. 22:00–07:00) where we **queue or skip** non-critical sends; See `notification_preferences` keys.

## 2) Legal / compliance (lightweight)

- **Disclaimer:** all email and in-app copy must include that content is **educational, not investment advice** (already partial in opportunity email footer; research digests will repeat + link to terms).
- **SEC EDGAR:** public filings; store **metadata + short excerpts** with **retention TTL**; full 10-K HTML in object storage when §9 object storage is in place. Do not redistribute full licensed wire text without provider terms.
- **News:** prefer **headline + link + timestamp**; full-body storage only when license allows. Attribute source name in `citations`.
- **X / social:** respect API terms; store tweet IDs and **hashes** for dedupe; no training on DMs.
- **Logs:** redact tokens; do not log full user email bodies in production debug.

## 3) `DeepAlertOutput` v1

Canonical TypeScript-style shape is implemented in `backend/schemas/deepAlertOutputV1.js` with `schemaVersion: 1`.

**Rule:** any **number** shown to a user (price, %, tranche %, “severity”) must include **provenance** (`sourceRef` / `toolId` / `computedAt` / `inputHash`) so we never rely on model recall for prices.

## 4) Correlation rules (v1)

Before LangGraph “fusion” is live, the **orchestrator** uses deterministic gates:

1. **Dip gate:** at least one flag from `evaluateWatchlistOpportunity` (e.g. `on_sale` or `overreaction`) for the same user+symbol as the watchlist alert row.
2. **Research gate (MVP):** at least one **normalized** `research_artifact` in the lookback window (e.g. 24h) for that symbol, with `minSeverity` for news/X (configurable in Phase B).
3. **Fusion send:** (1) AND (2) AND user has `researchDigestEmail: true` AND not in quiet hours AND under daily cap.

**Dip-only** emails continue to use the existing `sendOpportunitySignalEmail` path (no research payload). **Fused** emails use a new template that embeds `DeepAlertOutput` (Phase D).

## 5) Next steps (Phase B)

- `research_artifacts` table + ingestion jobs (X first via `xInvestorFeedService`, then news).
- Optional worker queue (pg-boss / bullmq) so `PriceMonitor` stays thin.
