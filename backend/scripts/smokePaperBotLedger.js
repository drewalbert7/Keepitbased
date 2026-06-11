#!/usr/bin/env node
/**
 * Smoke: paper bot ledger tables + simulate-day path (requires auth token + running API + quant-agi-api).
 *
 * Usage:
 *   PAPER_BOT_TEST_EMAIL=you@example.com PAPER_BOT_TEST_PASSWORD=secret node backend/scripts/smokePaperBotLedger.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const axios = require('axios');
const jwt = require('jsonwebtoken');
const db = require('../models/database');
const { auditNamespaceSideEffects } = require('../utils/paperBotNamespace');

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

  let userId = null;
  let deployListCountBefore = 0;
  let deployListMaxUpdatedBefore = null;
  try {
    const decoded = jwt.decode(token);
    userId = decoded?.id ?? decoded?.userId ?? null;
    if (userId) {
      const deployRes = await db.query(
        `SELECT COUNT(*)::int AS c, MAX(updated_at) AS max_updated
         FROM user_deploy_list_items WHERE user_id = $1`,
        [userId]
      );
      deployListCountBefore = deployRes.rows[0]?.c ?? 0;
      deployListMaxUpdatedBefore = deployRes.rows[0]?.max_updated ?? null;
    }
  } catch (err) {
    console.log(`INFO namespace pre-check skipped: ${err.message}`);
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

  if (userId) {
    const policyBefore = state.account.policyVersion;
    const pendingInsert = await db.query(
      `INSERT INTO paper_bot_rules (user_id, source, status, rule_text, rule_json)
       VALUES ($1, 'bot_suggested', 'pending', 'Smoke pending rule', $2::jsonb)
       RETURNING id`,
      [
        userId,
        JSON.stringify({
          rule_type: 'max_open_positions',
          value: 4,
          rationale: 'smoke test pending remove'
        })
      ]
    );
    const pendingId = pendingInsert.rows[0]?.id;
    if (!pendingId) {
      console.error('FAIL could not seed pending rule');
      process.exit(1);
    }

    const afterPending = await axios.post(`${API}/paper-bot/rules/${pendingId}/remove`, {}, { headers });
    const stillPending = (afterPending.data?.pendingRules || []).some((r) => r.id === pendingId);
    if (stillPending) {
      console.error('FAIL pending rule still listed after remove');
      process.exit(1);
    }
    console.log('OK   remove pending rule');

    const activeInsert = await db.query(
      `INSERT INTO paper_bot_rules (user_id, source, status, rule_text, rule_json)
       VALUES ($1, 'bot_suggested', 'active', 'Smoke active rule', $2::jsonb)
       RETURNING id`,
      [
        userId,
        JSON.stringify({
          rule_type: 'max_open_positions',
          value: 3,
          rationale: 'smoke test active revoke'
        })
      ]
    );
    const activeId = activeInsert.rows[0]?.id;
    await db.query(
      `UPDATE paper_bot_accounts SET policy_version = policy_version + 1, updated_at = NOW() WHERE user_id = $1`,
      [userId]
    );

    const afterActive = await axios.post(`${API}/paper-bot/rules/${activeId}/remove`, {}, { headers });
    const stillActive = (afterActive.data?.activeRules || []).some((r) => r.id === activeId);
    if (stillActive) {
      console.error('FAIL active rule still listed after remove');
      process.exit(1);
    }
    if ((afterActive.data?.account?.policyVersion ?? 0) <= policyBefore) {
      console.error('FAIL policy version did not bump after active rule remove');
      process.exit(1);
    }
    console.log('OK   remove active rule (policy bumped)');

    await db.query(
      `INSERT INTO paper_bot_rules (user_id, source, status, rule_text, rule_json)
       VALUES ($1, 'bot_suggested', 'pending', 'Smoke bulk A', '{}'::jsonb),
              ($1, 'bot_suggested', 'pending', 'Smoke bulk B', '{}'::jsonb)`,
      [userId]
    );
    const cleared = await axios.post(`${API}/paper-bot/rules/pending/clear`, {}, { headers });
    if ((cleared.data?.pendingRules || []).length > 0) {
      console.error('FAIL pending rules remain after clear');
      process.exit(1);
    }
    console.log('OK   clear all pending rules');

    const statusRow = await db.query(
      `SELECT status FROM paper_bot_rules WHERE id = ANY($1::int[])`,
      [[pendingId, activeId]]
    );
    const bad = statusRow.rows.filter((r) => r.status !== 'dismissed');
    if (bad.length) {
      console.error('FAIL removed rules not marked dismissed in DB');
      process.exit(1);
    }
    console.log('OK   removed rules status=dismissed in DB');
  }

  const ar = await axios.get(`${API}/paper-bot/autoresearch/latest`, { headers });
  if (!ar.data?.metrics) {
    console.error('FAIL paper-bot/autoresearch/latest — missing metrics');
    process.exit(1);
  }
  console.log(
    `OK   autoresearch/latest gates=${ar.data.promotion?.passedCount ?? 0}/${ar.data.promotion?.totalCount ?? 4} nightly=${Boolean(ar.data.nightlyContext)}`
  );

  if (userId) {
    const audit = await auditNamespaceSideEffects(db, userId, {
      deployListCountBefore,
      deployListMaxUpdatedBefore
    });
    if (!audit.ok) {
      console.error(
        `FAIL namespace isolation outbox=${audit.opportunityOutboxRecent} deployChanged=${!audit.deployUnchanged}`
      );
      process.exit(1);
    }
    console.log('OK   namespace isolation (no opportunity outbox, deploy list unchanged)');
    if (Array.isArray(simState.recentTrades) && simState.recentTrades.length) {
      const last = simState.recentTrades[0];
      const ns = last.reasonJson?.fill_namespace;
      if (ns !== 'paper_bot') {
        console.error(`FAIL fill_namespace expected paper_bot got ${ns || 'missing'}`);
        process.exit(1);
      }
      console.log('OK   fill stamped fill_namespace=paper_bot');
    }
  }

  await axios.post(`${API}/paper-bot/kill-switch`, { armed: true }, { headers });
  console.log('OK   kill switch re-armed');

  console.log('PASS paper bot ledger smoke');
}

main().catch((err) => {
  console.error('FAIL', err.response?.data?.message || err.message);
  process.exit(1);
});
