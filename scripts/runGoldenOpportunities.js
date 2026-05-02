#!/usr/bin/env node
/**
 * Runs golden prompts against Python POST /agent/opportunities (LLM required).
 * Usage: PYTHON_SERVICE_URL=http://127.0.0.1:5001 node scripts/runGoldenOpportunities.js
 */
const fs = require('fs');
const path = require('path');

const prompts = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'golden-opportunity-prompts.json'), 'utf8')
);

const base = (process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:5001').replace(/\/$/, '');
const TIMEOUT_MS = Number(process.env.GOLDEN_OPPORTUNITY_TIMEOUT_MS) || 120000;

async function post(body) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/agent/opportunities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  let failures = 0;
  for (let i = 0; i < prompts.length; i++) {
    const item = prompts[i];
    const body = {
      prompt: item.prompt,
      mode: 'recommend_only',
      preferences: item.preferences || { topN: 3, confidenceFloor: 0.45 },
      userId: 0
    };
    const label = item.name || `prompt_${i}`;
    process.stdout.write(`[${i + 1}/${prompts.length}] ${label} … `);
    let res;
    try {
      res = await post(body);
    } catch (e) {
      console.log(`FAIL ${e.message}`);
      failures++;
      continue;
    }
    if (!res.ok) {
      console.log(`FAIL HTTP ${res.status}`);
      failures++;
      continue;
    }
    const j = await res.json();
    if (!j.output || j.output.schemaVersion !== 'v1') {
      console.log('FAIL missing output.schemaVersion v1');
      failures++;
      continue;
    }
    console.log(`OK (${j.runMetadata?.providerUsed || '?'})`);
  }
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
