#!/usr/bin/env bash
# Minimal smoke test for LangGraph opportunity endpoint (no Node auth). Fails if schema missing.
set -euo pipefail
BASE="${PYTHON_SERVICE_URL:-http://127.0.0.1:5001}"
echo "==> POST $BASE/agent/opportunities"
TMP=$(mktemp)
HTTP=$(curl -sS --max-time 120 -o "$TMP" -w "%{http_code}" -X POST "$BASE/agent/opportunities" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Smoke test: scan for quality dip entries in large-cap tech","mode":"recommend_only","preferences":{"topN":2,"confidenceFloor":0.4},"userId":0}')
if [[ "$HTTP" != "200" ]]; then
  cat "$TMP"
  rm -f "$TMP"
  echo "==> FAIL HTTP $HTTP"
  exit 1
fi
node -e "
const fs = require('fs');
const j = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
if (!j.output || j.output.schemaVersion !== 'v1') {
  console.error('Missing output.schemaVersion v1');
  process.exit(1);
}
if (!j.runMetadata || typeof j.runMetadata.providerUsed !== 'string') {
  console.error('Missing runMetadata.providerUsed');
  process.exit(1);
}
console.log('OK provider=', j.runMetadata.providerUsed, 'fallback=', j.runMetadata.fallbackUsed);
" "$TMP"
rm -f "$TMP"
