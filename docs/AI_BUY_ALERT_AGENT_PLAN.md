# AI Stock Buy-Alert Agent — Plan & Roadmap

This document captures the agreed direction for an **AI-assisted stock buy-alert** capability inside KeepItBased, with **room for a multi-agent system** that can later support **research → plan → execution** flows under strict governance.

Alerts are **decision support**, not guaranteed outcomes. Any live trading must be optional, audited, and bounded by human policy.

---

## 1. Product definition (one line)

Turn **market + context data** into **actionable, explainable** “consider buying” notifications—with **guardrails**—not an un-audited autopilot.

---

## 2. MVP scope

| Area | MVP | Later |
|------|-----|--------|
| Universe | 10–30 liquid symbols | Full screener |
| Signal | Rules + indicators; optional LLM **explainer** only on structured JSON | ML / richer models |
| Cadence | 1–4 runs/day (+ optional intraday) | Higher frequency |
| Output | Email / in-app alert: symbol, horizon, zone, rationale, confidence, **invalidation** | Chat UI, portfolio-aware sizing |
| Validation | Backtest + paper log of signals | Live A/B, calibration |

Lock **universe**, **timeframe** (swing vs intraday), and **max alerts/day** before tuning models.

---

## 3. Fit with KeepItBased architecture

Existing pieces: **Node/Express**, **PostgreSQL**, **Redis**, **Python + yfinance**, **alerts/email**, **Socket.IO**.

### Recommended layout

1. **Signal engine (Python)**  
   OHLC + indicators + regime/volume filters → structured payload, e.g.  
   `{ symbol, action, horizon, entry_zone, stop_hint, reasons[], confidence, expires_at }`.

2. **Orchestrator / “AI layer”**  
   - **A — Rules + LLM explainer (recommended first):** deterministic score; LLM only narrates fixed fields.  
   - **B — ML classifier:** trained on labels you define (e.g. “favorable outcome within N sessions”).  
   - **C — LLM-heavy:** only with **tool-use** (no free-form web unless grounded).

3. **Integration**  
   - Scheduled job (cron, queue worker, or PM2 cron) calling Python or internal API.  
   - Persist signals + outcomes in Postgres for debugging and quality loops.  
   - Reuse existing **email / alert** paths for delivery.

4. **Observability**  
   - Log every signal with input fingerprint; simple admin or query for “last N signals”.

---

## 4. Labels and “ground truth”

Define **labels** before chasing “AI accuracy,” e.g.:

- “Good alert” = price touched suggested zone within *X* sessions **and** did not hit stop within *Y* sessions.

Backtest the **same rules** the live agent uses. Without labels, tuning is subjective.

---

## 5. Guardrails (non-negotiable)

- **Kill switch:** max alerts/day, cooldown per symbol, no flip-flop spam.  
- **Invalidation:** every alert includes “this thesis fails if …”.  
- **Confidence:** tied to measured stats where possible, not model bravado.  
- **Copy / compliance:** user-facing text that alerts are **not** investment advice.

---

## 6. Phased roadmap

| Phase | Focus |
|-------|--------|
| **0** | Paper: fixed universe, daily job, rules-only, DB log, email to operator. No LLM. |
| **1** | Optional LLM explainer on top of fixed JSON only. |
| **2** | Quality loop: precision/recall on labels; threshold tuning. |
| **3** | Portfolio-aware hints (needs positions / risk prefs). |

---

## 7. Multi-agent architecture (reserved design)

Design for **multiple specialized agents** communicating over a **clear contract** (messages + schemas), not one monolith script.

### Agent roles (conceptual)

| Agent type | Responsibility | Trust level |
|------------|----------------|-------------|
| **Data / market agent** | Clean OHLC, corporate actions, liquidity filters | Read-only market data |
| **Research agent(s)** | Fundamentals-lite, news/sentiment (if added), thematic notes | Read + summarize; cite sources |
| **Signal / quant agent** | Rules, features, scores, zones | Deterministic or trained; versioned |
| **Risk / compliance agent** | Max size, concentration, blackout windows, “allowed instruments” | **Veto** power on plans |
| **Planner agent** | Builds **order plan**: slices, limits, time-in-force, abort conditions | No keys by default |
| **Execution agent** | Submits orders **only** when explicitly enabled + policy passes | **Highest** scrutiny; audit every action |

### Principles

1. **Separation of duties:** research and execution are different trust boundaries; execution never “infers” intent from chat.  
2. **Human-in-the-loop (default):** execution requires explicit approval or **paper** mode until proven.  
3. **Versioned policies:** risk limits and allowed brokers live in config/DB, not in prompt text.  
4. **Audit trail:** immutable log of proposals → approvals → orders → fills.  
5. **Transport:** start with HTTP + DB queue table or Redis list; evolve to a job runner if needed.

### Execution / “buy for me” (future)

- Start with **paper broker** or **read-only** broker verification.  
- Real money: broker API keys in vault, IP allowlist, 2FA on approvals, per-order caps, daily loss cap, **instant global halt**.  
- Legal/compliance: user responsibility; product copy and jurisdiction are product-owner decisions.

---

## 8. Open decisions (fill in before build)

1. Time horizon: swing vs day-trade?  
2. Universe: manual list vs screener?  
3. AI style: rules + explainer vs ML vs hybrid?  
4. Delivery: email only vs in-app + push?  
5. Data budget: yfinance-only vs paid feeds?

---

## 9. Tracker

Project-level tasks for this initiative should stay in **[docs/PROJECT_REVIEW_TODO.md](./PROJECT_REVIEW_TODO.md)** (section *AI Stock Buy-Alert Agent*) or the root [todo.md](../todo.md) roadmap so coding sessions start from one place.
