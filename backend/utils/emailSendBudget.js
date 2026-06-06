/**
 * Global + per-recipient caps so marketing SMTP stays well under AWS SES limits.
 * Transactional mail (password reset, username recovery) bypasses this module.
 */
const config = require('../config');
const logger = require('../utils/logger');
const { getRedisClient } = require('./redis');

const SES_PAUSED_KEY = 'emailbudget:ses_paused';
const DIGEST_KIND = 'daily_watchlist_digest';

function utcDateKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function utcHourKey(d = new Date()) {
  return d.toISOString().slice(0, 13);
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function logBudgetEvent(payload) {
  logger.info(
    `email_send_budget ${JSON.stringify({
      ts: new Date().toISOString(),
      ...payload
    })}`
  );
}

/**
 * @returns {Promise<boolean>}
 */
async function isSesSendPaused() {
  const redis = getRedisClient();
  if (!redis?.isOpen) return false;
  try {
    return (await redis.get(SES_PAUSED_KEY)) != null;
  } catch {
    return false;
  }
}

/**
 * After SES 454 / quota errors, pause marketing sends for a cooldown window.
 * @param {Error} err
 */
async function noteSesThrottleError(err) {
  const msg = String(err?.message || err || '');
  const code = err?.responseCode;
  if (code !== 454 && !/quota exceeded|throttl/i.test(msg)) return;

  const redis = getRedisClient();
  if (!redis?.isOpen) return;
  const sec = Math.max(300, config.SES_THROTTLE_PAUSE_SEC);
  try {
    await redis.setEx(SES_PAUSED_KEY, sec, '1');
    logBudgetEvent({ action: 'ses_paused', pauseSec: sec, error: msg.slice(0, 200) });
  } catch (e) {
    logger.warn(`emailSendBudget: failed to set SES pause: ${e.message}`);
  }
}

/**
 * @param {object} params
 * @param {string} params.kind — e.g. opportunity_signal, opportunity_digest
 * @param {string} [params.toEmail]
 * @param {number} [params.userId]
 * @returns {Promise<{ ok: boolean, reason?: string, dayCount?: number, hourCount?: number }>}
 */
/**
 * Daily Grok briefing — own day pool; no hourly or per-recipient gap (cron is staggered).
 * Does not increment `opportunityMaxEmailsPerDay` (worker never calls recordOpportunityEmailSent).
 */
async function tryReserveDigestSendSlot({ kind, userId }) {
  const dailyCap = config.SES_DIGEST_DAILY_EMAIL_CAP;
  if (dailyCap <= 0) {
    return { ok: true, reason: 'digest_budget_disabled' };
  }

  const redis = getRedisClient();
  if (!redis?.isOpen) {
    return { ok: true, reason: 'no_redis' };
  }
  if (await isSesSendPaused()) {
    return { ok: false, reason: 'ses_paused' };
  }

  const dayKey = `emailbudget:digest:day:${utcDateKey()}`;
  let dayCount = 0;
  try {
    dayCount = await redis.incr(dayKey);
    if (dayCount === 1) await redis.expire(dayKey, 48 * 3600);
  } catch (e) {
    logger.warn(`emailSendBudget digest incr failed: ${e.message}`);
    return { ok: true, reason: 'redis_incr_failed_allow' };
  }

  if (dayCount > dailyCap) {
    await redis.decr(dayKey).catch(() => {});
    logBudgetEvent({
      action: 'denied',
      reason: 'digest_daily_cap',
      kind,
      userId,
      dayCount,
      dailyCap
    });
    return { ok: false, reason: 'digest_daily_cap', dayCount };
  }

  logBudgetEvent({
    action: 'reserved',
    pool: 'digest',
    kind,
    userId,
    dayCount,
    dailyCap
  });
  return { ok: true, dayCount };
}

async function tryReserveSendSlot({ kind, toEmail, userId, budgetExempt = false }) {
  if (budgetExempt) {
    return { ok: true, reason: 'budget_exempt' };
  }

  if (kind === DIGEST_KIND) {
    return tryReserveDigestSendSlot({ kind, userId });
  }

  const dailyCap = config.SES_GLOBAL_DAILY_EMAIL_CAP;
  const hourlyCap = config.SES_GLOBAL_HOURLY_EMAIL_CAP;
  const gapSec = config.EMAIL_MIN_INTERVAL_PER_RECIPIENT_SEC;

  if (dailyCap <= 0 && hourlyCap <= 0 && gapSec <= 0) {
    return { ok: true, reason: 'budget_disabled' };
  }

  const redis = getRedisClient();
  if (!redis?.isOpen) {
    return { ok: true, reason: 'no_redis' };
  }

  if (await isSesSendPaused()) {
    return { ok: false, reason: 'ses_paused' };
  }

  const dayKey = `emailbudget:global:day:${utcDateKey()}`;
  const hourKey = `emailbudget:global:hour:${utcHourKey()}`;

  let dayCount = 0;
  let hourCount = 0;

  try {
    dayCount = await redis.incr(dayKey);
    if (dayCount === 1) await redis.expire(dayKey, 48 * 3600);
    hourCount = await redis.incr(hourKey);
    if (hourCount === 1) await redis.expire(hourKey, 3 * 3600);
  } catch (e) {
    logger.warn(`emailSendBudget incr failed: ${e.message}`);
    return { ok: true, reason: 'redis_incr_failed_allow' };
  }

  if (dailyCap > 0 && dayCount > dailyCap) {
    await redis.decr(dayKey).catch(() => {});
    await redis.decr(hourKey).catch(() => {});
    logBudgetEvent({
      action: 'denied',
      reason: 'global_daily_cap',
      kind,
      userId,
      dayCount,
      dailyCap
    });
    return { ok: false, reason: 'global_daily_cap', dayCount, hourCount };
  }

  if (hourlyCap > 0 && hourCount > hourlyCap) {
    await redis.decr(dayKey).catch(() => {});
    await redis.decr(hourKey).catch(() => {});
    logBudgetEvent({
      action: 'denied',
      reason: 'global_hourly_cap',
      kind,
      userId,
      hourCount,
      hourlyCap
    });
    return { ok: false, reason: 'global_hourly_cap', dayCount, hourCount };
  }

  const email = normalizeEmail(toEmail);
  if (gapSec > 0 && email) {
    const gapKey = `emailbudget:to:${email}`;
    try {
      const locked = await redis.set(gapKey, String(kind || 'm'), { NX: true, EX: gapSec });
      if (locked !== 'OK') {
        await redis.decr(dayKey).catch(() => {});
        await redis.decr(hourKey).catch(() => {});
        logBudgetEvent({
          action: 'denied',
          reason: 'recipient_cooldown',
          kind,
          userId,
          toEmail: email
        });
        return { ok: false, reason: 'recipient_cooldown', dayCount, hourCount };
      }
    } catch (e) {
      logger.warn(`emailSendBudget recipient gap failed: ${e.message}`);
    }
  }

  logBudgetEvent({
    action: 'reserved',
    kind,
    userId,
    dayCount,
    hourCount,
    dailyCap,
    hourlyCap
  });

  return { ok: true, dayCount, hourCount };
}

/**
 * @returns {Promise<{ paused: boolean, dayCount: number|null, hourCount: number|null, dailyCap: number, hourlyCap: number }>}
 */
async function getEmailBudgetStatus() {
  const redis = getRedisClient();
  const dailyCap = config.SES_GLOBAL_DAILY_EMAIL_CAP;
  const hourlyCap = config.SES_GLOBAL_HOURLY_EMAIL_CAP;
  const digestDailyCap = config.SES_DIGEST_DAILY_EMAIL_CAP;
  const paused = await isSesSendPaused();

  if (!redis?.isOpen) {
    return {
      paused,
      dayCount: null,
      hourCount: null,
      dailyCap,
      hourlyCap,
      digestDayCount: null,
      digestDailyCap
    };
  }

  try {
    const [dayRaw, hourRaw, digestRaw] = await Promise.all([
      redis.get(`emailbudget:global:day:${utcDateKey()}`),
      redis.get(`emailbudget:global:hour:${utcHourKey()}`),
      redis.get(`emailbudget:digest:day:${utcDateKey()}`)
    ]);
    return {
      paused,
      dayCount: dayRaw != null ? parseInt(dayRaw, 10) : 0,
      hourCount: hourRaw != null ? parseInt(hourRaw, 10) : 0,
      dailyCap,
      hourlyCap,
      digestDayCount: digestRaw != null ? parseInt(digestRaw, 10) : 0,
      digestDailyCap
    };
  } catch {
    return {
      paused,
      dayCount: null,
      hourCount: null,
      dailyCap,
      hourlyCap,
      digestDayCount: null,
      digestDailyCap
    };
  }
}

module.exports = {
  tryReserveSendSlot,
  noteSesThrottleError,
  isSesSendPaused,
  getEmailBudgetStatus,
  logBudgetEvent
};
