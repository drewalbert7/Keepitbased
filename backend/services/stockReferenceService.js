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

  try {
    const data = await polygonGet('/v3/reference/tickers', {
      search: q,
      market: 'stocks',
      active: true,
      limit: 15,
      sort: 'ticker',
      order: 'asc'
    });
    if (data.status !== 'OK' || !Array.isArray(data.results)) {
      return [];
    }
    return data.results
      .filter((r) => r && r.market === 'stocks' && r.active === true && r.ticker)
      .map((r) => ({
        ticker: String(r.ticker).toUpperCase(),
        name: String(r.name || '').trim(),
        primary_exchange: String(r.primary_exchange || '')
      }))
      .slice(0, 12);
  } catch (e) {
    logger.warn(`stock search failed: ${e.message}`);
    return [];
  }
}

module.exports = {
  assertTradableUsStock,
  searchUsStocks,
  getApiKey
};
