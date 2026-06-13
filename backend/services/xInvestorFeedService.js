const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config');
const trustedXTradersService = require('./trustedXTradersService');

/** Per-key in-memory cache + single-flight lock */
const cacheByKey = new Map();
const inflightByKey = new Map();

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
        label: String(a.label || a.name || '').trim() || 'Source',
        source: 'env'
      }))
      .filter((a) => /^\d+$/.test(a.id));
  } catch (e) {
    logger.warn('X_MONITORED_ACCOUNTS_JSON invalid JSON', e.message);
    return [];
  }
}

function mergeMonitoredAccounts(userAccounts, envAccounts) {
  const seen = new Set();
  const out = [];
  for (const acc of [...userAccounts, ...envAccounts]) {
    if (!acc?.id || seen.has(acc.id)) continue;
    seen.add(acc.id);
    out.push(acc);
  }
  return out;
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

function cacheKeyFor(userId) {
  return userId ? `user:${userId}` : 'env';
}

function emptyPulse({ configured, warning, bearerPresent }) {
  return {
    configured: Boolean(configured),
    bearerPresent: Boolean(bearerPresent),
    warning: warning || null,
    accounts: [],
    tweets: [],
    tickerBuzz: [],
    fetchedAt: new Date().toISOString(),
    cached: false
  };
}

/**
 * Returns cached-or-fresh X pulse for monitored investor accounts.
 * When userId is set, merges UI-configured trusted traders with env X_MONITORED_ACCOUNTS_JSON.
 */
async function getXPulse({ userId, ttlMs = 90000 } = {}) {
  const key = cacheKeyFor(userId);
  const now = Date.now();
  const cached = cacheByKey.get(key);
  if (cached && now < cached.expiresAt) {
    return { ...cached.payload, cached: true };
  }
  if (inflightByKey.get(key)) return inflightByKey.get(key);

  const bearer = config.X_API_BEARER_TOKEN || process.env.X_API_BEARER_TOKEN || '';

  const job = (async () => {
    try {
      const envAccounts = parseMonitoredAccounts();
      let userAccounts = [];
      if (userId) {
        try {
          userAccounts = await trustedXTradersService.accountsForPulse(userId);
        } catch (err) {
          logger.warn(`Trusted X traders load failed for user ${userId}: ${err.message}`);
        }
      }
      const accounts = mergeMonitoredAccounts(userAccounts, envAccounts);

      if (!bearer) {
        const payload = emptyPulse({
          configured: false,
          bearerPresent: false,
          warning:
            'Add X_API_BEARER_TOKEN on the server to fetch posts from trusted X traders you add below.'
        });
        cacheByKey.set(key, { payload, expiresAt: Date.now() + 60_000 });
        return payload;
      }

      if (accounts.length === 0) {
        const payload = emptyPulse({
          configured: true,
          bearerPresent: true,
          warning: userId
            ? 'Add trusted trader @handles below — their cashtags feed learning and the bot universe.'
            : 'Bearer token set — add trusted traders in the learning lab or X_MONITORED_ACCOUNTS_JSON in env.'
        });
        cacheByKey.set(key, { payload, expiresAt: Date.now() + 60_000 });
        return payload;
      }

      const cap = Math.min(accounts.length, 8);
      const slice = accounts.slice(0, cap);
      const allTweets = [];

      for (const acc of slice) {
        try {
          if (acc.viaXSearch || !/^\d+$/.test(String(acc.id))) {
            continue;
          }
          const tweets = await fetchUserTweets(bearer, acc.id, 8);
          for (const tw of tweets) {
            allTweets.push({
              ...tw,
              monitorLabel: acc.label,
              monitorUsername: acc.username || tw.authorUsername,
              monitorSource: acc.source || 'env'
            });
          }
        } catch (err) {
          logger.warn(`X fetch failed for user ${acc.id}: ${err.message}`);
        }
      }

      allTweets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      const payload = {
        configured: true,
        bearerPresent: true,
        warning: null,
        accounts: slice.map((a) => ({
          id: a.id,
          username: a.username,
          label: a.label,
          source: a.source || 'env'
        })),
        tweets: allTweets.slice(0, 40),
        tickerBuzz: aggregateTickers(allTweets),
        fetchedAt: new Date().toISOString(),
        cached: false
      };

      cacheByKey.set(key, { payload, expiresAt: Date.now() + ttlMs });
      return payload;
    } finally {
      inflightByKey.delete(key);
    }
  })();

  inflightByKey.set(key, job);
  return job;
}

function invalidateXPulseCache(userId) {
  if (userId) cacheByKey.delete(cacheKeyFor(userId));
  cacheByKey.delete(cacheKeyFor(null));
}

/**
 * Recent posts from configured X monitors that cashtag the symbol (tool-backed for §11 dip emails).
 */
async function getXSnippetsForSymbol(symbol, { userId } = {}) {
  const sym = String(symbol || '')
    .trim()
    .toUpperCase();
  if (!sym) return [];

  const pulse = await getXPulse({ userId, ttlMs: 90000 });
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
  invalidateXPulseCache,
  extractCashtags,
  getXSnippetsForSymbol,
  parseMonitoredAccounts
};
