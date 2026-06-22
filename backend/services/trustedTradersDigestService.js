const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const { resolveQuantAgiBaseUrl } = require('../utils/quantAgiBaseUrl');
const trustedXTradersService = require('./trustedXTradersService');

const CASHTAG_RE = /\$([A-Z]{1,5})\b/g;
const MAX_POSTS_TOTAL = 10;
const MAX_POSTS_PER_TRADER = 3;

function extractCashtags(text) {
  const set = new Set();
  for (const m of String(text || '').matchAll(CASHTAG_RE)) {
    set.add(m[1]);
  }
  return [...set];
}

function normalizePostUrl(raw, handle) {
  const url = String(raw || '').trim();
  if (url && /^https?:\/\//i.test(url)) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, '').toLowerCase();
      if (host === 'x.com' || host === 'twitter.com') return u.href;
    } catch {
      /* fall through */
    }
  }
  const h = String(handle || '')
    .replace(/^@/, '')
    .toLowerCase();
  return h ? `https://x.com/${h}` : null;
}

async function fetchPostsForHandles(handles) {
  const uniq = [...new Set(handles.map((h) => String(h || '').replace(/^@/, '').toLowerCase()).filter(Boolean))];
  if (!uniq.length) return [];

  const base = resolveQuantAgiBaseUrl();
  try {
    const { data } = await axios.post(
      `${base}/bot/x-trusted-posts`,
      { handles: uniq.slice(0, trustedXTradersService.MAX_TRUSTED) },
      { timeout: Math.max(config.QUANT_AGI_RANK_TIMEOUT_MS || 45000, 90000) }
    );
    return Array.isArray(data?.posts) ? data.posts : [];
  } catch (err) {
    logger.warn(`Trusted traders digest x_search failed: ${err.message}`);
    return [];
  }
}

/**
 * Group posts by trader and pick top recommendations (most cashtags, then order returned).
 * @param {Array<object>} traders
 * @param {Array<object>} posts
 */
function buildTraderSections(traders, posts) {
  const byHandle = new Map();
  for (const t of traders) {
    byHandle.set(String(t.username).toLowerCase(), {
      username: t.username,
      label: t.label || t.username,
      posts: []
    });
  }

  for (const raw of posts) {
    const handle = String(raw.monitor_username || raw.author || '')
      .replace(/^@/, '')
      .toLowerCase();
    const bucket = byHandle.get(handle);
    if (!bucket) continue;
    const snippet = String(raw.snippet || raw.title || '').trim();
    const cashtags = extractCashtags(snippet);
    bucket.posts.push({
      url: normalizePostUrl(raw.url, handle),
      snippet: snippet.slice(0, 280),
      cashtags,
      title: String(raw.title || '').trim()
    });
  }

  const sections = [];
  let total = 0;
  for (const bucket of byHandle.values()) {
    bucket.posts.sort((a, b) => b.cashtags.length - a.cashtags.length || b.snippet.length - a.snippet.length);
    const picked = bucket.posts.slice(0, MAX_POSTS_PER_TRADER);
    if (!picked.length) continue;
    const room = MAX_POSTS_TOTAL - total;
    if (room <= 0) break;
    const slice = picked.slice(0, room);
    total += slice.length;
    sections.push({
      username: bucket.username,
      label: bucket.label,
      posts: slice
    });
  }
  return sections;
}

function aggregateTickerBuzz(sections) {
  const counts = new Map();
  for (const sec of sections) {
    for (const p of sec.posts) {
      for (const sym of p.cashtags || []) {
        counts.set(sym, (counts.get(sym) || 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([symbol, mentions]) => ({ symbol, mentions }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 8);
}

/**
 * Per-user trusted trader posts for daily digest email.
 * @param {number} userId
 */
async function fetchTrustedTradersDigestForEmail(userId) {
  const traders = await trustedXTradersService.listTrustedTraders(userId);
  if (!traders.length) {
    return { traders: [], sections: [], tickerBuzz: [], summaryLine: null };
  }

  const posts = await fetchPostsForHandles(traders.map((t) => t.username));
  const sections = buildTraderSections(traders, posts);
  const tickerBuzz = aggregateTickerBuzz(sections);

  let summaryLine = null;
  if (tickerBuzz.length) {
    summaryLine = `Tickers your trusted traders mentioned: ${tickerBuzz.map((r) => `$${r.symbol}`).join(', ')}`;
  } else if (sections.length) {
    summaryLine = 'Recent posts from your trusted X traders — tap each link for the full thread.';
  }

  return {
    traders: traders.map((t) => ({ username: t.username, label: t.label || t.username })),
    sections,
    tickerBuzz,
    summaryLine,
    postCount: sections.reduce((n, s) => n + s.posts.length, 0)
  };
}

module.exports = {
  fetchTrustedTradersDigestForEmail,
  buildTraderSections,
  extractCashtags,
  normalizePostUrl
};
