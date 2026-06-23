const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const { resolveQuantAgiBaseUrl } = require('../utils/quantAgiBaseUrl');
const trustedXTradersService = require('./trustedXTradersService');

const CASHTAG_RE = /\$([A-Z]{1,5})\b/g;
const HANDLE_FROM_X_URL_RE = /(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})(?:\/status\/|\/i\/status\/)/i;
const MAX_POSTS_TOTAL = 10;
const MAX_POSTS_PER_TRADER = 3;

function extractCashtags(text) {
  const set = new Set();
  for (const m of String(text || '').matchAll(CASHTAG_RE)) {
    set.add(m[1]);
  }
  return [...set];
}

function normalizeHandle(raw) {
  return String(raw || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
}

function handleFromXUrl(raw) {
  const m = String(raw || '').match(HANDLE_FROM_X_URL_RE);
  return m ? m[1].toLowerCase() : '';
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
  const h = normalizeHandle(handle);
  return h ? `https://x.com/${h}` : null;
}

function resolvePostHandle(raw) {
  const fromMonitor = normalizeHandle(raw.monitor_username);
  if (fromMonitor) return fromMonitor;
  const fromAuthor = normalizeHandle(raw.author);
  if (fromAuthor) return fromAuthor;
  return handleFromXUrl(raw.url);
}

async function fetchPostsForHandles(handles) {
  const uniq = [...new Set(handles.map((h) => normalizeHandle(h)).filter(Boolean))];
  if (!uniq.length) {
    return { posts: [], error: null, errorCode: null, xSearch: false };
  }

  const base = resolveQuantAgiBaseUrl();
  try {
    const { data } = await axios.post(
      `${base}/bot/x-trusted-posts`,
      { handles: uniq.slice(0, trustedXTradersService.MAX_TRUSTED) },
      { timeout: Math.max(config.QUANT_AGI_RANK_TIMEOUT_MS || 45000, 90000) }
    );
    return {
      posts: Array.isArray(data?.posts) ? data.posts : [],
      error: data?.error ? String(data.error) : null,
      errorCode: data?.error_code ? String(data.error_code) : null,
      xSearch: Boolean(data?.x_search)
    };
  } catch (err) {
    const msg = err.response?.data?.error || err.response?.data?.message || err.message;
    logger.warn(`Trusted traders digest x_search failed: ${msg}`);
    return {
      posts: [],
      error: String(msg),
      errorCode: 'request_failed',
      xSearch: false
    };
  }
}

/**
 * Group posts by trader and pick top recommendations (most cashtags, then order returned).
 * @param {Array<object>} traders
 * @param {Array<object>} posts
 */
function buildTraderSections(traders, posts) {
  const byHandle = new Map();
  const trustedSet = new Set();
  for (const t of traders) {
    const h = normalizeHandle(t.username);
    trustedSet.add(h);
    byHandle.set(h, {
      username: t.username,
      label: t.label || t.username,
      posts: []
    });
  }

  for (const raw of posts) {
    const handle = resolvePostHandle(raw);
    if (!handle || !trustedSet.has(handle)) continue;
    const bucket = byHandle.get(handle);
    if (!bucket) continue;
    const snippet = String(raw.snippet || raw.text || raw.title || '').trim();
    const url = normalizePostUrl(raw.url, handle);
    const cashtags = extractCashtags(snippet);
    bucket.posts.push({
      url,
      snippet: snippet.slice(0, 280),
      cashtags,
      title: String(raw.title || '').trim(),
      source: raw.source || 'x_search'
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
 * When dedicated x_search returns nothing, reuse digest Grok xPostLinks for trusted handles.
 */
function supplementTrustedDigestFromDigestLinks(pack, digest) {
  if (!pack?.traders?.length || !digest || typeof digest !== 'object') return pack;
  if (pack.sections?.length) return pack;

  const links = Array.isArray(digest.xPostLinks) ? digest.xPostLinks : [];
  if (!links.length) return pack;

  const trustedHandles = new Set(pack.traders.map((t) => normalizeHandle(t.username)));
  const supplementalPosts = [];
  for (const link of links) {
    if (!link || typeof link !== 'object') continue;
    const url = String(link.url || '').trim();
    const handle = handleFromXUrl(url);
    if (!handle || !trustedHandles.has(handle)) continue;
    supplementalPosts.push({
      monitor_username: handle,
      url,
      snippet: String(link.note || '').trim(),
      title: String(link.note || `@${handle}: post`).trim(),
      source: 'digest_x_post_links'
    });
  }

  if (!supplementalPosts.length) return pack;

  const sections = buildTraderSections(pack.traders, supplementalPosts);
  if (!sections.length) return pack;

  const tickerBuzz = aggregateTickerBuzz(sections);
  return {
    ...pack,
    sections,
    tickerBuzz,
    postCount: sections.reduce((n, s) => n + s.posts.length, 0),
    summaryLine: tickerBuzz.length
      ? `Tickers your trusted traders mentioned: ${tickerBuzz.map((r) => `$${r.symbol}`).join(', ')}`
      : 'Recent posts from your trusted X traders (from daily digest x_search links).',
    supplementedFromDigest: true
  };
}

function userFacingFetchError(error, errorCode) {
  if (!error) return null;
  const lower = String(error).toLowerCase();
  if (
    errorCode === 'credits_or_permission' ||
    lower.includes('spending limit') ||
    lower.includes('available credits') ||
    lower.includes('permission-denied')
  ) {
    return 'Grok x_search is temporarily unavailable (xAI API credits or spending limit). Posts will return when the API quota is restored.';
  }
  if (errorCode === 'disabled' || errorCode === 'no_api_key') {
    return 'Grok x_search is not configured on the server (set XAI_API_KEY or GROK_API_KEY on quant-agi-api).';
  }
  return `Could not fetch trusted trader posts this run: ${String(error).slice(0, 220)}`;
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

  const fetchResult = await fetchPostsForHandles(traders.map((t) => t.username));
  const sections = buildTraderSections(traders, fetchResult.posts);
  const tickerBuzz = aggregateTickerBuzz(sections);

  let summaryLine = null;
  if (tickerBuzz.length) {
    summaryLine = `Tickers your trusted traders mentioned: ${tickerBuzz.map((r) => `$${r.symbol}`).join(', ')}`;
  } else if (sections.length) {
    summaryLine = 'Recent posts from your trusted X traders — tap each link for the full thread.';
  }

  const fetchError = sections.length ? null : userFacingFetchError(fetchResult.error, fetchResult.errorCode);

  return {
    traders: traders.map((t) => ({ username: t.username, label: t.label || t.username })),
    sections,
    tickerBuzz,
    summaryLine,
    postCount: sections.reduce((n, s) => n + s.posts.length, 0),
    fetchError,
    xSearchEnabled: fetchResult.xSearch
  };
}

module.exports = {
  fetchTrustedTradersDigestForEmail,
  supplementTrustedDigestFromDigestLinks,
  buildTraderSections,
  extractCashtags,
  normalizePostUrl,
  handleFromXUrl
};
