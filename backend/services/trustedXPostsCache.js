const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const { resolveQuantAgiBaseUrl } = require('../utils/quantAgiBaseUrl');

/** @type {Map<string, { posts: object[], error: string|null, errorCode: string|null, expiresAt: number }>} */
const cacheByHandles = new Map();
/** @type {Map<string, Promise<{ posts: object[], error: string|null, errorCode: string|null, fromCache: boolean }>>} */
const inflightByHandles = new Map();

function normalizeHandles(handles) {
  return [...new Set(handles.map((h) => String(h || '').replace(/^@/, '').toLowerCase()).filter(Boolean))].sort();
}

function cacheKey(handles) {
  return normalizeHandles(handles).join(',');
}

function cacheTtlMs() {
  const n = parseInt(process.env.TRUSTED_X_POSTS_CACHE_TTL_MS, 10);
  if (Number.isFinite(n) && n >= 0) return n;
  return config.TRUSTED_X_POSTS_CACHE_TTL_MS;
}

function readCached(key) {
  const entry = cacheByHandles.get(key);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry;
}

/**
 * Fetch trusted-handle posts via quant-agi x_search with TTL cache.
 * @param {string[]} handles
 * @param {{ forceRefresh?: boolean, allowFetch?: boolean }} [opts]
 */
async function fetchTrustedPostsForHandles(handles, { forceRefresh = false, allowFetch = true } = {}) {
  const uniq = normalizeHandles(handles);
  if (!uniq.length) {
    return { posts: [], error: null, errorCode: null, fromCache: false, skipped: true };
  }

  const key = cacheKey(uniq);
  if (!forceRefresh) {
    const hit = readCached(key);
    if (hit) {
      return {
        posts: hit.posts,
        error: hit.error,
        errorCode: hit.errorCode,
        fromCache: true,
        skipped: false
      };
    }
  }

  if (!allowFetch) {
    const stale = cacheByHandles.get(key);
    if (stale) {
      return {
        posts: stale.posts,
        error: stale.error,
        errorCode: stale.errorCode,
        fromCache: true,
        stale: true,
        skipped: false
      };
    }
    return { posts: [], error: null, errorCode: null, fromCache: false, skipped: true };
  }

  if (!forceRefresh && inflightByHandles.has(key)) {
    return inflightByHandles.get(key);
  }

  const job = (async () => {
    const base = resolveQuantAgiBaseUrl();
    let posts = [];
    let error = null;
    let errorCode = null;
    try {
      const { data } = await axios.post(
        `${base}/bot/x-trusted-posts`,
        { handles: uniq },
        { timeout: Math.max(config.QUANT_AGI_RANK_TIMEOUT_MS || 45000, 90000) }
      );
      posts = Array.isArray(data?.posts) ? data.posts : [];
      error = data?.error ? String(data.error) : null;
      errorCode = data?.error_code ? String(data.error_code) : null;
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data?.message || err.message;
      error = String(msg);
      errorCode = 'request_failed';
      logger.warn(`x_search trusted posts failed: ${msg}`);
    }

    cacheByHandles.set(key, {
      posts,
      error,
      errorCode,
      expiresAt: Date.now() + cacheTtlMs()
    });

    return { posts, error, errorCode, fromCache: false, skipped: false };
  })();

  inflightByHandles.set(key, job);
  try {
    return await job;
  } finally {
    inflightByHandles.delete(key);
  }
}

function invalidateTrustedPostsCache(userId) {
  void userId;
  cacheByHandles.clear();
  inflightByHandles.clear();
}

module.exports = {
  fetchTrustedPostsForHandles,
  invalidateTrustedPostsCache,
  cacheKeyForHandles: cacheKey
};
