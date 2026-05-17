const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const { TW_ENGLISH_ALIASES } = require('../utils/stockMarketIdentity');

const TW_SYMBOL_CACHE_MS = 60 * 60 * 1000;
let twSymbolCache = { loadedAt: 0, rows: [] };

function isConfigured() {
  return Boolean(String(config.ITICK_API_TOKEN || '').trim());
}

function baseUrl() {
  return String(config.ITICK_API_BASE_URL || 'https://api.itick.io').replace(/\/$/, '');
}

function headers() {
  return {
    accept: 'application/json',
    token: String(config.ITICK_API_TOKEN || '').trim()
  };
}

/**
 * @param {unknown} body
 */
function unwrapData(body) {
  if (body == null) return null;
  if (body.data != null && typeof body.data === 'object') return body.data;
  return body;
}

/**
 * @param {string} region — e.g. TW
 * @param {string} code — numeric product code
 */
async function getStockTick(region, code) {
  if (!isConfigured()) {
    throw new Error('ITICK_API_TOKEN is not configured');
  }
  const { data } = await axios.get(`${baseUrl()}/stock/tick`, {
    params: { region, code: String(code).replace(/\D/g, '') },
    headers: headers(),
    timeout: config.ITICK_REQUEST_TIMEOUT_MS
  });
  const row = unwrapData(data);
  if (!row) return null;
  const price = Number(row.ld ?? row.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const ts = Number(row.t);
  return {
    price,
    timestamp: Number.isFinite(ts) && ts > 0 ? (ts > 1e12 ? ts : ts * 1000) : Date.now(),
    volume: row.v != null ? Number(row.v) : null
  };
}

/**
 * @param {string} region
 * @param {string} code
 * @param {number} kType — iTick kline type (8 = 1 day)
 * @param {number} limit
 */
async function getStockKlines(region, code, kType, limit) {
  if (!isConfigured()) {
    throw new Error('ITICK_API_TOKEN is not configured');
  }
  const { data } = await axios.get(`${baseUrl()}/stock/kline`, {
    params: {
      region,
      code: String(code).replace(/\D/g, ''),
      kType,
      limit
    },
    headers: headers(),
    timeout: config.ITICK_REQUEST_TIMEOUT_MS
  });
  const raw = unwrapData(data);
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.klines) ? raw.klines : [];
  return arr
    .map((b) => ({
      t: Number(b.t),
      o: Number(b.o),
      h: Number(b.h),
      l: Number(b.l),
      c: Number(b.c),
      v: b.v != null ? Number(b.v) : null
    }))
    .filter((b) => Number.isFinite(b.c) && b.c > 0);
}

/**
 * @param {string} region
 * @param {string} [code] — optional filter / prefix
 */
function mapSymbolRow(row) {
  return {
    code: String(row.c || row.code || '').replace(/\D/g, ''),
    name: String(row.n || row.name || '').trim(),
    exchange: String(row.e || row.exchange || '').trim()
  };
}

async function searchSymbolList(region, code) {
  if (!isConfigured()) return [];
  const params = { type: 'stock', region };
  const digits = code ? String(code).replace(/\D/g, '') : '';
  if (digits) params.code = digits;
  const { data } = await axios.get(`${baseUrl()}/symbol/list`, {
    params,
    headers: headers(),
    timeout: config.ITICK_REQUEST_TIMEOUT_MS
  });
  const raw = unwrapData(data);
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map(mapSymbolRow).filter((row) => row.code.length >= 4);
}

async function loadAllTwSymbols() {
  if (!isConfigured()) return [];
  const age = Date.now() - twSymbolCache.loadedAt;
  if (age >= 0 && age < TW_SYMBOL_CACHE_MS && twSymbolCache.rows.length > 0) {
    return twSymbolCache.rows;
  }
  const params = { type: 'stock', region: 'TW' };
  const { data } = await axios.get(`${baseUrl()}/symbol/list`, {
    params,
    headers: headers(),
    timeout: config.ITICK_REQUEST_TIMEOUT_MS
  });
  const raw = unwrapData(data);
  const arr = Array.isArray(raw) ? raw : [];
  const rows = arr.map(mapSymbolRow).filter((row) => row.code.length >= 4);
  twSymbolCache = { loadedAt: Date.now(), rows };
  return rows;
}

/**
 * Search TWSE/TPEX by numeric code, Chinese name substring, or English alias (e.g. FOCI).
 * @param {string} query
 * @param {number} [limit]
 */
async function searchTaiwanSymbols(query, limit = 25) {
  if (!isConfigured()) return [];
  const q = String(query || '').trim();
  if (!q) return [];

  const upper = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const digits = q.replace(/\D/g, '');
  const out = [];
  const seen = new Set();

  const push = (row, meta = {}) => {
    if (!row?.code || seen.has(row.code)) return;
    seen.add(row.code);
    out.push({ ...row, ...meta });
  };

  const aliasCode = TW_ENGLISH_ALIASES[upper];
  if (aliasCode) {
    const exact = await searchSymbolList('TW', aliasCode);
    if (exact[0]) {
      push(exact[0], { matchedAlias: upper });
    } else {
      push({ code: aliasCode, name: '', exchange: 'TW' }, { matchedAlias: upper });
    }
  }

  if (digits.length >= 2) {
    for (const row of await searchSymbolList('TW', digits)) {
      push(row);
    }
  }

  if (out.length < limit && /[^\d]/.test(q)) {
    const needle = q.toLowerCase();
    const all = await loadAllTwSymbols();
    for (const row of all) {
      if (out.length >= limit * 2) break;
      if (row.name.toLowerCase().includes(needle)) {
        push(row, { matchedName: true });
      }
    }
  }

  return out.slice(0, limit);
}

/**
 * Taiwan (TWSE) quote shaped like PriceMonitor stock payload.
 * @param {string} code — e.g. 2330
 */
async function fetchTaiwanStockPriceRow(code) {
  const digits = String(code).replace(/\D/g, '');
  const tick = await getStockTick('TW', digits);
  if (!tick) return null;

  let change = null;
  let changePercent = null;
  let prevClose = null;
  let dayOpen = null;
  let dayHigh = null;
  let dayLow = null;

  try {
    const bars = await getStockKlines('TW', digits, 8, 2);
    if (bars.length >= 1) {
      const last = bars[bars.length - 1];
      dayOpen = Number.isFinite(last.o) ? last.o : null;
      dayHigh = Number.isFinite(last.h) ? last.h : null;
      dayLow = Number.isFinite(last.l) ? last.l : null;
    }
    if (bars.length >= 2) {
      prevClose = bars[bars.length - 2].c;
      if (Number.isFinite(prevClose) && prevClose > 0) {
        change = tick.price - prevClose;
        changePercent = (change / prevClose) * 100;
      }
    }
  } catch (e) {
    logger.warn(`iTick TW kline fallback for ${digits}: ${e.message}`);
  }

  const alertSymbol = `TW:${digits}`;
  return {
    symbol: alertSymbol,
    market: 'TW',
    itickCode: digits,
    price: tick.price,
    change24h: change,
    changePercent,
    prevClose,
    dayOpen,
    dayHigh,
    dayLow,
    volume: tick.volume,
    timestamp: tick.timestamp,
    type: 'stock',
    sourceUsed: 'itick_tw'
  };
}

module.exports = {
  isConfigured,
  getStockTick,
  getStockKlines,
  searchSymbolList,
  searchTaiwanSymbols,
  fetchTaiwanStockPriceRow
};
