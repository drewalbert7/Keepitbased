const cron = require('node-cron');
const config = require('../config');
const logger = require('../utils/logger');
const emailService = require('./emailService');
const {
  claimInstantPending,
  listDueDigestBatchKeys,
  claimPendingByBatchKey,
  markOutboxSent,
  markOutboxFailed
} = require('./emailOutboxService');
const {
  recordOpportunityEmailSent,
  markLegacyAlertBlocked,
  logOpportunityEmailEvent
} = require('../utils/opportunityEmailPolicy');
const { markOpportunityEmailSentThisHour } = require('../utils/opportunityEmailConfirmation');
const { getRedisClient } = require('../utils/redis');
const emailSendBudget = require('../utils/emailSendBudget');
const { sendDipInsightForOpportunity } = require('./dipInsightEmailService');
const { recordDipInsightEmailSent } = require('../utils/dipInsightEmailPolicy');

let running = false;

/**
 * @param {import('./priceMonitor')} priceMonitor
 */
async function deliverOpportunityOutboxRow(priceMonitor, row) {
  const payload = row.payload || {};
  const deliverCtx = payload.deliverCtx;
  if (!deliverCtx || !row.to_email) {
    throw new Error('invalid opportunity outbox payload');
  }

  const sent = await priceMonitor.deliverOpportunityEmail({
    row: { user_id: row.user_id, notification_preferences: deliverCtx.notification_preferences },
    email: row.to_email,
    payload: payload.opportunity || deliverCtx.payload,
    prefs: deliverCtx.prefs,
    priceData: deliverCtx.priceData,
    evalResult: deliverCtx.evalResult,
    dayChangePct: deliverCtx.dayChangePct,
    assetType: deliverCtx.assetType,
    symbol: deliverCtx.symbol,
    signalId: deliverCtx.signalId,
    tech: deliverCtx.tech || {}
  });
  if (!sent) {
    throw new Error('opportunity email not sent (budget cap, SES pause, or SMTP)');
  }

  const redis = getRedisClient();
  await markOpportunityEmailSentThisHour(
    redis,
    row.user_id,
    deliverCtx.assetType,
    deliverCtx.symbol,
    config.OPPORTUNITY_DEDUPE_TTL_SEC
  );
  await recordOpportunityEmailSent(redis, row.user_id);
  await markLegacyAlertBlocked(redis, row.user_id, deliverCtx.assetType, deliverCtx.symbol);

  logOpportunityEmailEvent({
    action: 'sent',
    via: 'outbox',
    outboxId: row.id,
    userId: row.user_id,
    symbol: deliverCtx.symbol,
    assetType: deliverCtx.assetType,
    flags: deliverCtx.evalResult?.flags
  });
}

async function deliverDipInsightOutboxRow(row) {
  const deliverCtx = row.payload?.deliverCtx;
  if (!deliverCtx || !row.to_email) {
    throw new Error('invalid dip insight outbox payload');
  }

  const result = await sendDipInsightForOpportunity(deliverCtx);
  const redis = getRedisClient();

  if (result?.emailSent) {
    await recordDipInsightEmailSent(redis, row.user_id);
  }
  if (result?.emailSent || result?.plainOpportunityEmailSent) {
    await recordOpportunityEmailSent(redis, row.user_id);
    if (deliverCtx.assetType && deliverCtx.symbol) {
      await markOpportunityEmailSentThisHour(
        redis,
        row.user_id,
        deliverCtx.assetType,
        deliverCtx.symbol,
        config.OPPORTUNITY_DEDUPE_TTL_SEC
      );
      await markLegacyAlertBlocked(redis, row.user_id, deliverCtx.assetType, deliverCtx.symbol);
    }
  }

  logOpportunityEmailEvent({
    action: result?.emailSent || result?.plainOpportunityEmailSent ? 'sent' : 'suppressed',
    via: 'outbox_dip_insight',
    outboxId: row.id,
    userId: row.user_id,
    symbol: deliverCtx.symbol,
    assetType: deliverCtx.assetType,
    flags: deliverCtx.evalResult?.flags,
    dipInsightRich: !!result?.emailSent,
    suppressReason: result?.suppressReason
  });
}

/**
 * @param {import('./priceMonitor')} priceMonitor
 */
