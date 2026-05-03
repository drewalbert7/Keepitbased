# Research agent & Grok dip briefing

Operational reference for the **in-app AI agent** (dashboard chat / opportunity scan) and **dip briefing emails** (deterministic dip → Grok narrative + optional X via xAI `x_search`).  

**Disclaimer:** All AI output is **educational, not investment advice.** Prices and % vs baseline in emails come from **your app’s quotes and alert baselines**, not from model recall.

---

## Architecture (what talks to what)

| Surface | Entry | Backend | Python |
|--------|--------|---------|--------|
| Dashboard agent | `POST /api/agent/chat` → proxies | — | `POST /agent/opportunities` (LangGraph) |
| Ingested headlines in chat | LangGraph `research_context_loader` → `opportunity_scout` | `GET /api/internal/research/artifacts` (watchlist-scoped) | Reply digest + **scoring/LLM**: headline count / keyword hint adjusts event-risk and Grok `summarize_candidate` receives title snippets |
| Dip briefing email | `PriceMonitor` → opportunity signal | `dipInsightEmailService` + optional fusion gate | `POST /agent/dip-insight` |

Both Python paths use **`LLM_PROVIDER=grok`** and **`GROK_API_KEY`** / **`XAI_API_KEY`** when Grok is enabled.

---

## Environment variables

### Node (`backend/.env` or process env)

| Variable | Purpose |
|----------|---------|
| **`PYTHON_SERVICE_URL`** | Base URL for Flask agent (default `http://127.0.0.1:5001`). Must match where `stock_service.py` listens. |
| **`ENABLE_DIP_INSIGHT_EMAIL`** | Set to `true` to allow Grok dip briefing emails **globally**. If unset/false, users only get the short **opportunity** email when email alerts are on. |
| **`DISABLE_DIP_INSIGHT_EMAIL`** | Emergency kill switch: set to `true` to **block** Grok dip briefing sends even if `ENABLE_DIP_INSIGHT_EMAIL=true` (plain opportunity email still sends when appropriate). |
| **`SMTP_*`** | Required for any email path (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`). **AWS SES:** `SMTP_USER` is the **SMTP username** (often `AKIA…`); set **`SMTP_FROM=noreply@yourdomain.com`** for the visible sender on your **verified domain**. |

### Python (`python-service/.env`)

| Variable | Purpose |
|----------|---------|
| **`NODE_BACKEND_URL`** | Same host as Node API (default `http://127.0.0.1:3001`). Required for **`AGENT_INTERNAL_SECRET`** calls (`alerts`, **`/api/internal/research/artifacts`**). |
| **`AGENT_INTERNAL_SECRET`** | Must match Node — enables **`fetch_research_artifacts`** + alert sync from LangGraph. |
| **`RESEARCH_CONTEXT_LOOKBACK_HOURS`** | Optional (default `24`). Hours of **`research_artifacts`** pulled into opportunity-scan replies. |
| **`RESEARCH_CONTEXT_ARTIFACT_LIMIT`** | Optional (default `50`). Max rows returned per scan. |
| **`LLM_PROVIDER`** | Use `grok` for Grok-backed paths. |
| **`LLM_MODEL`** | Grok model id (e.g. `grok-4.20-reasoning`). For **`x_search`** on the Responses API, prefer a model **documented for agentic tools** (xAI examples often use **`grok-4.3`**). If dip-insight fails with 4xx on `/responses` + tools, try an updated tool-capable model. |
| **`GROK_API_KEY`** or **`XAI_API_KEY`** | xAI API key. |
| **`GROK_BASE_URL`** | Default `https://api.x.ai/v1`. |
| **`DIP_INSIGHT_USE_X_SEARCH`** | Default `true`. Dip insight uses **Responses API + `x_search`** (no separate X/Twitter Developer API). Set `false` to skip native X search (falls back to template or snippet path if snippets were passed; Node currently sends empty snippets). |
| **`PORT`** | Flask port (often `5001`). |

### User preferences (`users.notification_preferences` JSON)

Merged server-side with defaults in `backend/utils/notificationPreferences.js`.

| Key | Role |
|-----|------|
| **`dipInsightEmail`** | User opts in to **Grok dip briefing** vs plain opportunity email (only when global flags allow). |
| **`agentMaxPositionSizePct`** | **1–50**, caps **suggested tranche %** line in the briefing email. |
| **`researchDigestEmail`** | When on with **`dipInsightEmail`**, Grok dip email requires **≥1** `research_artifact` in lookback (`RESEARCH_FUSION_LOOKBACK_HOURS`); otherwise plain opportunity email. |

Profile UI: **`/profile`** exposes **`dipInsightEmail`**, **`researchDigestEmail`**, and **`agentMaxPositionSizePct`**.

---

## Timeouts & reliability

- Node **`dipInsightEmailService`** calls Python with **~95s** timeout (agentic `x_search` can be slow).
- If **`/agent/dip-insight`** fails or times out, **`PriceMonitor`** falls back to **`sendOpportunitySignalEmail`** (short HTML) so the user still gets a deterministic signal.

---

## Audit trail

Successful or attempted Grok dip generations can be persisted as **`agent_runs`** with **`source = dip_insight`** (see `persistDipInsightEmailRun`). Inspect `output` JSON for insight payload and citation metadata.

---

## Kill switches & rollout

1. **Disable globally:** unset or set `ENABLE_DIP_INSIGHT_EMAIL=false`.
2. **Emergency off without redeploying intent:** `DISABLE_DIP_INSIGHT_EMAIL=true`.
3. **Per user:** turn off **“Grok dip briefing email”** on Profile (`dipInsightEmail: false`) while leaving email alerts on for short opportunity emails.

Future (§11): `DISABLE_RESEARCH_EMAILS` for broader research/fusion sends when that pipeline exists.

---

## Troubleshooting

| Symptom | Checks |
|---------|--------|
| No Grok email, only short opportunity email | `ENABLE_DIP_INSIGHT_EMAIL=true`, `DISABLE_DIP_INSIGHT_EMAIL` not true, user **`dipInsightEmail`** on, **`SMTP_*`** set, Python **reachable** at `PYTHON_SERVICE_URL`. |
| Dip insight errors in logs | Python logs for **`/agent/dip-insight`**; verify **`GROK_API_KEY`**; try **`LLM_MODEL`** compatible with **Responses + `x_search`**. |
| Empty X links in email | xAI **`citations`** may be empty for some queries; model still returns **`xPostLinks`** when it can. |
| High latency | Normal for **`x_search`**; increase timeouts only if needed; consider rate limits on xAI side. |

---

## Health checks

- **Node:** `GET /api/health` (includes Python URL metadata where configured).
- **Node config (non-secret flags):** `GET /api/health/config` — includes **`smtpConfigured`** and **`dipInsightGloballyEnabled`**.
- **Python:** `GET /health` on the Flask service — confirms process up; agent subgraph flags may be listed.

## Smoke tests

From repo root (Python service must be running with **`GROK_*`** for real Grok calls):

```bash
npm run golden:dip-insight   # POST /agent/dip-insight — ~30–90s (x_search)
npm run golden:opportunity   # POST /agent/opportunities
```

After deploying Python changes, **`pm2 restart stock-service`** so new routes (e.g. `/agent/dip-insight`) load.

---

## Related docs

- `docs/SECTION_11_PHASE_A.md` — §11 contracts (fusion roadmap may extend beyond current Grok-only dip path).
- `docs/AI_BUY_ALERT_AGENT_PLAN.md` — Longer-term agent plan.
