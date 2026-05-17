const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const REQUEST_MS = Number(process.env.OPENBB_HTTP_TIMEOUT_MS || 28000);
const OPENBB_DOWN_COOLDOWN_MS = Number(process.env.OPENBB_DOWN_COOLDOWN_MS || 60000);

/** Skip OpenBB HTTP when sidecar was recently unreachable (watchlist opens many parallel quotes). */
let openbbSkipUntil = 0;
let openbbReachableAt = 0;
let openbbReachableCached = false;
let openbbDownLogged = false;

function isEnabled() {
  return config.OPENBB_ENABLED === true;
}

function client() {
  const baseURL = String(config.OPENBB_API_URL || 'http://127.0.0.1:6900').replace(/\/$/, '');
  const prefix = String(config.OPENBB_API_PREFIX || '/api/v1').replace(/\/$/, '');
  return { baseURL, prefix };
}

function quoteExclusiveEffective() {
  return config.OPENBB_STOCK_QUOTE_EXCLUSIVE === true;
}

function stockHistoryExclusiveEffective() {
  return config.OPENBB_STOCK_HISTORY_EXCLUSIVE === true;
}

function cryptoExclusiveEffective() {
  return config.OPENBB_CRYPTO_EXCLUSIVE === true;
}

/**
 * Lightweight reachability probe (Swagger always exists when server is up).
 */
async function probeStatus() {
  if (!isEnabled()) return { ok: false, reason: 'disabled' };
  const { baseURL } = client();
  try {
    await axios.get(`${baseURL}/docs`, {
      timeout: 3000,
      validateStatus: (s) => s === 200
    });
    return { ok: true, url: baseURL };
  } catch (_e) {
    try {
      await axios.get(`${baseURL}/openapi.json`, {
        timeout: 3000,
        validateStatus: (s) => s === 200
      });
      return { ok: true, url: baseURL };
    } catch (e2) {
      return { ok: false, url: baseURL, error: e2.message };
    }
  }
}

async function isSidecarReachable() {
  if (!isEnabled()) return false;
  const now = Date.now();
  if (now < openbbSkipUntil) return false;
  if (openbbReachableCached && now - openbbReachableAt < 30000) return true;

  const probe = await probeStatus();
  openbbReachableCached = probe.ok === true;
  openbbReachableAt = now;

  if (!openbbReachableCached) {
    openbbSkipUntil = now + OPENBB_DOWN_COOLDOWN_MS;
    if (!openbbDownLogged) {
      logger.warn(
        `OpenBB sidecar unreachable at ${probe.url || client().baseURL} (${probe.error || probe.reason}); using Massive/Polygon fallback for ${OPENBB_DOWN_COOLDOWN_MS / 1000}s`
      );
      openbbDownLogged = true;
    }
    return false;
  }

  openbbDownLogged = false;
  return true;
}

async function axiosOpenBB(endpointPath, params) {
  if (!(await isSidecarReachable())) {
    return { data: null, status: 503 };
  }
  const { baseURL, prefix } = client();
  return axios.get(`${baseURL}${prefix}${endpointPath}`, {
    params,
    timeout: REQUEST_MS,
    validateStatus: (s) => s >= 200 && s < 500
  });
}

function toNum(v, fallback = NaN) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function extractHistoricalRows(ob) {
  if (!ob || typeof ob !== 'object') return [];
  const r = ob.results;
  if (Array.isArray(r)) return r.filter(Boolean);
  if (Array.isArray(r?.data)) return r.data.filter(Boolean);
  return [];
}

/** Parse OpenBB equity/crypto bar date/datetime → UTC ms bar open */
function parseOpenBBRowTimeUtcMs(row) {
  const d =
    row.date ??
    row.Date ??
    row.datetime ??
    row.record_date ??
    row.timestamp ??
    row.time;
  if (d === '' || d === null || d === undefined) return null;
  if (typeof d === 'number' && Number.isFinite(d)) return d >= 1e12 ? d : d * 1000;
  const t = Date.parse(String(d));
  return Number.isFinite(t) ? t : null;
}

function normalizeBar(row) {
  if (!row || typeof row !== 'object') return null;
  const date =
    row.date ??
    row.Date ??
    row.chart_date ??
    row.datetime ??
    row.record_date ??
    row.timestamp ??
    '';
  const open = toNum(row.open ?? row.Open);
  const high = toNum(row.high ?? row.High);
  const low = toNum(row.low ?? row.Low);
  const close = toNum(row.close ?? row.Close);
  const volume = Math.max(0, toNum(row.volume ?? row.Volume, 0));
  if (!close || close <= 0) return null;
  return {
    sortKey: String(date),
    open: Number.isFinite(open) ? open : close,
    high: Number.isFinite(high) ? high : close,
    low: Number.isFinite(low) ? low : close,
    close,
    volume
  };
}

