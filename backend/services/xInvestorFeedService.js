const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config');

/** In-memory cache + single-flight lock */
let cachePayload = null;
let cacheExpiresAt = 0;
let inflight = null;

function parseMonitoredAccounts() {
  const raw = process.env.X_MONITORED_ACCOUNTS_JSON || '';
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((a) => ({
        id: String(a.id || a.userId || '').trim(),
        username: String(a.username || a.handle || '').replace(/^@/, ''),
        label: String(a.label || a.name || '').trim() || 'Source'
      }))
      .filter((a) => /^\d+$/.test(a.id));
  } catch (e) {
    logger.warn('X_MONITORED_ACCOUNTS_JSON invalid JSON', e.message);
    return [];
  }
}

function extractCashtags(text) {
  const set = new Set();
  for (const m of String(text).matchAll(/\$([A-Z]{1,5})\b/g)) {
    set.add(m[1]);
  }
  return [...set];
}

function aggregateTickers(tweets) {
  const counts = new Map();
  for (const tw of tweets) {
    for (const t of tw.cashtags) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([symbol, mentions]) => ({ symbol, mentions }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 12);
}

async function fetchUserTweets(bearer, userId, maxResults = 8) {
  const url = `https://api.twitter.com/2/users/${encodeURIComponent(userId)}/tweets`;
  const { data } = await axios.get(url, {
    timeout: 12000,
    headers: { Authorization: `Bearer ${bearer}` },
    params: {
      max_results: Math.min(10, maxResults),
      'tweet.fields': 'created_at,author_id',
      expansions: 'author_id',
      'user.fields': 'username,name'
    }
  });

  const usersById = new Map();
  if (data.includes?.users) {
    for (const u of data.includes.users) {
      usersById.set(u.id, u);
    }
  }

  const list = data.data || [];
  return list.map((t) => {
    const author = usersById.get(t.author_id);
    const text = t.text || '';
    return {
      id: t.id,
      createdAt: t.created_at,
      text,
      authorUsername: author?.username || null,
      authorName: author?.name || null,
      cashtags: extractCashtags(text)
    };
  });
}

/**
 * Returns cached-or-fresh X pulse for monitored investor accounts.
 * Requires X_API_BEARER_TOKEN (Twitter / X API v2 app bearer).
 */
async function getXPulse({ ttlMs = 90000 } = {}) {
  const now = Date.now();
  if (cachePayload && now < cacheExpiresAt) {
    return { ...cachePayload, cached: true };
  }
  if (inflight) return inflight;

  const bearer = config.X_API_BEARER_TOKEN || process.env.X_API_BEARER_TOKEN || '';
  const accounts = parseMonitoredAccounts();

  inflight = (async () => {
    try {
      if (!bearer) {
        const empty = {
          configured: false,
          warning:
            'Add X_API_BEARER_TOKEN and X_MONITORED_ACCOUNTS_JSON to enable live posts from investor accounts you trust.',
          accounts: [],
          tweets: [],
          tickerBuzz: [],
          fetchedAt: new Date().toISOString(),
          cached: false
        };
        cachePayload = empty;
        cacheExpiresAt = Date.now() + 60_000;
        return empty;
      }

      if (accounts.length === 0) {
        const empty = {
          configured: true,
          warning:
            'Bearer token set — add X_MONITORED_ACCOUNTS_JSON with [{ "id": "numeric_user_id", "username": "handle", "label": "Name" }, ...]. Find IDs via X developer portal or third-party lookup tools.',
          accounts: [],
          tweets: [],
          tickerBuzz: [],
          fetchedAt: new Date().toISOString(),
          cached: false
        };
        cachePayload = empty;
        cacheExpiresAt = Date.now() + 60_000;
        return empty;
      }

      const cap = Math.min(accounts.length, 6);
      const slice = accounts.slice(0, cap);
      const allTweets = [];

      for (const acc of slice) {
        try {
          const tweets = await fetchUserTweets(bearer, acc.id, 8);
          for (const tw of tweets) {
            allTweets.push({
              ...tw,
              monitorLabel: acc.label,
              monitorUsername: acc.username || tw.authorUsername
            });
          }
        } catch (err) {
          logger.warn(`X fetch failed for user ${acc.id}: ${err.message}`);
        }
      }

      allTweets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      const tickerBuzz = aggregateTickers(allTweets);

      const payload = {
        configured: true,
        warning: null,
        accounts: slice.map((a) => ({
          id: a.id,
          username: a.username,
          label: a.label
        })),
        tweets: allTweets.slice(0, 40),
        tickerBuzz,
        fetchedAt: new Date().toISOString(),
        cached: false
      };

      cachePayload = payload;
      cacheExpiresAt = Date.now() + ttlMs;
      return payload;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Recent posts from configured X monitors that cashtag the symbol (tool-backed for §11 dip emails).
 * @param {string} symbol
 * @returns {Promise<Array<{ id?: string, text: string, authorUsername?: string | null, createdAt?: string, monitorLabel?: string }>>}
 */
async function getXSnippetsForSymbol(symbol) {
  const sym = String(symbol || '')
    .trim()
    .toUpperCase();
  if (!sym) return [];

  const pulse = await getXPulse({ ttlMs: 90000 });
  const tweets = Array.isArray(pulse.tweets) ? pulse.tweets : [];
  const out = [];

  for (const tw of tweets) {
    const tags =
      Array.isArray(tw.cashtags) && tw.cashtags.length
        ? tw.cashtags
        : extractCashtags(tw.text || '');
    if (!tags.includes(sym)) continue;
    out.push({
      id: tw.id,
      text: tw.text || '',
      authorUsername: tw.authorUsername || null,
      createdAt: tw.createdAt,
      monitorLabel: tw.monitorLabel
    });
    if (out.length >= 12) break;
  }

  return out;
}

module.exports = {
  getXPulse,
  extractCashtags,
  getXSnippetsForSymbol
};
