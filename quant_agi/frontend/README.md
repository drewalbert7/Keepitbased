# Quant AGI Frontend (Deep ops terminal)

Operations cockpit at **`/quant-agi`** — **Quant AGI Bot** + autoresearch engineering tools.

**Dashboard (`/dashboard`)** — watchlist, deploy list, rank suggestions, assistant only. **No bot UI on dashboard.**

## Page layout

```text
Zone B — Quant AGI Bot (`PaperTradingBotPanel`)
  components/bot/BotHealthStrip · BotControls · BotPerformanceChart
  BotPositionsTable · BotTradeBlotter · AutoresearchDailyStrip

Zone C — Autoresearch & engineering ops
  EventTimeline · JarvisCodingChat · CodeDiffPanel
```

## Run locally

```bash
cd quant_agi/frontend
npm install
npm run dev
```

## Backend integration

- **Quant AGI Bot:** `/api/paper-bot/*` (JWT from main app login)
- **Autoresearch feed:** `/api/quant-agi/sidecar/diag/terminal-feed`
- **Jarvis:** `POST /v1/coding-chat` via sidecar proxy

On `app.keepitbased.com` the terminal auto-uses `/api/quant-agi/sidecar` for sidecar routes.

## Embed mode

Main app loads this UI at `/quant-agi-terminal/?embed=1`. Compact banner + dashboard links use `target="_top"`.
