const { floorTimeBucketUtc } = require('../services/watchlistOpportunityEvaluator');

/**
 * 2-of-3 minute polls before opportunity email (Phase 2). Toasts/signals unchanged.
 */

function confirmationRedisKey(userId, assetType, symbol) {
  return `oppconfirm:${userId}:${String(assetType).toLowerCase()}:${String(symbol).toUpperCase()}`;
}

function emailSentRedisKey(userId, assetType, symbol, date = new Date()) {
  const bucket = floorTimeBucketUtc(date, 60);
  return `oppmail:sent:${userId}:${String(assetType).toLowerCase()}:${String(symbol).toUpperCase()}:${bucket}`;
}

/**
 * @param {import('redis').RedisClientType|null} redis
 * @param {number} userId
 * @param {string} assetType
 * @param {string} symbol
 * @param {{ requiredHits?: number, windowPolls?: number, now?: Date }} [opts]
 */
async function registerOpportunityEmailConfirmationPoll(redis, userId, assetType, symbol, opts = {}) {
  const requiredHits = Number(opts.requiredHits) > 0 ? Number(opts.requiredHits) : 2;
  const windowPolls = Number(opts.windowPolls) > 0 ? Number(opts.windowPolls) : 3;
  const bucket = floorTimeBucketUtc(opts.now || new Date(), 1);

  if (!redis?.isOpen) {
    return { confirmed: true, hits: requiredHits, required: requiredHits, degraded: true };
  }

  const key = confirmationRedisKey(userId, assetType, symbol);
  try {
    const raw = await redis.get(key);
    let buckets = [];
    if (raw) {
      try {
        buckets = JSON.parse(raw);
      } catch {
        buckets = [];
      }
    }
    if (!Array.isArray(buckets)) buckets = [];
    if (!buckets.includes(bucket)) {
      buckets.push(bucket);
    }
    buckets = buckets.slice(-windowPolls);
    const ttlSec = Math.max(300, windowPolls * 120);
    await redis.setEx(key, ttlSec, JSON.stringify(buckets));

    const hits = buckets.length;
    return {
      confirmed: hits >= requiredHits,
      hits,
      required: requiredHits,
      degraded: false
    };
  } catch {
    return { confirmed: true, hits: requiredHits, required: requiredHits, degraded: true };
  }
}

async function isOpportunityEmailSentThisHour(redis, userId, assetType, symbol) {
  if (!redis?.isOpen) return false;
  try {
    const v = await redis.get(emailSentRedisKey(userId, assetType, symbol));
    return v != null;
  } catch {
    return false;
  }
}

async function markOpportunityEmailSentThisHour(redis, userId, assetType, symbol, ttlSec = 3600) {
  if (!redis?.isOpen) return;
  const key = emailSentRedisKey(userId, assetType, symbol);
  try {
    await redis.setEx(key, Math.max(60, ttlSec), '1');
  } catch {
    /* non-fatal */
  }
}

module.exports = {
  confirmationRedisKey,
  emailSentRedisKey,
  registerOpportunityEmailConfirmationPoll,
  isOpportunityEmailSentThisHour,
  markOpportunityEmailSentThisHour
};
