#!/usr/bin/env bash
# Build frontend and reload API under PM2, then verify /api/health (prevents silent 502s).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-3001}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT}/api/health}"

echo "==> npm run build"
echo "    (CRA bakes env at build time: set REACT_APP_SUPABASE_URL + REACT_APP_SUPABASE_ANON_KEY in frontend/.env.production for live chat — see frontend/env.production.example)"
npm run build

echo "==> Quant AGI frontend (Next) production build"
if [ -d quant_agi/frontend ] && [ -f quant_agi/frontend/package.json ]; then
  (cd quant_agi/frontend && npm run build)
else
  echo "    (skip — quant_agi/frontend not present)"
fi

echo "==> pm2 reload keepitbased-api (start if missing)"
if pm2 describe keepitbased-api >/dev/null 2>&1; then
  pm2 reload ecosystem.config.js --only keepitbased-api --update-env
else
  pm2 start ecosystem.config.js --only keepitbased-api
fi

echo "==> wait for listener"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf "$HEALTH_URL" >/dev/null; then
    echo "==> health OK: $HEALTH_URL"
    echo "==> If LangGraph / python-service changed: pm2 restart stock-service && curl -sf http://127.0.0.1:5001/health"
    if pm2 describe quant-agi-api >/dev/null 2>&1; then
      echo "==> pm2 reload quant-agi-api (Python sidecar)"
      pm2 reload ecosystem.config.js --only quant-agi-api --update-env || pm2 restart quant-agi-api --update-env
    fi
    if pm2 describe quant-agi-frontend >/dev/null 2>&1; then
      echo "==> pm2 restart quant-agi-frontend (Next.js)"
      pm2 restart quant-agi-frontend --update-env
    fi
    pm2 save
    exit 0
  fi
  sleep 1
done

echo "==> ERROR: health check failed after reload: $HEALTH_URL"
echo "    Run: pm2 logs keepitbased-api --lines 80"
exit 1
