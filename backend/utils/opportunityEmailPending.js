const logger = require('./logger');

const PENDING_USERS_SET = 'oppmail:pending-users';

function pendingHashKey(userId) {
  return `oppmail:pending:v1:${userId}`;
}

function pendingField(assetType, symbol) {
  return `${String(assetType).toLowerCase()}:${String(symbol).toUpperCase()}`;
}

/**
 * Queue a stock opportunity email for morning RTH flush (when outside regular session).
 * @param {import('redis').RedisClientType|null} redis
 * @param {number} userId
 * @param {object} item — serializable pending payload
 */
async function enqueuePendingOpportunityEmail(redis, userId, item) {
  if (!redis?.isOpen || !item?.symbol || !item?.assetType) return false;
  const field = pendingField(item.assetType, item.symbol);
  try {
    await redis.hSet(pendingHashKey(userId), field, JSON.stringify(item));
    await redis.sAdd(PENDING_USERS_SET, String(userId));
    await redis.expire(pendingHashKey(userId), 48 * 3600);
    return true;
  } catch (e) {
    logger.warn(`enqueue pending opportunity email failed user=${userId}: ${e.message}`);
    return false;
  }
}

/**
 * @param {import('redis').RedisClientType|null} redis
 * @returns {Promise<number[]>}
 */
async function listPendingOpportunityUserIds(redis) {
  if (!redis?.isOpen) return [];
  try {
    const ids = await redis.sMembers(PENDING_USERS_SET);
    return ids.map((id) => parseInt(id, 10)).filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}

/**
 * @param {import('redis').RedisClientType|null} redis
 * @param {number} userId
 * @returns {Promise<object[]>}
 */
async function drainPendingOpportunityEmails(redis, userId) {
  if (!redis?.isOpen) return [];
  const hashKey = pendingHashKey(userId);
  try {
    const all = await redis.hGetAll(hashKey);
    await redis.del(hashKey);
    await redis.sRem(PENDING_USERS_SET, String(userId));
    const out = [];
    for (const raw of Object.values(all || {})) {
      try {
        out.push(JSON.parse(raw));
      } catch {
        /* skip corrupt */
      }
    }
    return out;
  } catch (e) {
    logger.warn(`drain pending opportunity emails failed user=${userId}: ${e.message}`);
    return [];
  }
}

module.exports = {
  PENDING_USERS_SET,
  pendingHashKey,
  enqueuePendingOpportunityEmail,
  listPendingOpportunityUserIds,
  drainPendingOpportunityEmails
};
