#!/usr/bin/env node
/**
 * Smoke: learning lab API shape + optional full learning→tick loop.
 *
 * Usage:
 *   PAPER_BOT_TEST_EMAIL=… PAPER_BOT_TEST_PASSWORD=… node backend/scripts/smokePaperBotLearningLoop.js
 *
 * Optional (calls Grok — slow, needs XAI/GROK key on quant-agi-api):
 *   PAPER_BOT_SMOKE_RUN_LEARNING=1 … node backend/scripts/smokePaperBotLearningLoop.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const axios = require('axios');

const API = (process.env.API_BASE_URL || 'http://127.0.0.1:3001/api').replace(/\/$/, '');
const email = process.env.PAPER_BOT_TEST_EMAIL || process.env.SMOKE_TEST_EMAIL;
const password = process.env.PAPER_BOT_TEST_PASSWORD || process.env.SMOKE_TEST_PASSWORD;
const runLearning = String(process.env.PAPER_BOT_SMOKE_RUN_LEARNING || '').trim() === '1';

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    process.exit(1);
  }
}

async function main() {
  if (!email || !password) {
    console.error('Set PAPER_BOT_TEST_EMAIL and PAPER_BOT_TEST_PASSWORD (or SMOKE_TEST_*).');
    process.exit(1);
  }

  const login = await axios.post(`${API}/auth/login`, { email, password });
  const token = login.data?.token;
  assert(token, 'login — no token');
  console.log('OK   login');

  const headers = { Authorization: `Bearer ${token}` };

  const latestRes = await axios.get(`${API}/paper-bot/learning/latest`, { headers });
  const latest = latestRes.data;
  assert(latest && typeof latest === 'object', 'learning/latest — empty response');
  assert(Object.prototype.hasOwnProperty.call(latest, 'outcomeGate'), 'learning/latest missing outcomeGate key');
  assert(Object.prototype.hasOwnProperty.call(latest, 'outcomeProgress'), 'learning/latest missing outcomeProgress key');
  assert(Object.prototype.hasOwnProperty.call(latest, 'activeLearningMemory'), 'learning/latest missing activeLearningMemory key');
  assert(latest.metrics && typeof latest.metrics.tradeCount === 'number', 'learning/latest metrics.tradeCount');
  console.log(
    `OK   learning/latest gate=${latest.outcomeGate?.status || 'none'} progress=${
      latest.outcomeProgress
        ? `${latest.outcomeProgress.tradesSinceBaseline}/${latest.outcomeProgress.windowTrades}`
        : 'n/a'
    }`
  );

  if (runLearning) {
    console.log('INFO running learning cycle (Grok)…');
    const learnRes = await axios.post(`${API}/paper-bot/learning/run`, {}, { headers, timeout: 120000 });
    const after = learnRes.data;
    assert(after?.metrics, 'learning/run — missing metrics');
    assert('outcomeGate' in after, 'learning/run — missing outcomeGate');
    const mem = after.activeLearningMemory;
    assert(mem && typeof mem === 'object', 'learning/run — no activeLearningMemory');
    assert(
      mem.coaching_directives || mem.effective_directives,
      'learning/run — memory missing coaching directives'
    );
    console.log(
      `OK   learning/run memory=${Boolean(mem)} gate=${after.outcomeGate?.status || 'none'} proposals=${
        after.learningPendingRules?.length ?? 0
      }`
    );

    const stateRes = await axios.get(`${API}/paper-bot/state`, { headers });
    const universe = stateRes.data?.account?.universeMode;
    if (universe === 'quant_auto_agent') {
      const sim = await axios.post(`${API}/paper-bot/simulate-day`, {}, { headers, timeout: 120000 });
      assert(sim.data?.account, 'simulate-day after learning — missing account');
      console.log(
        `OK   simulate-day after learning skipped=${Boolean(sim.data.runDay?.skipped)} fills=${
          sim.data.runDay?.fillCount ?? 0
        }`
      );
    } else {
      console.log(`INFO skip simulate-day agent check (universe=${universe || 'unknown'}, need quant_auto_agent)`);
    }
  } else {
    console.log('INFO skip learning/run (set PAPER_BOT_SMOKE_RUN_LEARNING=1 to run full Grok cycle)');
  }

  console.log('PASS paper bot learning loop smoke');
}

main().catch((err) => {
  console.error('FAIL', err.response?.data?.message || err.message);
  process.exit(1);
});
