const express = require('express');
const router = express.Router();
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config');
const { getRedisClient } = require('../utils/redis');

const POLYGON_API_URL = 'https://api.polygon.io';
const getMarketDataApiKey = () => config.POLYGON_API_KEY || config.MASSIVE_API_KEY;
const redisClient = getRedisClient();

const PERIOD_TO_DAYS = {
  '1d': 1,
  '5d': 5,
  '1mo': 30,
  '3mo': 90,
  '6mo': 180,
  'ytd': 365,
  '1y': 365,
  '2y': 730,
  '5y': 1825,
  '10y': 3650,
  'all': 3650,
  'max': 3650
};

const intervalToAgg = (interval) => {
  switch (interval) {
    case '1m': return { multiplier: 1, timespan: 'minute' };
    case '2m': return { multiplier: 2, timespan: 'minute' };
    case '5m': return { multiplier: 5, timespan: 'minute' };
    case '15m': return { multiplier: 15, timespan: 'minute' };
    case '30m': return { multiplier: 30, timespan: 'minute' };
    case '60m':
    case '1h': return { multiplier: 1, timespan: 'hour' };
    case '1d': return { multiplier: 1, timespan: 'day' };
    case '5d': return { multiplier: 5, timespan: 'day' };
    case '1wk': return { multiplier: 1, timespan: 'week' };
    case '1mo': return { multiplier: 1, timespan: 'month' };
    default: return { multiplier: 1, timespan: 'day' };
  }
};

const makeMassiveRequest = async (endpoint, params = {}) => {
  const apiKey = getMarketDataApiKey();
  if (!apiKey) {
    throw new Error('MASSIVE_API_KEY (or POLYGON_API_KEY) is not configured');
  }

  const response = await axios.get(`${POLYGON_API_URL}${endpoint}`, {
    params: {
      ...params,
      apiKey
    },
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'X-Polygon-API-Key': apiKey,
      'User-Agent': 'KeepItBased/1.0'
    },
    timeout: 20000
  });

  return response.data;
};

const historyCacheTtlByInterval = {
  '1m': 10,
  '2m': 10,
  '5m': 15,
  '15m': 30,
  '30m': 45,
  '60m': 60,
  '1h': 60,
  '1d': 300,
  '5d': 600,
  '1wk': 900,
  '1mo': 1800
};

const getHistoryCacheTtl = (interval) => historyCacheTtlByInterval[interval] || 300;
const getQuoteCacheTtl = (sourceUsed) => {
  if (sourceUsed === 'snapshot') return 5;
  if (sourceUsed === 'agg_minute') return 10;
  return 60;
};

const safeGetCache = async (key) => {
  try {
    if (!redisClient?.isOpen) return null;
    const raw = await redisClient.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
};

const safeSetCache = async (key, value, ttlSeconds) => {
  try {
    if (!redisClient?.isOpen) return;
    await redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
  } catch (_error) {
    // cache failures are non-fatal
  }
};

const toFiniteNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const sanitizeCandle = (raw) => {
  const time = Math.floor(toFiniteNumber(raw?.t, NaN) / 1000);
  const open = toFiniteNumber(raw?.o, NaN);
  const high = toFiniteNumber(raw?.h, NaN);
  const low = toFiniteNumber(raw?.l, NaN);
  const close = toFiniteNumber(raw?.c, NaN);
  const volume = toFiniteNumber(raw?.v, 0);

  if (!Number.isFinite(time) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
    return null;
  }
  if (high < low) return null;
  if (open <= 0 || close <= 0) return null;

  return { time, open, high, low, close, volume: Math.max(0, volume) };
};

const sanitizeQuote = (raw = {}) => {
  const price = toFiniteNumber(raw.price, 0);
  const open = toFiniteNumber(raw.open, price);
  const high = toFiniteNumber(raw.high, Math.max(price, open));
  const low = toFiniteNumber(raw.low, Math.min(price, open));
  const volume = Math.max(0, toFiniteNumber(raw.volume, 0));

  return {
    symbol: String(raw.symbol || '').toUpperCase(),
    price,
    open,
    high: Math.max(high, low),
    low: Math.min(low, high),
    volume,
    change: toFiniteNumber(raw.change, price - open),
    changePercent: toFiniteNumber(raw.changePercent, open ? ((price - open) / open) * 100 : 0),
    marketCap: Math.max(0, toFiniteNumber(raw.marketCap, 0)),
    companyName: String(raw.companyName || raw.symbol || '').trim(),
    timestamp: raw.timestamp || new Date().toISOString(),
    sourceUsed: raw.sourceUsed || 'unknown',
    partialData: Boolean(raw.partialData),
    lastUpdated: raw.lastUpdated || new Date().toISOString()
  };
};

const calculateSMA = (series, period, index) => {
  if (index < period - 1) return null;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i += 1) {
    sum += series[i];
  }
  return sum / period;
};

