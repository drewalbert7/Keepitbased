#!/usr/bin/env node
/**
 * Smoke: paper bot ledger tables + simulate-day path (requires auth token + running API + quant-agi-api).
 *
 * Usage:
 *   PAPER_BOT_TEST_EMAIL=you@example.com PAPER_BOT_TEST_PASSWORD=secret node backend/scripts/smokePaperBotLedger.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const axios = require('axios');

const API = (process.env.API_BASE_URL || 'http://127.0.0.1:3001/api').replace(/\/$/, '');
const email = process.env.PAPER_BOT_TEST_EMAIL || process.env.SMOKE_TEST_EMAIL;
const password = process.env.PAPER_BOT_TEST_PASSWORD || process.env.SMOKE_TEST_PASSWORD;

async function main() {
  if (!email || !password) {
    console.error('Set PAPER_BOT_TEST_EMAIL and PAPER_BOT_TEST_PASSWORD (or SMOKE_TEST_*).');
    process.exit(1);
  }

  const login = await axios.post(`${API}/auth/login`, { email, password });
  const token = login.data?.token;
  if (!token) {
    console.error('FAIL login — no token');
    process.exit(1);
  }
  console.log('OK   login');

  const headers = { Authorization: `Bearer ${token}` };
  const stateRes = await axios.get(`${API}/paper-bot/state`, { headers });
  const state = stateRes.data;
  if (!state?.account) {
    console.error('FAIL paper-bot/state — missing account');
    process.exit(1);
  }
  console.log(`OK   state phase=${state.phase} equity=${state.account.equityUsd}`);

  if (state.account.killSwitchArmed) {
    await axios.post(
      `${API}/paper-bot/kill-switch`,
      { armed: false, confirmPhrase: 'ENABLE PAPER TRADES' },
      { headers }
    );
    console.log('OK   kill switch disarmed for smoke');
  }

  const sim = await axios.post(`${API}/paper-bot/simulate-day`, {}, { headers });
  const simState = sim.data;
  console.log(
    `OK   simulate-day skipped=${Boolean(simState.runDay?.skipped)} fills=${simState.runDay?.fillCount ?? 0}`
  );

  if (Array.isArray(simState.recentTrades) && simState.recentTrades.length) {
    console.log(`OK   blotter rows=${simState.recentTrades.length}`);
  } else if (simState.runDay?.skipped) {
    console.log(`INFO simulate skipped: ${simState.runDay.reason || 'unknown'}`);
  }

  if (Array.isArray(simState.snapshots) && simState.snapshots.length) {
    console.log(`OK   snapshots=${simState.snapshots.length}`);
  }

  const ar = await axios.get(`${API}/paper-bot/autoresearch/latest`, { headers });
  if (!ar.data?.metrics) {
    console.error('FAIL paper-bot/autoresearch/latest — missing metrics');
    process.exit(1);
  }
  console.log(
    `OK   autoresearch/latest gates=${ar.data.promotion?.passedCount ?? 0}/${ar.data.promotion?.totalCount ?? 4} nightly=${Boolean(ar.data.nightlyContext)}`
  );

  await axios.post(`${API}/paper-bot/kill-switch`, { armed: true }, { headers });
  console.log('OK   kill switch re-armed');

  console.log('PASS paper bot ledger smoke');
}

main().catch((err) => {
  console.error('FAIL', err.response?.data?.message || err.message);
  process.exit(1);
});
