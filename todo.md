# KeepItBased Implementation Checkpoint

Last updated: 2026-04-27

## Completed (current milestone)

- Migrated stock/crypto market data integration to Massive/Polygon paths and removed Yahoo Finance usage.
- Hardened chart API contracts in backend:
  - candle/quote sanitization
  - stable metadata (`sourceUsed`, `partialData`, `lastUpdated`)
  - source-aware quote fallback (`snapshot` -> `agg_minute` -> `agg_day`)
- Added Redis caching for chart quote/history endpoints with source/interval-based TTLs.
- Added chart regression suite:
  - `backend/scripts/chartRegressionCheck.js`
  - npm scripts: `backend:test:charts` and root `test:charts`
- Upgraded stock dashboard UX:
  - source/freshness/status badges
  - stale data indicators
  - clearer error states and refresh controls
  - improved search dropdown polish and UX
- Replaced legacy stock chart renderer with `lightweight-charts` engine.
- Added indicator v1 calculations and display:
  - SMA20/SMA50
  - EMA20/EMA50
  - RSI14
  - MACD/Signal/Histogram
- Added indicator overlays directly on chart canvas.
- Applied anti-jitter improvements:
  - reduced rerender churn
  - stabilized layout regions and status elements
  - reduced UI timer update frequency

## In progress / to verify

- Validate frontend chart smoothness under sustained live polling and symbol switching.
- Verify source transitions (`snapshot`/`agg_minute`/`agg_day`) render without visual jumps.

## Next priority (recommended)

1. Add delta updates for chart series (update last bar, append only on new bar) to further reduce redraws.
2. Add lightweight runtime performance counters (render/update cadence, dropped updates).
3. Add adaptive chart time-scale lock behavior to prevent any residual viewport jitter.
4. Add screenshot-based QA checklist for core symbols/timeframes before release.

## Commands

- Run regression checks:
  - `npm run test:charts`

- Start local dev:
  - backend: `cd backend && npm run dev`
  - frontend: `cd frontend && npm start`
