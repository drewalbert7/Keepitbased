const cron = require('node-cron');
const config = require('../config');
const logger = require('../utils/logger');
const { runPolygonNewsIngestionForWatchlists } = require('./polygonNewsIngestion');

let running = false;
let lastSummary = null;

/**
 * One non-overlapping ingestion pass (Polygon → research_artifacts).
 */
async function runResearchIngestionTick() {
  if (!config.ENABLE_RESEARCH_INGESTION) {
    return { skipped: true, reason: 'disabled' };
  }
  if (running) {
    logger.warn('Research ingestion: skipped overlapping tick');
    return { skipped: true, reason: 'overlap' };
  }
  running = true;
  try {
    const stats = await runPolygonNewsIngestionForWatchlists();
    lastSummary = { at: new Date().toISOString(), ...stats };
    if (!stats.skipped) {
      logger.info(`Research ingestion: ${JSON.stringify(stats)}`);
    }
    return stats;
  } catch (e) {
    logger.error('Research ingestion tick failed:', e);
    lastSummary = { at: new Date().toISOString(), error: e.message };
    throw e;
  } finally {
    running = false;
  }
}

/**
 * Register cron; does not throw if disabled.
 *
 * @param {string} [scheduleExpr] - default from config.RESEARCH_NEWS_CRON
 */
function scheduleResearchIngestion(scheduleExpr) {
  if (!config.ENABLE_RESEARCH_INGESTION) {
    logger.info('Research ingestion cron not scheduled (ENABLE_RESEARCH_INGESTION is not true)');
    return;
  }
  const expr = scheduleExpr || config.RESEARCH_NEWS_CRON;
  try {
    cron.schedule(expr, () => {
      runResearchIngestionTick().catch(() => {});
    });
    logger.info(`Research ingestion scheduled: ${expr}`);
  } catch (e) {
    logger.error(`Invalid RESEARCH_NEWS_CRON "${expr}": ${e.message}`);
  }
}

function getLastIngestionSummary() {
  return lastSummary;
}

module.exports = {
  runResearchIngestionTick,
  scheduleResearchIngestion,
  getLastIngestionSummary
};