const calculateEMAArray = (series, period) => {
  const k = 2 / (period + 1);
  const out = new Array(series.length).fill(null);
  let prevEma = null;

  for (let i = 0; i < series.length; i += 1) {
    const v = series[i];
    if (!Number.isFinite(v)) continue;
    if (i < period - 1) continue;
    if (i === period - 1) {
      const seed = calculateSMA(series, period, i);
      prevEma = seed;
      out[i] = seed;
      continue;
    }
    prevEma = (v - prevEma) * k + prevEma;
    out[i] = prevEma;
  }

  return out;
};

const calculateRSIArray = (series, period = 14) => {
  const out = new Array(series.length).fill(null);
  if (series.length <= period) return out;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = series[i] - series[i - 1];
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < series.length; i += 1) {
    const delta = series[i] - series[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }

  return out;
};

const isUsMarketHours = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(new Date());

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const weekday = map.weekday;
  const hour = Number(map.hour || 0);
  const minute = Number(map.minute || 0);
  const totalMinutes = hour * 60 + minute;
  const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday);

  return isWeekday && totalMinutes >= (9 * 60 + 30) && totalMinutes <= (16 * 60);
};

// Get historical data for charts
router.get('/history/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { period = '1y', interval = '1d' } = req.query;
    const upperSymbol = symbol.toUpperCase();
    const cacheKey = `charts:history:${upperSymbol}:${period}:${interval}`;
    const cachedHistory = await safeGetCache(cacheKey);
    if (cachedHistory) {
      return res.json(cachedHistory);
    }

    const days = PERIOD_TO_DAYS[period] || 365;
    const { multiplier, timespan } = intervalToAgg(interval);
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

    const response = await makeMassiveRequest(
      `/v2/aggs/ticker/${encodeURIComponent(symbol.toUpperCase())}/range/${multiplier}/${timespan}/${from.toISOString().slice(0, 10)}/${to.toISOString().slice(0, 10)}`,
      { adjusted: true, sort: 'asc', limit: 50000 }
    );

    const results = response.results || [];
    const data = results.map(sanitizeCandle).filter(Boolean);

    const payload = {
      symbol: upperSymbol,
      data,
      period,
      interval,
      timestamp: new Date().toISOString(),
      sourceUsed: 'massive_aggs',
      partialData: data.length === 0,
      lastUpdated: new Date().toISOString()
    };

    await safeSetCache(cacheKey, payload, getHistoryCacheTtl(interval));
    res.json(payload);
  } catch (error) {
    logger.error(`Error getting chart data for ${req.params.symbol}: ${error.message}`);
    
    if (error.response?.status === 404 || error.response?.status === 400) {
      return res.status(404).json({ message: 'Symbol not found' });
    }
    if (error.response?.status === 403) {
      return res.status(403).json({ message: 'Massive market-data entitlement required for historical charts' });
    }
    
    res.status(500).json({ message: 'Failed to get chart data' });
  }
});

