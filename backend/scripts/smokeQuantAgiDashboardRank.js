#!/usr/bin/env node
/**
 * Smoke test: dashboard Quant AGI rank proxy (all four strategies).
 * Usage: node backend/scripts/smokeQuantAgiDashboardRank.js
 */
const jwt = require('jsonwebtoken');
const axios = require('axios');
const config = require('../config');
const { resolveQuantAgiBaseUrl } = require('../utils/quantAgiBaseUrl');

const STRATEGIES = [
  'momentum_liquidity',
  'photonics_chokepoint',
  'rule_breaker_gardner_early',
  'rule_breaker_gardner'
];

const PORT = config.PORT || 3001;
const API = `http://127.0.0.1:${PORT}/api`;

async function main() {
  const token = jwt.sign({ userId: 1, email: 'smoke@test.local' }, config.JWT_SECRET, {
    expiresIn: '5m'
  });

  console.log('Quant sidecar base:', resolveQuantAgiBaseUrl());
  let failed = 0;

  for (const strategy of STRATEGIES) {
    try {
      const { data } = await axios.get(`${API}/quant-agi/market-universe-rank`, {
        params: { strategy, top_n: 9 },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 60000
      });
      const n = Array.isArray(data.positions) ? data.positions.length : 0;
      const top = data.positions?.[0]?.symbol || '—';
      if (!n) {
        console.error(`FAIL ${strategy}: zero positions`);
        failed += 1;
      } else {
        console.log(`OK   ${strategy}: ${n} positions (top ${top})`);
      }
    } catch (err) {
      console.error(`FAIL ${strategy}:`, err.response?.data?.message || err.message);
      failed += 1;
    }
  }

  if (failed) {
    process.exit(1);
  }
  console.log('All strategies OK — dashboard Quant AGI rank proxy is healthy.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
