const cron = require('node-cron');
const config = require('../config');
const db = require('../models/database');
const logger = require('../utils/logger');
const { isUsStockRegularTradingHours } = require('../utils/researchAlertGates');

let paperBotService = null;

function bindPaperBotService(service) {
  paperBotService = service;
}

async function runPaperBotAutoRunTick() {
  if (!config.ENABLE_PAPER_BOT_AUTO_RUN) return { skipped: true, reason: 'disabled' };
  if (!isUsStockRegularTradingHours()) return { skipped: true, reason: 'market_closed' };
  if (!paperBotService?.simulateDay) {
    return { skipped: true, reason: 'service_unbound' };
  }

  const intervalMs = config.PAPER_BOT_AUTO_RUN_INTERVAL_MS;
  const { rows } = await db.query(
    `SELECT user_id, last_auto_run_at
     FROM paper_bot_accounts
     WHERE auto_run_enabled = true AND kill_switch_armed = false`
  );

  let ran = 0;
  let errors = 0;

  for (const row of rows) {
    const last = row.last_auto_run_at ? new Date(row.last_auto_run_at).getTime() : 0;
    if (last && Date.now() - last < intervalMs) continue;
    try {
      await paperBotService.simulateDay(row.user_id, { source: 'auto' });
      ran += 1;
    } catch (err) {
      errors += 1;
      logger.error(`paper bot auto-run failed user=${row.user_id}: ${err.message}`);
    }
  }

  if (ran > 0) {
    logger.info(`paper bot auto-run tick: users=${ran} errors=${errors}`);
  }
  return { skipped: false, ran, errors, eligible: rows.length };
}

function schedulePaperBotAutoRun() {
  if (!config.ENABLE_PAPER_BOT_AUTO_RUN) {
    logger.info('Paper bot auto-run cron disabled (ENABLE_PAPER_BOT_AUTO_RUN=false)');
    return;
  }

  cron.schedule(
    '*/5 * * * *',
    async () => {
      try {
        await runPaperBotAutoRunTick();
      } catch (err) {
        logger.error('paper bot auto-run scheduler failed:', err);
      }
    },
    { timezone: 'America/New_York' }
  );

  logger.info(
    `Paper bot auto-run scheduled (every 5m check, ${config.PAPER_BOT_AUTO_RUN_INTERVAL_MS / 60000}m/user cadence, US market hours)`
  );
}

module.exports = {
  bindPaperBotService,
  runPaperBotAutoRunTick,
  schedulePaperBotAutoRun
};
