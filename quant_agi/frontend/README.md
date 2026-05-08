# Quant AGI Frontend (Terminal MVP)

Phase-0 "operations cockpit" for visualizing Quant AGI autoresearch, daily code updates, promotion states, and risk posture.

## Run locally

```bash
cd quant_agi/frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

## What this MVP includes

- Live event timeline with promotion-state badges
- Daily code update panel for diff visualization
- Performance/risk impact cards
- Mode selector (`paper`, `shadow`, `live`) and a visible kill switch
- Synthetic stream bootstrap to simulate incoming backend events

## Backend integration hooks

`StreamBootstrap` now polls Quant AGI sidecar endpoint:

- `GET /diag/terminal-feed?limit=20`

Set sidecar URL (`NEXT_PUBLIC_*` is baked in at **build** time):

- **Local dev:** `NEXT_PUBLIC_QUANT_AGI_URL=http://127.0.0.1:8844`
- **Production (app subdomain):** nginx should expose the FastAPI process at `https://app.keepitbased.com/quant-sidecar/` (see main repo `config/nginx/sites-available/app.keepitbased-https.conf`), then:

```bash
NEXT_PUBLIC_QUANT_AGI_URL=https://app.keepitbased.com/quant-sidecar npm run build
```

See `env.production.example`.

If feed fetch fails, UI falls back to synthetic events to keep the terminal usable.

Suggested payload shape:

```json
{
  "id": "evt-123",
  "ts": "2026-05-07T02:00:00.000Z",
  "type": "code_update_proposed",
  "title": "Allocator cap retune",
  "detail": "Regime-aware size cap lowered in high volatility.",
  "state": "proposed",
  "commitSha": "exp-4a911c2",
  "promptHash": "f7c921ac",
  "sharpeDelta": 0.18,
  "drawdownDelta": -0.9
}
```

## Next step

Wire this UI to Quant AGI `/diag` and live event endpoints, then swap the static diff block for real patch content from autoresearch artifacts.
