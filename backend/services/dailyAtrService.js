const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ATR_CACHE_TTL_SEC = 15 * 60; // align with “not every minute” vendor load
const FETCH_CALENDAR_DAYS = 450;
const WEEKLY_SESSIONS = 252;

const marketDataHeaders = (apiKey) => ({
  Authorization: `Bearer ${apiKey}`,
  'X-Polygon-API-Key': apiKey,
  'User-Agent': 'KeepItBased/1.0 (atr)'
});

/**
 * Classic Wilder true range (prior close pulls in overnight gaps).
 *
 * @param {number} high
 * @param {number} low
 * @param {number | null} prevClose
 */
function trueRange(high, low, prevClose) {
  if (prevClose == null || !Number.isFinite(prevClose)) {
    return high - low;
  }
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

/**
 * Wilder ATR(N) on ascending daily bars. Returns last ATR or null.
 *
 * @param {Array<{ h: number, l: number, c: number }>} bars oldest-first
 * @param {number} period - e.g. 14, 50
 */
function wilderAtrN(bars, period) {
  const p = Number(period);
  if (!Number.isFinite(p) || p < 2) return null;
  const minBars = Math.max(20, p + 1);
  if (!bars || bars.length < minBars) return null;

  const tr = [];
  for (let i = 0; i < bars.length; i++) {
    const prevC = i > 0 ? bars[i - 1].c : null;
    tr.push(trueRange(bars[i].h, bars[i].l, prevC));
  }
  if (tr.length < p) return null;

  let atr = tr.slice(0, p).reduce((s, x) => s + x, 0) / p;
  for (let i = p; i < tr.length; i++) {
    atr = (atr * (p - 1) + tr[i]) / p;
  }
  return atr > 0 ? atr : null;
}

/**
 * @param {Array<{ h: number, l: number, c: number }>} bars oldest-first
 */
function wilderAtr14(bars) {
  return wilderAtrN(bars, 14);
}

function sanitizeBar(raw) {
  const h = Number(raw?.h);
  const l = Number(raw?.l);
  const c = Number(raw?.c);
  const o = Number(raw?.o);
  if (![h, l, c, o].every((x) => Number.isFinite(x) && x > 0)) return null;
  if (h < l) return null;
  return { h, l, c, o };
}

function polygonTicker(assetType, symbol) {
  const s = String(symbol || '').toUpperCase().trim();
  if (assetType === 'crypto') {
    return `X:${s}USD`;
  }
  return s;
}

/**
 * Highest daily high over the last `maxSessions` bars (oldest-first bars).
 */
function trailingHighFromBars(bars, maxSessions) {
  if (!bars.length || !maxSessions) return null;
  const slice = bars.slice(Math.max(0, bars.length - maxSessions));
  let m = -Infinity;
  for (const b of slice) {
    if (Number.isFinite(b.h) && b.h > m) m = b.h;
  }
  return Number.isFinite(m) && m > 0 ? m : null;
}

/**
 * Lowest daily low over the last `maxSessions` bars (oldest-first bars).
 */
function trailingLowFromBars(bars, maxSessions) {
  if (!bars.length || !maxSessions) return null;
  const slice = bars.slice(Math.max(0, bars.length - maxSessions));
  let m = Infinity;
  for (const b of slice) {
    if (Number.isFinite(b.l) && b.l < m) m = b.l;
  }
  return Number.isFinite(m) && m > 0 && m !== Infinity ? m : null;
}

/**
 * Session ATH proxy: max high over all bars returned (long daily window).
 */
function athHighFromBars(bars) {
  return trailingHighFromBars(bars, bars.length);
}

/**
 * Simple moving average of daily closes over the last `period` sessions (uses last bar’s window).
 *
 * @param {Array<{ c: number }>} bars oldest-first
 */
function lastSmaFromCloses(bars, period) {
  const p = Number(period);
  if (!Number.isFinite(p) || p < 2 || !bars || bars.length < p) return null;
  let sum = 0;
  const start = bars.length - p;
  for (let i = start; i < bars.length; i++) {
    sum += bars[i].c;
  }
  const sma = sum / p;
  return Number.isFinite(sma) && sma > 0 ? sma : null;
}

/**
 * Daily technical bundle for opportunity evaluation (single vendor fetch, Redis JSON cache).
 *
 * @returns {Promise<{ atr14: number|null, atr50: number|null, week52High: number|null, week52Low: number|null, athHigh: number|null, smaTrend: number|null }>}
 */
async function getOpportunityTechnicalBundle(symbol, assetType, redis) {
  const apiKey = config.POLYGON_API_KEY || config.MASSIVE_API_KEY;
  const empty = {
    atr14: null,
    atr50: null,
    week52High: null,
    week52Low: null,
    athHigh: null,
    smaTrend: null
  };

  if (!apiKey) return { ...empty };

  const typ = assetType === 'crypto' ? 'crypto' : 'stock';
  const sym = String(symbol).toUpperCase();
  const smaDays = config.OPPORTUNITY_SHORT_TREND_SMA_DAYS || 200;
  const cacheKey = `oppTech:v3:${typ}:${sym}:s${smaDays}`;

  if (redis) {
    try {
      const hit = await redis.get(cacheKey);
      if (hit != null && hit !== '') {
        const o = JSON.parse(hit);
        if (o && typeof o === 'object') {
          return {
            atr14:
              o.atr14 != null && Number.isFinite(Number(o.atr14)) && Number(o.atr14) > 0
                ? Number(o.atr14)
                : null,
            atr50:
              o.atr50 != null && Number.isFinite(Number(o.atr50)) && Number(o.atr50) > 0
                ? Number(o.atr50)
                : null,
            week52High:
              o.week52High != null && Number.isFinite(Number(o.week52High)) && Number(o.week52High) > 0
                ? Number(o.week52High)
                : null,
            week52Low:
              o.week52Low != null && Number.isFinite(Number(o.week52Low)) && Number(o.week52Low) > 0
                ? Number(o.week52Low)
                : null,
            athHigh:
              o.athHigh != null && Number.isFinite(Number(o.athHigh)) && Number(o.athHigh) > 0
                ? Number(o.athHigh)
                : null,
            smaTrend:
              o.smaTrend != null && Number.isFinite(Number(o.smaTrend)) && Number(o.smaTrend) > 0
                ? Number(o.smaTrend)
                : null
          };
        }
      }
    } catch (_) {
      /* ignore */
    }
  }

  const ticker = polygonTicker(assetType === 'crypto' ? 'crypto' : 'stock', symbol);
  const to = new Date();
  const from = new Date(to.getTime() - FETCH_CALENDAR_DAYS * MS_PER_DAY);

  try {
    const url = `${config.MARKET_DATA_API_URL}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${from.toISOString().slice(0, 10)}/${to.toISOString().slice(0, 10)}`;
    const { data } = await axios.get(url, {
      params: { adjusted: true, sort: 'asc', limit: 5000, apiKey },
      headers: marketDataHeaders(apiKey),
      timeout: 25000
    });

    const results = Array.isArray(data?.results) ? data.results : [];
    const bars = results.map(sanitizeBar).filter(Boolean);

    const atr14 = wilderAtrN(bars, 14);
    const atr50 = wilderAtrN(bars, 50);
    const week52High = trailingHighFromBars(bars, WEEKLY_SESSIONS);
    const week52Low = trailingLowFromBars(bars, WEEKLY_SESSIONS);
    const athHigh = athHighFromBars(bars);
    const smaTrend = lastSmaFromCloses(bars, smaDays);

    const bundle = { atr14, atr50, week52High, week52Low, athHigh, smaTrend };

    if (redis) {
      try {
        await redis.setEx(cacheKey, ATR_CACHE_TTL_SEC, JSON.stringify(bundle));
      } catch (_) {
        /* ignore */
      }
    }

    return bundle;
  } catch (e) {
    logger.warn(`dailyAtrService: bundle fetch failed for ${ticker}: ${e.message}`);
    return { ...empty };
  }
}

/**
 * 14-period Wilder ATR — thin wrapper over {@link getOpportunityTechnicalBundle} (same cache).
 *
 * @param {string} symbol
 * @param {'stock'|'crypto'} assetType
 * @param {import('redis').RedisClientType | null} redis
 * @returns {Promise<number|null>}
 */
async function getDailyAtr14(symbol, assetType, redis) {
  const b = await getOpportunityTechnicalBundle(symbol, assetType, redis);
  return b.atr14 ?? null;
}

module.exports = {
  getDailyAtr14,
  getOpportunityTechnicalBundle,
  wilderAtr14,
  wilderAtrN,
  trueRange,
  polygonTicker,
  lastSmaFromCloses,
  trailingLowFromBars,
  trailingHighFromBars
};