/** Map charts.js interval string → OpenBB equity/candle interval (best-effort). */
function chartIntervalToOpenBB(chartInterval) {
  const i = String(chartInterval || '1d');
  const map = {
    '1m': '1m',
    '2m': '2m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '60m': '1h',
    '1h': '1h',
    '1d': '1d',
    '5d': '1d',
    '1wk': '1W',
    '1mo': '1M'
  };
  return map[i] || '1d';
}

/**
 * Convert OpenBB rows → Polygon-agg-shaped bars for `sanitizeCandle` in charts.js (`t` in ms).
 */
function openBBRowsToPolygonAggLike(rows) {
  const out = [];
  for (const row of rows) {
    const ms = parseOpenBBRowTimeUtcMs(row);
    const o = toNum(row.open ?? row.Open);
    const h = toNum(row.high ?? row.High);
    const l = toNum(row.low ?? row.Low);
    const c = toNum(row.close ?? row.Close);
    const v = toNum(row.volume ?? row.Volume, 0);
    if (ms == null || !Number.isFinite(c) || c <= 0) continue;
    out.push({
      t: ms,
      o: Number.isFinite(o) ? o : c,
      h: Number.isFinite(h) ? h : c,
      l: Number.isFinite(l) ? l : c,
      c,
      v: Math.max(0, v)
    });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * @param {string} symbolUpper
 * @param {string} chartInterval - from charts route query
 * @param {Date} from
 * @param {Date} to
 * @returns {Promise<Array<{t:number,o:number,h:number,l:number,c:number,v:number}>>}
 */
async function fetchEquityHistoricalAsPolygonBars(symbolUpper, chartInterval, from, to) {
  if (!isEnabled()) return [];
  const configured = String(config.OPENBB_EQUITY_PROVIDER || 'polygon').toLowerCase();
  const interval = chartIntervalToOpenBB(chartInterval);
  const upper = symbolUpper.toUpperCase();

  const tryProvider = async (prov) => {
    try {
      const { data, status } = await axiosOpenBB('/equity/price/historical', {
        symbol: upper,
        start_date: from.toISOString().slice(0, 10),
        end_date: to.toISOString().slice(0, 10),
        interval,
        provider: prov
      });
      const okBody = status >= 200 && status < 300 && status !== 204 && data != null && data !== '';
      if (!okBody) {
        logger.warn(`OpenBB equity historical ${interval} HTTP ${status} (${prov}) for ${upper}`);
        return [];
      }
      return openBBRowsToPolygonAggLike(extractHistoricalRows(data));
    } catch (e) {
      logger.warn(`OpenBB equity historical (${prov}) failed ${upper}: ${e.message}`);
      return [];
    }
  };

  let bars = await tryProvider(configured);
  if (!bars.length && configured !== 'yfinance') {
    bars = await tryProvider('yfinance');
    if (bars.length) {
      logger.info(
        `OpenBB equity: yfinance filled history for ${upper} (${configured} returned no bars; reduces Polygon fallback load)`
      );
    }
  }
  return bars;
}

/** Daily OHLC bars for ATR/opportunity bundle (sanitizeBar-compatible raw). */
async function fetchDailyBarsForTechnicalBundle(assetType, symbol) {
  if (!isEnabled()) return [];
  if (!(await isSidecarReachable())) return [];

  const to = new Date();
  const from = new Date(to.getTime() - 450 * 24 * 60 * 60 * 1000);
  try {
    if (assetType === 'crypto') {
      const variants = cryptoPairSymbolCandidates(symbol);
      const cryptoProv = String(config.OPENBB_CRYPTO_PROVIDER || 'yfinance').toLowerCase();
      for (const sym of variants) {
        const rows = await fetchCryptoHistoricalRows(sym, cryptoProv, '1d', from, to);
        if (rows.length >= 40) return rowsToDailyAtrRaw(rows);
      }
      return [];
    }

    const provider = String(config.OPENBB_EQUITY_PROVIDER || 'polygon').toLowerCase();
    const { data, status } = await axiosOpenBB('/equity/price/historical', {
      symbol: String(symbol).toUpperCase(),
      start_date: from.toISOString().slice(0, 10),
      end_date: to.toISOString().slice(0, 10),
      interval: '1d',
      provider
    });
    if (status >= 400 || !data) return [];
    return rowsToDailyAtrRaw(extractHistoricalRows(data));
  } catch (e) {
    logger.warn(`OpenBB daily bundle failed ${assetType} ${symbol}: ${e.message}`);
    return [];
  }
}

function rowsToDailyAtrRaw(rows) {
  const out = [];
  for (const row of rows) {
    const o = toNum(row.open ?? row.Open);
    const h = toNum(row.high ?? row.High);
    const l = toNum(row.low ?? row.Low);
    const c = toNum(row.close ?? row.Close);
    if (![o, h, l, c].every((x) => Number.isFinite(x) && x > 0)) continue;
    if (h < l) continue;
    out.push({ o, h, l, c });
  }
  return out;
}

function cryptoPairSymbolCandidates(pairOrBase) {
  const raw = decodeURIComponent(String(pairOrBase || '').trim());
  const stripped = raw.replace(/^X:/i, '').toUpperCase();
  const base = stripped.replace(/USDT?$/i, '').replace(/USD$/i, '').replace(/[^A-Z0-9]/g, '');
  if (!base) return [];
  return [`${base}-USD`, `${base}USD`];
}

async function fetchCryptoHistoricalRows(symbol, provider, interval, from, to) {
  try {
    const { data, status } = await axiosOpenBB('/crypto/price/historical', {
      symbol,
      start_date: from.toISOString().slice(0, 10),
      end_date: to.toISOString().slice(0, 10),
      interval,
      provider
    });
    if (status >= 400 || !data) return [];
    return extractHistoricalRows(data);
  } catch (_) {
    return [];
  }
}

/**
 * Crypto OHLC in the same shape as Polygon aggs (`t` ms) for frontend normalization.
 */
function openbbCryptoIntervalFromMinutes(intervalMinutes) {
  const n = Number(intervalMinutes) || 60;
  if (n <= 1) return '1m';
  if (n <= 5) return '5m';
  if (n <= 15) return '15m';
  if (n <= 30) return '30m';
  if (n < 180) return '1h';
  if (n < 1440) return '4h';
  if (n < 10080) return '1d';
  return '1W';
}

async function fetchCryptoOhlcvAsPolygonLike(pairEncoded, intervalMinutes, limitNum) {
  if (!isEnabled()) return [];

  const provider = String(config.OPENBB_CRYPTO_PROVIDER || 'yfinance').toLowerCase();
  const intervalStr = openbbCryptoIntervalFromMinutes(intervalMinutes);
  const lookbackDays = Math.max(
    2,
    Math.min(730, Math.ceil((intervalMinutes * Math.max(limitNum, 120)) / 1440))
  );
  const to = new Date();
  const from = new Date(to.getTime() - lookbackDays * 86400000);

  const variants = cryptoPairSymbolCandidates(pairEncoded);
  for (const sym of variants) {
    const rows = await fetchCryptoHistoricalRows(sym, provider, intervalStr, from, to);
    if (!rows.length) continue;
    const bars = openBBRowsToPolygonAggLike(rows);
    if (!bars.length) continue;
    return bars.slice(-limitNum);
  }
  return [];
}

/**
 * Map last 1d (or 1h) bars → CryptoPage ticker shape.
 */
async function fetchCryptoTickerMapped(pairEncoded) {
  if (!isEnabled()) return null;
  const provider = String(config.OPENBB_CRYPTO_PROVIDER || 'yfinance').toLowerCase();
  const to = new Date();
  const from = new Date(to.getTime() - 14 * 86400000);
  const variants = cryptoPairSymbolCandidates(pairEncoded);

  for (const sym of variants) {
    const rows = await fetchCryptoHistoricalRows(sym, provider, '1d', from, to);
    const norm = rows.map(normalizeBar).filter(Boolean);
    norm.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
    if (!norm.length) continue;
    const last = norm[norm.length - 1];
    const prev = norm.length >= 2 ? norm[norm.length - 2] : null;
    const price = last.close;
    const open = last.open;
    const prevClose = prev?.close ?? open;
    const change = prevClose ? price - prevClose : price - open;
    const changePercent =
      prevClose && prevClose !== 0 ? (change / prevClose) * 100 : open ? ((price - open) / open) * 100 : 0;
    return {
      symbol: pairEncoded,
      price,
      open,
      high: last.high,
      low: last.low,
      volume: last.volume,
      vwap: price,
      trades: 0,
      change,
      changePercent,
      bid: price,
      ask: price,
      spread: 0,
      timestamp: new Date().toISOString()
    };
  }
  return null;
}

/**
 * Build a Charts-compatible quote snapshot from Polygon via OpenBB daily bars (last sessions).
 */
async function fetchEquityQuoteMapped(symbolUpper) {
  if (!isEnabled()) return null;
  if (!(await isSidecarReachable())) return null;
  const { baseURL, prefix } = client();
  const upper = symbolUpper.toUpperCase();
  const provider = String(config.OPENBB_EQUITY_PROVIDER || 'polygon').toLowerCase();

  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 3600 * 1000);

  try {
    const { data, status } = await axios.get(`${baseURL}${prefix}/equity/price/historical`, {
      params: {
        symbol: upper,
        start_date: start.toISOString().slice(0, 10),
        end_date: end.toISOString().slice(0, 10),
        interval: '1d',
        provider
      },
      timeout: REQUEST_MS,
      validateStatus: (s) => s >= 200 && s < 500
    });
    if (status >= 400 || !data) {
      logger.warn(`OpenBB equity historical: HTTP ${status} for ${upper}`);
      return null;
    }
    const normalized = extractHistoricalRows(data).map(normalizeBar).filter(Boolean);

    normalized.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
    if (!normalized.length) return null;

    const last = normalized[normalized.length - 1];
    const prev = normalized.length >= 2 ? normalized[normalized.length - 2] : null;

    const price = last.close;
    const open = last.open;
    const prevClose = prev?.close ?? last.open;
    const change = prevClose ? price - prevClose : price - open;
    const changePercent =
      prevClose && prevClose !== 0 ? (change / prevClose) * 100 : open ? ((price - open) / open) * 100 : 0;

    return {
      symbol: upper,
      price,
      open,
      high: last.high,
      low: last.low,
      volume: last.volume,
      change,
      changePercent,
      marketCap: 0,
      companyName: upper,
      timestamp: new Date().toISOString(),
      sourceUsed: 'openbb_polygon_daily',
      partialData: true,
      provider: data.provider || provider
    };
  } catch (e) {
    logger.warn(`OpenBB equity quote mapping failed ${upper}: ${e.message}`);
    return null;
  }
}

/** priceMonitor stock row from OpenBB */
async function fetchStockPriceMonitorRow(symbol) {
  const m = await fetchEquityQuoteMapped(String(symbol).toUpperCase());
  if (!m || !Number.isFinite(m.price) || m.price <= 0) return null;
  const upper = String(symbol).toUpperCase();
  const out = {
    symbol: upper,
    price: m.price,
    change24h: m.change,
    changePercent: m.changePercent,
    timestamp: Date.now(),
    type: 'stock',
    sourceUsed: 'openbb'
  };
  if (Number.isFinite(m.open) && m.open > 0) out.dayOpen = m.open;
  if (Number.isFinite(m.high) && m.high > 0) out.dayHigh = m.high;
  if (Number.isFinite(m.low) && m.low > 0) out.dayLow = m.low;
  if (Number.isFinite(m.volume) && m.volume >= 0) out.volume = m.volume;
  return out;
}

/** priceMonitor crypto row (24h-style from daily bars). */
async function fetchCryptoPriceMonitorRow(baseSymbol) {
  const pair = `X:${String(baseSymbol).toUpperCase()}USD`;
  const t = await fetchCryptoTickerMapped(pair);
  if (!t || !Number.isFinite(t.price)) return null;
  const sym = String(baseSymbol).toUpperCase();
  const out = {
    symbol: sym,
    price: t.price,
    change24h: t.changePercent,
    timestamp: Date.now(),
    type: 'crypto',
    sourceUsed: 'openbb'
  };
  if (Number.isFinite(t.open) && t.open > 0) out.dayOpen = t.open;
  if (Number.isFinite(t.vwap) && t.vwap > 0) out.sessionVwap = t.vwap;
  if (Number.isFinite(t.bid) && t.bid > 0) out.bidPrice = t.bid;
  if (Number.isFinite(t.ask) && t.ask > 0) out.askPrice = t.ask;
  if (Number.isFinite(t.high) && t.high > 0) out.dayHigh = t.high;
  if (Number.isFinite(t.low) && t.low > 0) out.dayLow = t.low;
  if (Number.isFinite(t.volume) && t.volume >= 0) out.volume = t.volume;
  return out;
}

module.exports = {
  isEnabled,
  probeStatus,
  quoteExclusiveEffective,
  stockHistoryExclusiveEffective,
  cryptoExclusiveEffective,
  fetchEquityQuoteMapped,
  fetchEquityHistoricalAsPolygonBars,
  fetchDailyBarsForTechnicalBundle,
  fetchCryptoOhlcvAsPolygonLike,
  fetchCryptoTickerMapped,
  fetchStockPriceMonitorRow,
  fetchCryptoPriceMonitorRow
};
