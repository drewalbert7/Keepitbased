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

/**
 * Prefer exact tickers and common stock over ETF noise from Massive text search.
 * @param {string} query
 * @param {object} row
 * @returns {number}
 */
function scoreSearchHit(query, row) {
  const q = String(query || '').trim().toUpperCase();
  const ql = String(query || '').trim().toLowerCase();
  const ticker = String(row.ticker || '').toUpperCase();
  const name = String(row.name || '').toLowerCase();
  let score = 0;

  if (ticker === q) score += 1000;
  else if (ticker.startsWith(q)) score += 800;
  else if (name.startsWith(ql)) score += 700;
  else if (ticker.includes(q)) score += 400;
  else if (name.includes(ql)) score += 300;
  else score += 50;

  const type = String(row.type || '').toUpperCase();
  if (type === 'CS' || type === 'ADRC') score += 80;
  else if (type === 'ETF' || type === 'ETN' || type === 'ETS') score -= 30;

  if (row.primary_exchange && ['XNAS', 'XNYS', 'ARCX', 'BATS'].includes(String(row.primary_exchange))) {
    score += 10;
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
 * @param {string} rawQuery
 * @returns {Promise<Array<{ ticker: string; name: string; primary_exchange: string }>>}
 */
async function searchUsStocks(rawQuery) {
  const q = String(rawQuery || '')
    .trim()
    .slice(0, 64);
  if (q.length < 1) return [];

  const apiKey = getApiKey();
  if (!apiKey) {
    return [];
  }

  const merged = [];

  if (looksLikeTicker(q)) {
    const exact = String(q).toUpperCase();
    try {
      const data = await polygonGet(`/v3/reference/tickers/${encodeURIComponent(exact)}`);
      if (data.status === 'OK' && data.results && data.results.market === 'stocks' && data.results.active) {
        merged.push(mapReferenceRow(data.results));
      }
    } catch (e) {
      if (e.response?.status !== 404) {
        logger.warn(`exact ticker lookup failed for ${exact}: ${e.message}`);
      }
    }
  }

  try {
    const data = await polygonGet('/v3/reference/tickers', {
      search: q,
      market: 'stocks',
      active: true,
      limit: 50
    });
    if (data.status === 'OK' && Array.isArray(data.results)) {
      for (const r of data.results) {
        if (r && r.market === 'stocks' && r.active === true && r.ticker) {
          merged.push(mapReferenceRow(r));
        }
      }
    }
  } catch (e) {
    logger.warn(`stock search failed: ${e.message}`);
    if (!merged.length) return [];
  }

  return rankSearchResults(q, merged, 12).map(({ ticker, name, primary_exchange }) => ({
    ticker,
    name,
    primary_exchange
  }));
}

module.exports = {
  assertTradableUsStock,
  searchUsStocks,
  getApiKey
};
