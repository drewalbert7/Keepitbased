#!/usr/bin/env node
/**
 * Runs one daily watchlist digest tick (same as cron): eligible users → Python Grok → SMTP.
 *
 * Requires:
 *   - Daily digest not disabled: ENABLE_DAILY_WATCHLIST_DIGEST_EMAIL not false/off, DISABLE_* not true
 *   - SMTP_* set, PYTHON_SERVICE_URL + stock-service with /agent/daily-watchlist-digest
 *
 * Usage (from repo root):
 *   cd backend && node scripts/runDailyWatchlistDigestOnce.js
 */

require('../config');
const { initializeDatabase, pool } = require('../models/database');
const { getRedisClient } = require('../utils/redis');
const AlertService = require('../services/alertService');
const { runDailyWatchlistDigestTick } = require('../services/dailyWatchlistDigestWorker');
const config = require('../config');

async function shutdownConnections() {
  try {
    const r = getRedisClient();
    if (r && typeof r.quit === 'function') await r.quit();
  } catch (_) {
    /* ignore */
  }
  try {
    await pool.end();
  } catch (_) {
    /* ignore */
  }
}

async function main() {
  await initializeDatabase();

  if (!config.ENABLE_DAILY_WATCHLIST_DIGEST_EMAIL || config.DISABLE_DAILY_WATCHLIST_DIGEST_EMAIL) {
    console.error(
      'Daily digest is disabled in config. If ENABLE_DAILY_WATCHLIST_DIGEST_EMAIL is false, unset it or delete that line (default is on). If DISABLE_DAILY_WATCHLIST_DIGEST_EMAIL is true, turn it off; then restart the API.'
    );
    await shutdownConnections();
    process.exit(1);
  }

  const alertService = new AlertService(null);
  try {
    const result = await runDailyWatchlistDigestTick(alertService);
    console.log(JSON.stringify(result, null, 2));
    await shutdownConnections();
    if (result && result.skipped === true && typeof result.reason === 'string') {
      process.exit(result.reason === 'overlap' ? 2 : 1);
    }
    process.exit(0);
  } catch (e) {
    await shutdownConnections();
    throw e;
  }
}

main().catch(async (e) => {
  console.error(e);
  await shutdownConnections();
  process.exit(1);
});
