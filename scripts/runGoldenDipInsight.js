#!/usr/bin/env node
/**
 * Smoke test: POST /agent/dip-insight (Python). Calls Grok + x_search — requires GROK_* on python-service.
 * Usage: PYTHON_SERVICE_URL=http://127.0.0.1:5001 node scripts/runGoldenDipInsight.js
 */
const base = (process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:5001').replace(/\/$/, '');
const TIMEOUT_MS = Number(process.env.GOLDEN_DIP_INSIGHT_TIMEOUT_MS) || 120000;

const dipContext = {
  symbol: 'AAPL',
  assetType: 'stock',
  flags: ['on_sale'],
  reasons: ['Golden: price vs baseline threshold (synthetic)'],
  vsBaselinePct: -6.25,
  price: 180.25,
  baselinePrice: 192.5,
  dayChangePct: -2.1,
  timestamp: new Date().toISOString()
};

function validateInsight(insight) {
  if (!insight || typeof insight !== 'object') return 'insight must be object';
  if (typeof insight.situationSummary !== 'string' || !insight.situationSummary.trim()) {
    return 'missing situationSummary';
  }
  const xs = insight.xSentiment;
  if (!xs || typeof xs !== 'object') return 'missing xSentiment';
  if (!['bearish', 'neutral', 'bullish', 'unknown'].includes(String(xs.label))) {
    return 'xSentiment.label invalid';
  }
  const pct = Number(insight.suggestedTranchePct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 50) return 'suggestedTranchePct out of range';
  if (!Array.isArray(insight.riskNotes)) return 'riskNotes must be array';
  return null;
}

async function main() {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${base}/agent/dip-insight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dipContext,
        xSnippets: [],
        maxAllocationPct: 10
      }),
      signal: controller.signal
    });
  } catch (e) {
    console.error(`FAIL fetch: ${e.message}`);
    process.exit(1);
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    const txt = await res.text();
    console.error(`FAIL HTTP ${res.status}: ${txt.slice(0, 500)}`);
    process.exit(1);
  }

  const j = await res.json();
  if (j.error) {
    console.error(`FAIL ${j.error}`);
    process.exit(1);
  }

  const err = validateInsight(j.insight);
  if (err) {
    console.error(`FAIL schema: ${err}`);
    process.exit(1);
  }

  const cite = Array.isArray(j.citations) ? j.citations.length : 0;
  console.log(
    `OK provider=${j.runMetadata?.providerUsed || '?'} citations=${cite} fallback=${j.runMetadata?.fallbackUsed}`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
