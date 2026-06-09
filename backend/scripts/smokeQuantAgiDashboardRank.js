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
const PUBLIC_APP = (process.env.PUBLIC_APP_URL || 'https://app.keepitbased.com').replace(/\/$/, '');

async function securityChecks(token) {
  let failed = 0;
  console.log('\nSecurity checks:');

  try {
    const blocked = await axios.get(`${PUBLIC_APP}/quant-sidecar/health`, {
      timeout: 15000,
      validateStatus: () => true
    });
    if (blocked.status === 403) {
      console.log('OK   public /quant-sidecar/ blocked (403)');
    } else {
      console.error(`FAIL public /quant-sidecar/ should be 403, got ${blocked.status}`);
      failed += 1;
    }
  } catch (err) {
    console.error('FAIL public /quant-sidecar/ check:', err.message);
    failed += 1;
  }

  try {
    const noAuth = await axios.get(`${API}/quant-agi/sidecar/diag/terminal-feed`, {
      timeout: 10000,
      validateStatus: () => true
    });
    if (noAuth.status === 401) {
      console.log('OK   sidecar proxy requires JWT (401 without token)');
    } else {
      console.error(`FAIL sidecar proxy without JWT should be 401, got ${noAuth.status}`);
      failed += 1;
    }
  } catch (err) {
    console.error('FAIL sidecar proxy auth check:', err.message);
    failed += 1;
  }

  try {
    const denied = await axios.get(`${API}/quant-agi/sidecar/webhook/swarm-enhance`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
      validateStatus: () => true
    });
    if (denied.status === 403) {
      console.log('OK   sidecar allowlist blocks webhook path (403)');
    } else {
      console.error(`FAIL webhook path should be 403, got ${denied.status}`);
      failed += 1;
    }
  } catch (err) {
    console.error('FAIL sidecar allowlist check:', err.message);
    failed += 1;
  }

  try {
    const { data } = await axios.get(`${API}/quant-agi/sidecar/diag/terminal-feed`, {
      params: { limit: 3 },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 60000
    });
    if (data && Array.isArray(data.events)) {
      console.log(`OK   authed sidecar terminal-feed (${data.events.length} events)`);
    } else {
      console.error('FAIL authed sidecar terminal-feed: unexpected payload');
      failed += 1;
    }
  } catch (err) {
    console.error('FAIL authed sidecar terminal-feed:', err.response?.data?.message || err.message);
    failed += 1;
  }

  return failed;
}

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

  failed += await securityChecks(token);
  if (failed) {
    process.exit(1);
  }
  console.log('Security checks OK.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
