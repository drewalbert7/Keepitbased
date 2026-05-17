const logger = require('./logger');
const { floorTimeBucketUtc } = require('../services/watchlistOpportunityEvaluator');

/**
 * Quiet hours, per-user daily caps, and legacy-alert suppression for opportunity emails.
 */

function logOpportunityEmailEvent(payload) {
  logger.info(
    `opportunity_email_event ${JSON.stringify({
      ts: new Date().toISOString(),
      ...payload
    })}`
  );
}

function localHmInTimezone(date, timeZone) {
  const tz = timeZone || 'America/New_York';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(date);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return hour * 60 + minute;
  } catch (_e) {
    return null;
  }
}

function parseHm(hm) {
  const m = String(hm || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * @param {object} prefs — merged notification prefs
 * @param {Date} [now]
 * @returns {boolean} true when sends should be deferred (quiet hours active)
 */
function isOpportunityQuietHours(prefs, now = new Date()) {
  if (prefs.opportunityRespectQuietHours === false) return false;
  const start = parseHm(prefs.quietHoursStart ?? '22:00');
  const end = parseHm(prefs.quietHoursEnd ?? '08:00');
  const cur = localHmInTimezone(now, prefs.timezone || 'America/New_York');
  if (start == null || end == null || cur == null) return false;
  if (start === end) return false;
  if (start < end) {
    return cur >= start && cur < end;
  }
  return cur >= start || cur < end;
}

function utcDateKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function dailyCountRedisKey(userId, dateKey = utcDateKey()) {
  return `oppmail:daily:${userId}:${dateKey}`;
}

/**
 * @param {import('redis').RedisClientType|null} redis
 * @param {number} userId
 * @param {number} maxPerDay
 */
async function isOpportunityDailyEmailCapReached(redis, userId, maxPerDay) {
  const cap = Number(maxPerDay);
  if (!Number.isFinite(cap) || cap <= 0) return false;
  if (!redis?.isOpen) return false;
  try {
    const raw = await redis.get(dailyCountRedisKey(userId));
    const n = raw != null ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n >= cap;
  } catch (_e) {
    return false;
  }
}

async function recordOpportunityEmailSent(redis, userId) {
  if (!redis?.isOpen) return;
  const key = dailyCountRedisKey(userId);
  try {
    const n = await redis.incr(key);
    if (n === 1) {
      await redis.expire(key, 48 * 3600);
    }
  } catch (e) {
    logger.warn(`opportunity daily email counter failed user=${userId}: ${e.message}`);
  }
}

function legacyAlertBlockRedisKey(userId, assetType, symbol, date = new Date()) {
  const bucket = floorTimeBucketUtc(date, 60);
  return `oppmail:legacy-block:${userId}:${String(assetType).toLowerCase()}:${String(symbol).toUpperCase()}:${bucket}`;
}

async function markLegacyAlertBlocked(redis, userId, assetType, symbol, ttlSec = 3600) {
  if (!redis?.isOpen) return;
  const key = legacyAlertBlockRedisKey(userId, assetType, symbol);
  try {
    await redis.setEx(key, Math.max(60, ttlSec), '1');
  } catch (e) {
    logger.warn(`legacy alert block set failed ${key}: ${e.message}`);
  }
}

async function isLegacyAlertBlocked(redis, userId, assetType, symbol) {
  if (!redis?.isOpen) return false;
  try {
    const v = await redis.get(legacyAlertBlockRedisKey(userId, assetType, symbol));
    return v != null;
  } catch (_e) {
    return false;
  }
}

module.exports = {
  logOpportunityEmailEvent,
  isOpportunityQuietHours,
  isOpportunityDailyEmailCapReached,
  recordOpportunityEmailSent,
  markLegacyAlertBlocked,
  isLegacyAlertBlocked,
  legacyAlertBlockRedisKey,
  dailyCountRedisKey
};
