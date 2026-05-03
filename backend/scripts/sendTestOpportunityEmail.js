#!/usr/bin/env node
/**
 * Sends one **plain opportunity signal email** using the same template as PriceMonitor
 * (`sendOpportunitySignalEmail`), with payload derived from a **real** user alert baseline
 * on a symbol that appears on their **Main** watchlist.
 *
 * Uses a **simulated** price (−7% vs baseline) so flags match a typical “on_sale” trigger
 * without waiting for the market.
 *
 * Usage (from repo root or backend):
 *   node backend/scripts/sendTestOpportunityEmail.js
 *   TEST_USER_ID=2 node backend/scripts/sendTestOpportunityEmail.js
 *   TEST_USER_EMAIL=you@example.com node backend/scripts/sendTestOpportunityEmail.js
 *
 * If the user has **no** `user_alerts` row with `baseline_price` (required for real parity),
 * you may send anyway with a synthetic baseline:
 *   TEST_USE_SYNTHETIC_BASELINE=true TEST_USER_EMAIL=… \\
 *     TEST_BASELINE_PRICE=150 TEST_SYMBOL=AAPL node backend/scripts/sendTestOpportunityEmail.js
 *
 * Requires SMTP configured in backend/.env (same as production sends).
 */

require('../config');
const db = require('../models/database');
const { initializeDatabase } = require('../models/database');
const emailService = require('../services/emailService');
const { evaluateWatchlistOpportunity } = require('../services/watchlistOpportunityEvaluator');
const { parseSymbolsJson } = require('../services/watchlistService');

function parseStockSymbolsFromMain(rows) {
  const set = new Set();
  for (const row of rows) {
    for (const t of parseSymbolsJson(row.symbols)) {
      if (typeof t === 'string' && t.startsWith('STOCK:')) {
        set.add(t.slice(6).toUpperCase().trim());
      }
    }
  }
  return set;
}

async function main() {
  await initializeDatabase();

  if (!emailService.isConfigured()) {
    console.error('SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS). Cannot send.');
    process.exit(1);
  }

  const testEmail = (process.env.TEST_USER_EMAIL || '').trim().toLowerCase();
  const testUid = process.env.TEST_USER_ID ? parseInt(process.env.TEST_USER_ID, 10) : null;

  let userRow;
  if (testEmail) {
    const r = await db.query(
      `SELECT id, email, notification_preferences FROM users WHERE LOWER(TRIM(email)) = $1`,
      [testEmail]
    );
    userRow = r.rows[0];
    if (!userRow) {
      console.error(`No user with email matching: ${testEmail}`);
      process.exit(1);
    }
  } else if (Number.isFinite(testUid) && testUid > 0) {
    const r = await db.query(
      `SELECT id, email, notification_preferences FROM users WHERE id = $1`,
      [testUid]
    );
    userRow = r.rows[0];
    if (!userRow) {
      console.error(`No user id=${testUid}`);
      process.exit(1);
    }
  } else {
    const r = await db.query(
      `SELECT id, email, notification_preferences FROM users WHERE email IS NOT NULL ORDER BY id ASC LIMIT 1`
    );
    userRow = r.rows[0];
    if (!userRow) {
      console.error('No users in database.');
      process.exit(1);
    }
  }

  const prefs = userRow.notification_preferences;
  const emailOn =
    prefs == null ||
    (typeof prefs === 'object' && prefs.email !== false);
  if (!emailOn) {
    console.error(`User ${userRow.id} has email notifications disabled in notification_preferences.`);
    process.exit(1);
  }

  const wl = await db.query(
    `SELECT symbols FROM user_watchlists WHERE user_id = $1 AND name = 'Main'`,
    [userRow.id]
  );
  const watchSymbols = wl.rows.length ? parseStockSymbolsFromMain(wl.rows) : new Set();

  const alerts = await db.query(
    `SELECT symbol, asset_type, baseline_price
     FROM user_alerts
     WHERE user_id = $1 AND active = true AND baseline_price IS NOT NULL`,
    [userRow.id]
  );

  let chosen = null;
  for (const row of alerts.rows) {
    const sym = String(row.symbol || '').toUpperCase().trim();
    const at = String(row.asset_type || 'stock').toLowerCase();
    if (at !== 'stock') continue;
    if (watchSymbols.size > 0 && !watchSymbols.has(sym)) continue;
    chosen = { symbol: sym, assetType: at, baselinePrice: Number(row.baseline_price) };
    break;
  }

  if (!chosen && alerts.rows.length > 0) {
    const row = alerts.rows.find((r) => String(r.asset_type).toLowerCase() === 'stock');
    if (row) {
      chosen = {
        symbol: String(row.symbol).toUpperCase().trim(),
        assetType: 'stock',
        baselinePrice: Number(row.baseline_price)
      };
    }
  }

  if (!chosen) {
    const synth =
      process.env.TEST_USE_SYNTHETIC_BASELINE === 'true' ||
      process.env.TEST_USE_SYNTHETIC_BASELINE === '1';
    if (synth) {
      const base = parseFloat(process.env.TEST_BASELINE_PRICE || '100', 10);
      if (!Number.isFinite(base) || base <= 0) {
        console.error('TEST_USE_SYNTHETIC_BASELINE requires numeric TEST_BASELINE_PRICE (> 0)');
        process.exit(1);
      }
      let sym = (process.env.TEST_SYMBOL || '').trim().toUpperCase();
      if (!sym && watchSymbols.size > 0) {
        sym = [...watchSymbols][0];
      }
      if (!sym) {
        sym = 'AAPL';
      }
      chosen = { symbol: sym, assetType: 'stock', baselinePrice: base };
      console.warn(
        '[WARN] Using synthetic baseline — add an active stock alert with baseline in the app for full parity.'
      );
    }
  }

  if (!chosen) {
    console.error(
      'No active stock alert with baseline_price for this user. Add a watchlist alert with a baseline first, ' +
        'or rerun with TEST_USE_SYNTHETIC_BASELINE=true TEST_BASELINE_PRICE=… TEST_SYMBOL=… (optional).'
    );
    process.exit(1);
  }

  const baselinePrice = chosen.baselinePrice;
  const price = baselinePrice * 0.93;

  const evalResult = evaluateWatchlistOpportunity({
    symbol: chosen.symbol,
    price,
    baselinePrice,
    dayChangePct: -2.5,
    recentAbsAvgMovePct: null
  });

  if (!evalResult.evaluated || !evalResult.flags.length) {
    console.warn('Evaluator returned no flags at −7% vs baseline (unexpected). Sending anyway with synthetic flags.');
  }

  const flags =
    evalResult.flags.length > 0
      ? evalResult.flags
      : ['on_sale'];
  const reasons =
    evalResult.reasons.length > 0
      ? evalResult.reasons
      : [`Test send: simulated price $${price.toFixed(4)} vs baseline $${baselinePrice.toFixed(4)}`];

  const payload = {
    kind: 'opportunity_signal',
    symbol: chosen.symbol,
    assetType: 'stock',
    flags,
    reasons,
    vsBaselinePct: evalResult.vsBaselinePct != null ? evalResult.vsBaselinePct : ((price - baselinePrice) / baselinePrice) * 100,
    price,
    timestamp: new Date().toISOString()
  };

  await emailService.sendOpportunitySignalEmail(userRow.email, payload, {
    subjectPrefix: '[TEST] '
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        to: userRow.email,
        userId: userRow.id,
        symbol: chosen.symbol,
        simulatedPrice: price,
        baselinePrice,
        flags: payload.flags
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
