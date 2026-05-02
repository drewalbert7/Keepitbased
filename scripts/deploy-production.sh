#!/usr/bin/env bash
# Build frontend and reload API under PM2, then verify /api/health (prevents silent 502s).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-3001}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT}/api/health}"

echo "==> npm run build"
npm run build

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
    pm2 save
    exit 0
  fi
  sleep 1
done

echo "==> ERROR: health check failed after reload: $HEALTH_URL"
echo "    Run: pm2 logs keepitbased-api --lines 80"
exit 1
