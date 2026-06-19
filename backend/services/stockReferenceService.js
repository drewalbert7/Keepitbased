const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const PriceMonitor = require('./priceMonitor');

function getApiKey() {
  return config.POLYGON_API_KEY || config.MASSIVE_API_KEY;
}

/**
 * @param {string} path
 * @param {Record<string, string | number | boolean>} [params]
 */
async function polygonGet(path, params = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error('MARKET_DATA_UNAVAILABLE');
    err.code = 'NO_API_KEY';
    throw err;
  }
  const url = `${config.MARKET_DATA_API_URL}${path}`;
  const response = await axios.get(url, {
    params: { ...params, apiKey },
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'X-Polygon-API-Key': apiKey,
      'User-Agent': 'KeepItBased/1.0'
    },
    timeout: 12000
  });
  return response.data;
}

/**
 * When reference API is unavailable, accept symbols that return a stock snapshot.
 * @param {string} symbol
 * @returns {Promise<{ ticker: string, name: string }>}
 */
async function fallbackSnapshotValidate(symbol) {
  const pm = new PriceMonitor(null);
  const p = await pm.getStockPrice(symbol);
  if (!p || String(p.type).toLowerCase() !== 'stock') {
    const err = new Error(
      `Could not verify "${symbol}" as a tradeable stock. Configure POLYGON_API_KEY for full lookup, or check the ticker.`
    );
    err.statusCode = 400;
    throw err;
  }
  const t = String(p.symbol || symbol).toUpperCase();
  return { ticker: t, name: '' };
}

/**
 * Resolve symbol via Polygon reference; ensures active US equities listing.
 * @param {string} symbol - normalized uppercase ticker (may include dot)
 * @returns {Promise<{ ticker: string, name: string }>}
 */
async function assertTradableUsStock(symbol) {
  const upper = String(symbol || '').trim().toUpperCase();
  try {
    const data = await polygonGet(`/v3/reference/tickers/${encodeURIComponent(upper)}`);
    if (data.status !== 'OK' || !data.results) {
      const err = new Error(
        `Could not find "${upper}" in market listings. Search by company name or verify the ticker.`
      );
      err.statusCode = 400;
      throw err;
    }
    const r = data.results;
    if (r.market !== 'stocks') {
      const err = new Error(`"${upper}" is not a stock (e.g. crypto or FX). Only US stocks can be added here.`);
      err.statusCode = 400;
      throw err;
    }
    if (!r.active) {
      const err = new Error(`"${upper}" is not actively traded (delisted).`);
      err.statusCode = 400;
      throw err;
    }
    return {
      ticker: String(r.ticker || upper).toUpperCase(),
      name: String(r.name || '').trim()
    };
  } catch (e) {
    if (e.statusCode === 400) throw e;
    if (e.code === 'NO_API_KEY') {
      return fallbackSnapshotValidate(upper);
    }
    const status = e.response?.status;
    if (status === 404) {
      const err = new Error(
        `Could not find "${upper}" in market listings. Try the search box or another ticker.`
      );
      err.statusCode = 400;
      throw err;
    }
    if (status === 403) {
      logger.warn(`stock reference 403 for ${upper}; falling back to snapshot validation`);
      try {
        return await fallbackSnapshotValidate(upper);
      } catch (fallbackErr) {
        throw fallbackErr;
      }
    }
    logger.warn(`stock reference lookup failed for ${upper}: ${e.message}`);
    try {
      return await fallbackSnapshotValidate(upper);
    } catch (fallbackErr) {
      const err = new Error(
        `Could not verify "${upper}" right now. Try again, or search for the company to pick an exact ticker.`
      );
      err.statusCode = 400;
      throw err;
    }
  }
}

/**
 * @param {string} q
 * @returns {boolean}
 */
function looksLikeTicker(q) {
  const s = String(q || '').trim();
  return /^[A-Z][A-Z0-9.\-]{0,9}$/i.test(s);
}

