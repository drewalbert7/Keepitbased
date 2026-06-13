const cron = require('node-cron');
const config = require('../config');
const db = require('../models/database');
const logger = require('../utils/logger');
const { isUsStockRegularTradingHours } = require('../utils/researchAlertGates');

let paperBotService = null;

function bindPaperBotService(service) {
  paperBotService = service;
}

async function runPaperBotLearningAutoRunTick() {
  if (!config.ENABLE_PAPER_BOT_LEARNING_AUTO_RUN) {
    return { skipped: true, reason: 'disabled' };
  }
  if (isUsStockRegularTradingHours()) {
    return { skipped: true, reason: 'market_open' };
  }
  if (!paperBotService?.runBotLearningCycle) {
    return { skipped: true, reason: 'service_unbound' };
  }

  const intervalMs = config.PAPER_BOT_LEARNING_INTERVAL_MS;
  const { rows } = await db.query(
    `SELECT user_id, last_auto_learning_at
     FROM paper_bot_accounts
     WHERE auto_run_enabled = true AND kill_switch_armed = false`
  );

  let ran = 0;
  let errors = 0;

  for (const row of rows) {
    const last = row.last_auto_learning_at ? new Date(row.last_auto_learning_at).getTime() : 0;
    if (last && Date.now() - last < intervalMs) continue;
    try {
      await paperBotService.runBotLearningCycle(row.user_id, { source: 'auto' });
      ran += 1;
    } catch (err) {
      errors += 1;
      logger.error(`paper bot learning auto-run failed user=${row.user_id}: ${err.message}`);
    }
  }

  if (ran > 0) {
    logger.info(`paper bot learning auto-run: users=${ran} errors=${errors}`);
  }
  return { skipped: false, ran, errors, eligible: rows.length };
}

function schedulePaperBotLearningAutoRun() {
  if (!config.ENABLE_PAPER_BOT_LEARNING_AUTO_RUN) {
    logger.info('Paper bot learning auto-run disabled (ENABLE_PAPER_BOT_LEARNING_AUTO_RUN=false)');
    return;
  }

  const expr = config.PAPER_BOT_LEARNING_CRON || '15 */1 * * *';

  cron.schedule(
    expr,
    async () => {
      try {
        await runPaperBotLearningAutoRunTick();
      } catch (err) {
        logger.error('paper bot learning auto-run scheduler failed:', err);
      }
    },
    { timezone: 'America/New_York' }
  );

  const intervalHours = Math.round(config.PAPER_BOT_LEARNING_INTERVAL_MS / 3600000);
  logger.info(
    `Paper bot learning auto-run scheduled (${expr} ET, ${intervalHours}h/user cadence, after hours when bot ON)`
  );
}

module.exports = {
  bindPaperBotService,
  runPaperBotLearningAutoRunTick,
  schedulePaperBotLearningAutoRun
};
