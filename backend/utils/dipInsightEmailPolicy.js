const logger = require('./logger');

/**
 * Phase 4 — Grok dip-insight gating (tier, daily cap, async via outbox).
 */

function qualifiesForDipInsightTier(flags) {
  if (!Array.isArray(flags) || !flags.length) return false;
  return flags.includes('overreaction') || flags.includes('capitulation');
}

function utcDateKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function dipInsightDailyRedisKey(userId, dateKey = utcDateKey()) {
  return `oppmail:dip-insight:daily:${userId}:${dateKey}`;
}

/**
 * @param {import('redis').RedisClientType|null} redis
 * @param {number} userId
 * @param {number} maxPerDay
 */
async function isDipInsightDailyCapReached(redis, userId, maxPerDay) {
  const cap = Number(maxPerDay);
  if (!Number.isFinite(cap) || cap <= 0) return false;
  if (!redis?.isOpen) return false;
  try {
    const raw = await redis.get(dipInsightDailyRedisKey(userId));
    const n = raw != null ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n >= cap;
  } catch (_e) {
    return false;
  }
}

async function recordDipInsightEmailSent(redis, userId) {
  if (!redis?.isOpen) return;
  const key = dipInsightDailyRedisKey(userId);
  try {
    const n = await redis.incr(key);
    if (n === 1) {
      await redis.expire(key, 48 * 3600);
    }
  } catch (e) {
    logger.warn(`dip insight daily counter failed user=${userId}: ${e.message}`);
  }
}

module.exports = {
  qualifiesForDipInsightTier,
  isDipInsightDailyCapReached,
  recordDipInsightEmailSent,
  dipInsightDailyRedisKey
};