const SEARCH_STOP_WORDS = new Set([
  'and',
  'or',
  'the',
  'a',
  'an',
  'of',
  'for',
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'company',
  'co',
  'ltd',
  'limited',
  'plc',
  'group',
  'holdings',
  'holding',
  'common',
  'stock',
  'stocks',
  'shares',
  'share',
  'class',
  'ordinary',
  'preferred',
  'capital'
]);

/** Brand / colloquial names Massive text search often misses. Keys are normalized. */
const COMPANY_ALIASES = {
  google: 'GOOGL',
  jpmorgan: 'JPM',
  'jp morgan': 'JPM',
  mcdonalds: 'MCD',
  mcdonald: 'MCD',
  facebook: 'META',
  fb: 'META',
  'coca cola': 'KO',
  'coca-cola': 'KO',
  cocacola: 'KO',
  'johnson and johnson': 'JNJ',
  'johnson johnson': 'JNJ',
  'berkshire hathaway': 'BRK.B',
  berkshire: 'BRK.B',
  walmart: 'WMT',
  'wells fargo': 'WFC',
  'bank of america': 'BAC',
  'home depot': 'HD',
  'united health': 'UNH',
  unitedhealth: 'UNH',
  unitedhealthcare: 'UNH'
};

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeSearchQuery(raw) {
  let q = String(raw || '')
    .trim()
    .toLowerCase();
  q = q.replace(/&/g, ' and ');
  q = q.replace(/[''´`]/g, '');
  q = q.replace(/[^\w\s.-]/g, ' ');
  return q.replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} normalized
 * @returns {string[]}
 */
function significantTokens(normalized) {
  const tokens = normalized.split(/\s+/).filter((t) => t.length >= 2 && !SEARCH_STOP_WORDS.has(t));
  const seen = new Set();
  const out = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.sort((a, b) => b.length - a.length);
}

/**
 * @param {string} normalized
 * @returns {string | null}
 */
function resolveAliasTicker(normalized) {
  if (!normalized) return null;
  if (COMPANY_ALIASES[normalized]) return COMPANY_ALIASES[normalized];
  const compact = normalized.replace(/[\s.-]+/g, '');
  if (COMPANY_ALIASES[compact]) return COMPANY_ALIASES[compact];
  return null;
}

/**
 * @param {string} normalized
 * @returns {string[]}
 */
function buildSearchTerms(normalized) {
  const terms = new Set();
  if (normalized) terms.add(normalized);

  const stripped = significantTokens(normalized).join(' ');
  if (stripped) terms.add(stripped);

  for (const token of significantTokens(normalized)) {
    if (token.length >= 3) terms.add(token);
  }

  return [...terms].slice(0, 5);
}

/**
 * Prefer exact tickers and common stock over ETF / preferred noise from Massive text search.
 * @param {string} query
 * @param {object} row
 * @returns {number}
 */
function scoreSearchHit(query, row) {
  const normalized = normalizeSearchQuery(query);
  const tokens = significantTokens(normalized);
  const qUpper = normalized.toUpperCase();
  const ticker = String(row.ticker || '').toUpperCase();
  const name = String(row.name || '').toLowerCase();
  let score = 0;

  if (ticker === qUpper) score += 1200;
  else if (looksLikeTicker(query) && ticker.startsWith(qUpper)) score += 900;
  else if (name.startsWith(normalized)) score += 850;
  else if (tokens.length && name.startsWith(tokens[0])) score += 750;
  else if (ticker.startsWith(qUpper)) score += 500;
  else if (name.includes(normalized)) score += 650;
  else score += 40;

  let tokenMatches = 0;
  for (const token of tokens) {
    if (name.includes(token) || ticker.includes(token.toUpperCase())) tokenMatches += 1;
  }
  score += tokenMatches * 180;
  if (tokens.length > 0 && tokenMatches === tokens.length) score += 450;

  const alias = resolveAliasTicker(normalized);
  if (alias && ticker === alias.toUpperCase()) score += 900;

  const type = String(row.type || '').toUpperCase();
  if (type === 'CS' || type === 'ADRC') score += 120;
  else if (type === 'ETF' || type === 'ETN' || type === 'ETS') score -= 280;
  else if (['WARRANT', 'PFD', 'RIGHT', 'RIGHTS', 'UNIT', 'SP', 'SPAC'].includes(type)) score -= 220;

  if (!looksLikeTicker(query)) {
    if (/\.(WS|W|U|R)$/i.test(ticker) || /p[A-Z]$/.test(ticker)) score -= 180;
    if (ticker.includes('.') && !ticker.match(/^(BRK\.[AB])$/)) score -= 60;
  }

  if (row.primary_exchange && ['XNAS', 'XNYS', 'ARCX', 'BATS'].includes(String(row.primary_exchange))) {
    score += 15;
  }
  return score;
}

/**
 * @param {string} query
 * @param {Array<object>} rows
 * @param {number} [limit]
 */
function rankSearchResults(query, rows, limit = 12) {
  const seen = new Set();
  const out = [];
  for (const row of [...(rows || [])].sort((a, b) => scoreSearchHit(query, b) - scoreSearchHit(query, a))) {
    const ticker = String(row.ticker || '').toUpperCase();
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * @param {object} r
 */
function mapReferenceRow(r) {
  return {
    ticker: String(r.ticker).toUpperCase(),
    name: String(r.name || '').trim(),
    primary_exchange: String(r.primary_exchange || ''),
    type: String(r.type || '')
  };
}

/**
 * @param {string} ticker
 * @returns {Promise<object | null>}
 */
async function fetchExactTickerRow(ticker) {
  const exact = String(ticker || '').trim().toUpperCase();
  if (!exact) return null;
  try {
    const data = await polygonGet(`/v3/reference/tickers/${encodeURIComponent(exact)}`);
    if (data.status === 'OK' && data.results && data.results.market === 'stocks' && data.results.active) {
      return mapReferenceRow(data.results);
    }
  } catch (e) {
    if (e.response?.status !== 404) {
      logger.warn(`exact ticker lookup failed for ${exact}: ${e.message}`);
    }
  }
  return null;
}

/**
 * @param {string} term
 * @returns {Promise<object[]>}
 */
async function fetchSearchRows(term) {
  const q = String(term || '').trim();
  if (!q) return [];
  try {
    const data = await polygonGet('/v3/reference/tickers', {
      search: q,
      market: 'stocks',
      active: true,
      limit: 50
    });
    if (data.status !== 'OK' || !Array.isArray(data.results)) return [];
    return data.results
      .filter((r) => r && r.market === 'stocks' && r.active === true && r.ticker)
      .map(mapReferenceRow);
  } catch (e) {
    logger.warn(`stock search failed for "${q}": ${e.message}`);
    return [];
  }
}

/**
 * @param {string} rawQuery
 * @returns {Promise<Array<{ ticker: string; name: string; primary_exchange: string }>>}
 */
async function searchUsStocks(rawQuery) {
  const q = String(rawQuery || '')
    .trim()
    .slice(0, 64);
  if (q.length < 1) return [];

  if (!getApiKey()) {
    return [];
  }

  const normalized = normalizeSearchQuery(q);
  const merged = [];
  const pushRow = (row) => {
    if (row && row.ticker) merged.push(row);
  };

  const aliasTicker = resolveAliasTicker(normalized);
  if (aliasTicker) {
    pushRow(await fetchExactTickerRow(aliasTicker));
  }

  if (looksLikeTicker(q)) {
    pushRow(await fetchExactTickerRow(q));
  }

  const searchTerms = buildSearchTerms(normalized);
  const searchResults = await Promise.all(searchTerms.map((term) => fetchSearchRows(term)));
  for (const rows of searchResults) {
    for (const row of rows) pushRow(row);
  }

  if (!merged.length) return [];

  return rankSearchResults(q, merged, 12).map(({ ticker, name, primary_exchange }) => ({
    ticker,
    name,
    primary_exchange
  }));
}

module.exports = {
  assertTradableUsStock,
  searchUsStocks,
  getApiKey,
  normalizeSearchQuery,
  significantTokens,
  resolveAliasTicker,
  scoreSearchHit
};