// Get current quote with detailed info
router.get('/quote/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const upper = symbol.toUpperCase();
    const cacheKey = `charts:quote:${upper}`;
    const cachedQuote = await safeGetCache(cacheKey);
    if (cachedQuote) {
      return res.json(cachedQuote);
    }

    let quoteData;
    let sourceUsed = 'snapshot';

    // Preferred path: real-time snapshot
    try {
      const ticker = await makeMassiveRequest(`/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(upper)}`);
      const t = ticker.ticker;
      if (!t) {
        throw new Error('Snapshot not available');
      }

      const open = Number(t.day?.o ?? t.prevDay?.c ?? t.day?.c ?? 0);
      const price = Number(t.day?.c ?? t.min?.c ?? open);
      quoteData = {
        symbol: upper,
        price,
        open,
        high: Number(t.day?.h ?? price),
        low: Number(t.day?.l ?? price),
        volume: Number(t.day?.v ?? 0),
        change: price - open,
        changePercent: open ? ((price - open) / open) * 100 : 0,
        marketCap: 0,
        companyName: upper,
        timestamp: new Date().toISOString()
      };
    } catch (_snapshotError) {
      // Fallback path: use minute bars in-session, daily bars after-hours.
      const to = new Date();
      let rows = [];
      let last = null;

      if (isUsMarketHours()) {
        sourceUsed = 'agg_minute';
        const minuteFrom = new Date(to.getTime() - 4 * 60 * 60 * 1000);
        const minuteAggs = await makeMassiveRequest(
          `/v2/aggs/ticker/${encodeURIComponent(upper)}/range/1/minute/${minuteFrom.toISOString().slice(0, 10)}/${to.toISOString().slice(0, 10)}`,
          { adjusted: true, sort: 'asc', limit: 10000 }
        );
        rows = minuteAggs.results || [];
        last = rows[rows.length - 1] || null;
      }

      if (!last) {
        sourceUsed = 'agg_day';
        const dayFrom = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
        const dayAggs = await makeMassiveRequest(
          `/v2/aggs/ticker/${encodeURIComponent(upper)}/range/1/day/${dayFrom.toISOString().slice(0, 10)}/${to.toISOString().slice(0, 10)}`,
          { adjusted: true, sort: 'asc', limit: 10 }
        );
        rows = dayAggs.results || [];
        last = rows[rows.length - 1] || null;
      }

      if (!last) {
        return res.status(404).json({ message: 'Symbol not found' });
      }

      const open = Number(last.o);
      const price = Number(last.c);
      quoteData = {
        symbol: upper,
        price,
        open,
        high: Number(last.h ?? price),
        low: Number(last.l ?? price),
        volume: Number(last.v ?? 0),
        change: price - open,
        changePercent: open ? ((price - open) / open) * 100 : 0,
        marketCap: 0,
        companyName: upper,
        timestamp: new Date().toISOString()
      };
    }

    try {
      const info = await makeMassiveRequest('/v3/reference/tickers', {
        ticker: upper,
        market: 'stocks',
        limit: 1
      });
      quoteData.companyName = info.results?.[0]?.name || quoteData.companyName;
      quoteData.marketCap = Number(info.results?.[0]?.market_cap ?? 0);
    } catch (_infoError) {
      // non-fatal
    }

    const payload = sanitizeQuote({
      ...quoteData,
      sourceUsed,
      partialData: sourceUsed !== 'snapshot',
      lastUpdated: new Date().toISOString()
    });

    await safeSetCache(cacheKey, payload, getQuoteCacheTtl(sourceUsed));
    res.json(payload);
  } catch (error) {
    logger.error(`Error getting quote for ${req.params.symbol}: ${error.message}`);
    
    if (error.response?.status === 404) {
      return res.status(404).json({ message: 'Symbol not found' });
    }
    res.status(500).json({ message: 'Failed to get quote' });
  }
});