async function processInstantOutbox(priceMonitor) {
  let processed = 0;

  const dipRows = await claimInstantPending(config.DIP_INSIGHT_OUTBOX_PER_TICK, 'opportunity_dip_insight');
  for (const row of dipRows) {
    try {
      await deliverDipInsightOutboxRow(row);
      await markOutboxSent([row.id]);
      processed += 1;
    } catch (e) {
      logger.warn(`Outbox dip insight failed id=${row.id}: ${e.message}`);
      await markOutboxFailed(row.id, e.message);
    }
  }

  const instantCap = Math.min(
    config.EMAIL_OUTBOX_BATCH_SIZE,
    config.EMAIL_OUTBOX_INSTANT_MAX_PER_TICK
  );
  const rows = await claimInstantPending(instantCap, 'opportunity_signal');
  for (const row of rows) {
    try {
      await deliverOpportunityOutboxRow(priceMonitor, row);
      await markOutboxSent([row.id]);
      processed += 1;
    } catch (e) {
      logger.warn(`Outbox instant send failed id=${row.id}: ${e.message}`);
      await markOutboxFailed(row.id, e.message);
      logOpportunityEmailEvent({
        action: 'suppressed',
        reason: 'outbox_send_failed',
        outboxId: row.id,
        userId: row.user_id,
        error: e.message
      });
    }
  }
  return processed;
}

/**
 * @param {import('./priceMonitor')} priceMonitor
 */
async function processDigestBatches(priceMonitor) {
  const keys = await listDueDigestBatchKeys(8);
  let sentBatches = 0;

  for (const batchKey of keys) {
    const rows = await claimPendingByBatchKey(batchKey);
    if (!rows.length) continue;

    const opportunityRows = rows.filter((r) => r.message_type === 'opportunity_signal');
    if (!opportunityRows.length) {
      for (const r of rows) {
        await markOutboxFailed(r.id, 'unsupported digest row type');
      }
      continue;
    }

    const toEmail = opportunityRows[0].to_email;
    const items = opportunityRows.map((r) => r.payload?.opportunity || r.payload?.deliverCtx?.payload).filter(Boolean);

    try {
      const ok = await emailService.sendOpportunityHourlyDigestEmail(toEmail, items, {
        userId: opportunityRows[0].user_id
      });
      if (!ok) {
        throw new Error('digest SMTP send returned false');
      }

      const redis = getRedisClient();
      for (const row of opportunityRows) {
        const dc = row.payload?.deliverCtx;
        if (dc?.assetType && dc?.symbol) {
          await markOpportunityEmailSentThisHour(
            redis,
            row.user_id,
            dc.assetType,
            dc.symbol,
            config.OPPORTUNITY_DEDUPE_TTL_SEC
          );
          await markLegacyAlertBlocked(redis, row.user_id, dc.assetType, dc.symbol);
        }
      }
      await recordOpportunityEmailSent(redis, opportunityRows[0].user_id);

      await markOutboxSent(opportunityRows.map((r) => r.id));

      logOpportunityEmailEvent({
        action: 'sent',
        via: 'outbox_digest',
        userId: opportunityRows[0].user_id,
        batchKey,
        count: items.length
      });
      sentBatches += 1;
    } catch (e) {
      logger.warn(`Outbox digest failed batch=${batchKey}: ${e.message}`);
      for (const row of opportunityRows) {
        await markOutboxFailed(row.id, e.message);
      }
    }
  }

  return sentBatches;
}

/**
 * @param {import('./priceMonitor')} priceMonitor
 */
async function runEmailOutboxTick(priceMonitor) {
  if (!config.ENABLE_EMAIL_OUTBOX) {
    return { skipped: true };
  }
  if (!emailService.isConfigured()) {
    return { skipped: true, reason: 'smtp' };
  }
  if (await emailSendBudget.isSesSendPaused()) {
    return { skipped: true, reason: 'ses_paused' };
  }
  if (running) {
    return { skipped: true, reason: 'overlap' };
  }
  running = true;
  try {
    const instant = await processInstantOutbox(priceMonitor);
    const digests = await processDigestBatches(priceMonitor);
    if (instant > 0 || digests > 0) {
      logger.info(`Email outbox tick: instant=${instant} digest_batches=${digests}`);
    }
    return { instant, digests };
  } finally {
    running = false;
  }
}

/**
 * @param {import('./priceMonitor')} priceMonitor
 */
function scheduleEmailOutboxWorker(priceMonitor) {
  if (!config.ENABLE_EMAIL_OUTBOX) {
    logger.info('Email outbox worker not scheduled (ENABLE_EMAIL_OUTBOX=false)');
    return;
  }
  const expr = config.EMAIL_OUTBOX_CRON || '*/1 * * * *';
  cron.schedule(expr, () => {
    runEmailOutboxTick(priceMonitor).catch((err) => {
      logger.error('Email outbox worker tick failed:', err);
    });
  });
  logger.info(`Email outbox worker scheduled (${expr})`);
}

module.exports = {
  runEmailOutboxTick,
  scheduleEmailOutboxWorker,
  deliverOpportunityOutboxRow
};
