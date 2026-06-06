const cron = require('node-cron');
const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const db = require('../models/database');
const emailService = require('./emailService');
const { mergeNotificationPreferences } = require('../utils/notificationPreferences');
const { buildAgentWatchlistContext } = require('./agentWatchlistContext');
const { getResearchArtifactsForUser } = require('./researchArtifactsReader');
const { fetchDailyQuantAgiSuggestions } = require('./quantAgiDailySuggestions');

let running = false;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * One cron tick: eligible users → Grok digest via Python → SMTP.
 *
 * @param {import('./alertService')} alertService
 */
async function runDailyWatchlistDigestTick(alertService) {
  if (!config.ENABLE_DAILY_WATCHLIST_DIGEST_EMAIL || config.DISABLE_DAILY_WATCHLIST_DIGEST_EMAIL) {
    return { skipped: true, reason: 'disabled' };
  }
  if (!emailService.isConfigured()) {
    logger.warn('Daily watchlist digest skipped: SMTP not configured');
    return { skipped: true, reason: 'smtp' };
  }
  if (running) {
    logger.warn('Daily watchlist digest: skipped overlapping tick');
    return { skipped: true, reason: 'overlap' };
  }
  running = true;
  const pythonUrl = `${(config.PYTHON_SERVICE_URL || 'http://127.0.0.1:5001').replace(/\/$/, '')}/agent/daily-watchlist-digest`;
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  try {
    const result = await db.query(
      `SELECT id, email, notification_preferences FROM users WHERE email IS NOT NULL AND email != ''`
    );
    const rows = result.rows || [];

    for (const row of rows) {
      const prefs = mergeNotificationPreferences(row.notification_preferences);
      // Daily briefing is opt-out; never increments opportunityMaxEmailsPerDay.
      if (prefs.email === false) {
        skipped += 1;
        continue;
      }
      if (prefs.dailyWatchlistDigestEmail === false) {
        skipped += 1;
        continue;
      }

      let watchlistContext;
      try {
        watchlistContext = await buildAgentWatchlistContext({
          alertService,
          userId: row.id,
          maxPositionPct: prefs.agentMaxPositionSizePct
        });
      } catch (e) {
        logger.warn(`Daily digest: watchlist context failed user ${row.id}: ${e.message}`);
        failed += 1;
        continue;
      }

      if (!watchlistContext || !Array.isArray(watchlistContext.items) || watchlistContext.items.length === 0) {
        skipped += 1;
        continue;
      }

      let researchPack = {
        artifacts: [],
        lookbackHours: config.DAILY_DIGEST_RESEARCH_LOOKBACK_HOURS,
        symbolsAllowed: []
      };
      try {
        const symList = watchlistContext.items.map((it) =>
          String(it.symbol || '').toUpperCase().trim()
        );
        researchPack = await getResearchArtifactsForUser(row.id, {
          symbols: symList,
          hours: config.DAILY_DIGEST_RESEARCH_LOOKBACK_HOURS,
          limit: 45
        });
      } catch (re) {
        logger.warn(`Daily digest: research artifacts skipped user ${row.id}: ${re.message}`);
      }

      const symList = watchlistContext.items.map((it) =>
        String(it.symbol || '').toUpperCase().trim()
      );
      let quantAgiPack = { suggestions: [], meta: {} };
      try {
        quantAgiPack = await fetchDailyQuantAgiSuggestions({ watchlistSymbols: symList });
      } catch (qe) {
        logger.warn(`Daily digest: Quant AGI suggestions skipped user ${row.id}: ${qe.message}`);
      }

      let digest;
      let pyMeta = {};
      try {
        const { data } = await axios.post(
          pythonUrl,
          {
            watchlistContext,
            researchArtifacts: researchPack.artifacts,
            researchDigestMeta: {
              lookbackHours: researchPack.lookbackHours,
              artifactCount: (researchPack.artifacts || []).length,
              symbolsCovered: researchPack.symbolsAllowed || []
            }
          },
          { timeout: 180000 }
        );
        if (!data || data.error) {
          throw new Error(data?.error || 'daily-watchlist-digest failed');
        }
        pyMeta = data.runMetadata && typeof data.runMetadata === 'object' ? data.runMetadata : {};
        digest = data.digest;
        if (!digest || typeof digest !== 'object') {
          throw new Error('Invalid digest payload');
        }
      } catch (e) {
        logger.warn(`Daily digest: Grok call failed user ${row.id} ${row.email}: ${e.message}`);
        failed += 1;
        await sleep(config.DAILY_WATCHLIST_DIGEST_STAGGER_MS);
        continue;
      }

      try {
        await emailService.sendDailyWatchlistDigestEmail(row.email, {
          digest,
          runMetadata: pyMeta,
          userId: row.id,
          quantAgiSuggestions: quantAgiPack.suggestions,
          quantAgiSections: quantAgiPack.sections,
          quantAgiMeta: quantAgiPack.meta
        });
        sent += 1;
      } catch (e) {
        logger.error(`Daily digest: email failed user ${row.id}: ${e.message}`);
        failed += 1;
      }

      await sleep(config.DAILY_WATCHLIST_DIGEST_STAGGER_MS);
    }

    logger.info(
      `Daily watchlist digest: sent=${sent} failed=${failed} skipped=${skipped} usersScanned=${rows.length}`
    );
    return { sent, failed, skipped, usersScanned: rows.length };
  } catch (e) {
    logger.error('Daily watchlist digest tick error:', e);
    throw e;
  } finally {
    running = false;
  }
}

/**
 * @param {import('./alertService')} alertService
 * @param {string} [scheduleExpr]
 */
function scheduleDailyWatchlistDigest(alertService, scheduleExpr) {
  if (!config.ENABLE_DAILY_WATCHLIST_DIGEST_EMAIL) {
    logger.info(
      'Daily watchlist digest cron not scheduled (ENABLE_DAILY_WATCHLIST_DIGEST_EMAIL=false)'
    );
    return;
  }
  if (config.DISABLE_DAILY_WATCHLIST_DIGEST_EMAIL) {
    logger.info('Daily watchlist digest disabled (DISABLE_DAILY_WATCHLIST_DIGEST_EMAIL is true)');
    return;
  }
  const expr = scheduleExpr || config.DAILY_WATCHLIST_DIGEST_CRON;
  try {
    cron.schedule(expr, () => {
      runDailyWatchlistDigestTick(alertService).catch((err) => {
        logger.error('Daily watchlist digest cron run failed:', err);
      });
    });
    logger.info(`Daily watchlist digest scheduled: ${expr}`);
  } catch (e) {
    logger.error(`Invalid DAILY_WATCHLIST_DIGEST_CRON "${expr}": ${e.message}`);
  }
}

module.exports = {
  runDailyWatchlistDigestTick,
  scheduleDailyWatchlistDigest
};