// Get stock information
router.get('/info/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const response = await makeMassiveRequest('/v3/reference/tickers', {
      ticker: symbol.toUpperCase(),
      market: 'stocks',
      limit: 1
    });

    const entry = response.results?.[0];
    if (!entry) {
      return res.status(404).json({ message: 'Symbol not found' });
    }

    res.json({
      symbol: symbol.toUpperCase(),
      companyName: entry.name || '',
      sector: '',
      industry: entry.sic_description || '',
      marketCap: Number(entry.market_cap || 0),
      peRatio: 0,
      dividendYield: 0,
      beta: 0,
      week52High: 0,
      week52Low: 0,
      avgVolume: 0,
      description: entry.description || '',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error getting stock info for ${req.params.symbol}: ${error.message}`);
    
    if (error.response?.status === 404) {
      return res.status(404).json({ message: 'Symbol not found' });
    }
    
    res.status(500).json({ message: 'Failed to get stock info' });
  }
});

// Get technical indicators
router.get('/technical/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { period = '6mo' } = req.query;

    const days = PERIOD_TO_DAYS[period] || 180;
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    const response = await makeMassiveRequest(
      `/v2/aggs/ticker/${encodeURIComponent(symbol.toUpperCase())}/range/1/day/${from.toISOString().slice(0, 10)}/${to.toISOString().slice(0, 10)}`,
      { adjusted: true, sort: 'asc', limit: 5000 }
    );

    const candles = (response.results || [])
      .map((c) => sanitizeCandle(c))
      .filter(Boolean)
      .map((c) => ({
        time: c.time,
        close: c.close
      }));

    const closeSeries = candles.map((c) => c.close);
    const ema12 = calculateEMAArray(closeSeries, 12);
    const ema26 = calculateEMAArray(closeSeries, 26);
    const ema20 = calculateEMAArray(closeSeries, 20);
    const ema50 = calculateEMAArray(closeSeries, 50);
    const rsi14 = calculateRSIArray(closeSeries, 14);

    const macdLine = closeSeries.map((_, i) => (
      Number.isFinite(ema12[i]) && Number.isFinite(ema26[i]) ? (ema12[i] - ema26[i]) : null
    ));
    const macdForEma = macdLine.map((v) => (Number.isFinite(v) ? v : 0));
    const signalLine = calculateEMAArray(macdForEma, 9);

    const technicalData = candles.map((candle, i) => ({
      time: candle.time,
      close: candle.close,
      sma20: calculateSMA(closeSeries, 20, i),
      sma50: calculateSMA(closeSeries, 50, i),
      ema20: Number.isFinite(ema20[i]) ? ema20[i] : null,
      ema50: Number.isFinite(ema50[i]) ? ema50[i] : null,
      macd: Number.isFinite(macdLine[i]) ? macdLine[i] : null,
      signal: Number.isFinite(signalLine[i]) ? signalLine[i] : null,
      histogram: Number.isFinite(macdLine[i]) && Number.isFinite(signalLine[i]) ? macdLine[i] - signalLine[i] : null,
      rsi: Number.isFinite(rsi14[i]) ? rsi14[i] : null
    }));

    res.json({
      symbol: symbol.toUpperCase(),
      data: technicalData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error getting technical data for ${req.params.symbol}: ${error.message}`);
    
    if (error.response?.status === 404) {
      return res.status(404).json({ message: 'Symbol not found' });
    }
    
    res.status(500).json({ message: 'Failed to get technical data' });
  }
});

// Search stocks
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
      return res.status(400).json({ message: 'Query must be at least 2 characters' });
    }
    
    const response = await makeMassiveRequest('/v3/reference/tickers', {
      search: q,
      market: 'stocks',
      active: true,
      limit: 10
    });

    const results = (response.results || []).map((item) => ({
      symbol: item.ticker,
      name: item.name,
      exchange: item.primary_exchange || item.market || 'US'
    }));

    res.json({ results });
  } catch (error) {
    logger.error(`Error searching stocks: ${error.message}`);
    res.status(500).json({ message: 'Search failed' });
  }
});

// Health check for market-data provider
router.get('/health', async (req, res) => {
  try {
    await makeMassiveRequest('/v1/marketstatus/now');
    
    res.json({
      status: 'healthy',
      provider: 'massive',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Massive health check failed: ${error.message}`);
    res.status(503).json({
      status: 'unhealthy',
      error: 'Massive service unavailable',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;