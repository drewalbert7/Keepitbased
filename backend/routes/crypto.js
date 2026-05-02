const express = require('express');
const router = express.Router();
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const config = require('../config');
const { publicCryptoSecurity } = require('../middleware/cryptoSecurity');

const getMarketDataApiKey = () => config.POLYGON_API_KEY || config.MASSIVE_API_KEY;
const getMarketDataBaseUrl = () => config.MARKET_DATA_API_URL;
const LOG_COOLDOWN_MS = 5 * 60 * 1000;
const recentLogs = new Map();

const logWithCooldown = (key, level, message) => {
  const last = recentLogs.get(key) || 0;
  if (Date.now() - last < LOG_COOLDOWN_MS) return;
  recentLogs.set(key, Date.now());
  logger[level](message);
};

const polygonApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests to Polygon API',
    retryAfter: 900
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Health check limiter (less restrictive)
const healthCheckLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 health checks per minute
  message: {
    error: 'Too many health check requests',
    retryAfter: 60
  }
});

const ensurePolygonApiKey = () => {
  if (!getMarketDataApiKey()) {
    throw new Error('Polygon API key not configured');
  }
};

const makePolygonRequest = async (endpoint, params = {}) => {
  try {
    ensurePolygonApiKey();
    const apiKey = getMarketDataApiKey();
    const response = await axios.get(`${getMarketDataBaseUrl()}${endpoint}`, {
      params: {
        ...params,
        apiKey
      },
      timeout: 15000,
      headers: {
        'User-Agent': 'KeepItBased/1.0',
        Authorization: `Bearer ${apiKey}`,
        'X-Polygon-API-Key': apiKey
      },
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      }
    });
    
    return response.data;
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      throw new Error('Request timeout - Polygon API is slow to respond');
    }
    if (error.code === 'ENOTFOUND') {
      throw new Error('Unable to connect to Polygon API - network error');
    }
    throw error;
  }
};

const POLYGON_INTERVAL_TO_MINUTES = {
  minute: 1,
  hour: 60,
  day: 1440,
  week: 10080,
  month: 43200
};

const mapMinutesToPolygonRange = (intervalMinutes) => {
  if (intervalMinutes >= 43200) return { multiplier: 1, timespan: 'month' };
  if (intervalMinutes >= 10080) return { multiplier: 1, timespan: 'week' };
  if (intervalMinutes >= 1440) return { multiplier: 1, timespan: 'day' };
  if (intervalMinutes >= 60) return { multiplier: Math.max(1, Math.floor(intervalMinutes / 60)), timespan: 'hour' };
  return { multiplier: Math.max(1, intervalMinutes), timespan: 'minute' };
};

const getLookbackDays = (limit, intervalMinutes) => {
  const totalMinutes = Math.max(limit * intervalMinutes, 60);
  return Math.max(1, Math.ceil(totalMinutes / 1440));
};

const getCryptoBase = (symbol) => {
  if (!symbol || !symbol.startsWith('X:')) return symbol;
  return symbol.replace('X:', '').replace('USD', '');
};

const toCoinGeckoId = (symbol) => {
  const base = getCryptoBase(symbol).toUpperCase();
  const map = {
    BTC: 'bitcoin',
    ETH: 'ethereum',
    ADA: 'cardano',
    SOL: 'solana',
    DOT: 'polkadot',
    LINK: 'chainlink',
    MATIC: 'matic-network',
    AVAX: 'avalanche-2',
    ATOM: 'cosmos',
    ALGO: 'algorand'
  };
  return map[base] || base.toLowerCase();
};

const toBinanceSymbol = (symbol) => `${getCryptoBase(symbol).toUpperCase()}USDT`;

const toBinanceInterval = (minutes) => {
  if (minutes >= 10080) return '1w';
  if (minutes >= 1440) return '1d';
  if (minutes >= 720) return '12h';
  if (minutes >= 480) return '8h';
  if (minutes >= 360) return '6h';
  if (minutes >= 240) return '4h';
  if (minutes >= 120) return '2h';
  if (minutes >= 60) return '1h';
  if (minutes >= 30) return '30m';
  if (minutes >= 15) return '15m';
  if (minutes >= 5) return '5m';
  if (minutes >= 3) return '3m';
  return '1m';
};

const getBinanceTicker = async (symbol) => {
  const response = await axios.get('https://api.binance.com/api/v3/ticker/24hr', {
    params: { symbol: toBinanceSymbol(symbol) },
    timeout: 10000
  });
  const data = response.data;
  const price = Number(data.lastPrice);
  const open = Number(data.openPrice);
  return {
    symbol,
    price,
    open,
    high: Number(data.highPrice),
    low: Number(data.lowPrice),
    volume: Number(data.volume),
    vwap: Number(data.weightedAvgPrice || price),
    trades: Number(data.count || 0),
    change: Number(data.priceChange || 0),
    changePercent: Number(data.priceChangePercent || 0),
    bid: Number(data.bidPrice || price),
    ask: Number(data.askPrice || price),
    spread: Number(data.askPrice || price) - Number(data.bidPrice || price),
    timestamp: new Date().toISOString()
  };
};

const getBinanceOHLC = async (symbol, intervalMinutes, limitNum) => {
  const response = await axios.get('https://api.binance.com/api/v3/klines', {
    params: {
      symbol: toBinanceSymbol(symbol),
      interval: toBinanceInterval(intervalMinutes),
      limit: Math.min(limitNum, 1000)
    },
    timeout: 12000
  });

  return (response.data || []).map((row) => ({
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    vwap: Number(row[4]),
    volume: Number(row[5]),
    trades: Number(row[8] || 0)
  }));
};

const getCoinGeckoTicker = async (symbol) => {
  const coinId = toCoinGeckoId(symbol);
  const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
    params: {
      ids: coinId,
      vs_currencies: 'usd',
      include_24hr_change: true
    },
    timeout: 10000
  });

  const price = Number(response.data?.[coinId]?.usd);
  const changePercent = Number(response.data?.[coinId]?.usd_24h_change || 0);
  if (!Number.isFinite(price)) {
    throw new Error(`CoinGecko has no ticker data for ${symbol}`);
  }

  const open = price / (1 + (changePercent / 100 || 0));
  return {
    symbol,
    price,
    open: Number.isFinite(open) ? open : price,
    high: price,
    low: price,
    volume: 0,
    vwap: price,
    trades: 0,
    change: price - (Number.isFinite(open) ? open : price),
    changePercent,
    bid: price,
    ask: price,
    spread: 0,
    timestamp: new Date().toISOString()
  };
};

const getCoinGeckoOHLC = async (symbol, intervalMinutes, limitNum) => {
  const coinId = toCoinGeckoId(symbol);
  const requestedDays = Math.max(1, Math.ceil((intervalMinutes * limitNum) / 1440));
  const days = Math.min(requestedDays, 365);

  const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart`, {
    params: {
      vs_currency: 'usd',
      days,
      interval: intervalMinutes >= 1440 ? 'daily' : 'hourly'
    },
    timeout: 12000
  });

  const prices = response.data?.prices || [];
  const candles = prices.map((row) => ({
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[1]),
    low: Number(row[1]),
    close: Number(row[1]),
    vwap: Number(row[1]),
    volume: 0,
    trades: 0
  })).filter((c) => Number.isFinite(c.time) && Number.isFinite(c.open));

  return candles.slice(-limitNum);
};

// Apply security middleware to all routes
router.use(publicCryptoSecurity);

// Get available crypto trading pairs
router.get('/pairs', polygonApiLimiter, async (req, res) => {
  try {
    const response = await makePolygonRequest('/v3/reference/tickers', {
      market: 'crypto',
      active: true,
      limit: 1000
    });

    const usdPairs = (response.results || [])
      .filter((ticker) => ticker.ticker && ticker.ticker.endsWith('USD'))
      .map((ticker) => {
        const base = getCryptoBase(ticker.ticker);
        return {
          symbol: ticker.ticker,
          wsname: `${base}/USD`,
          base,
          quote: 'USD',
          displayName: `${base}/USD`,
          lotSize: 8,
          priceDecimals: 8
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    
    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      pairs: usdPairs,
      total: usdPairs.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error getting crypto pairs:', error.message);
    
    if (error.message.includes('not configured')) {
      return res.status(503).json({
        message: 'Polygon API key is required',
        error: error.message
      });
    }

    if (error.message.includes('timeout')) {
      return res.status(504).json({ 
        message: 'Polygon API timeout',
        error: error.message,
        retryable: true
      });
    }
    
    if (error.message.includes('network error')) {
      return res.status(503).json({ 
        message: 'Network error connecting to Polygon',
        error: error.message,
        retryable: true
      });
    }
    
    res.status(500).json({ 
      message: 'Failed to get crypto pairs',
      error: error.message 
    });
  }
});

// Get current ticker/quote for crypto pair
router.get('/ticker/:pair', polygonApiLimiter, async (req, res) => {
  try {
    const { pair } = req.params;
    
    if (!pair || pair.length === 0) {
      return res.status(400).json({
        message: 'Pair parameter is required',
        error: 'Missing pair parameter'
      });
    }
    
    let formattedTicker;
    try {
      const response = await makePolygonRequest(`/v2/snapshot/locale/global/markets/crypto/tickers/${encodeURIComponent(pair)}`);
      const ticker = response.ticker;
    
      if (!ticker) {
        throw new Error('Invalid ticker data received from Polygon');
      }

      const day = ticker.day || {};
      const lastTradePrice = ticker.lastTrade?.p;
      const ask = ticker.lastQuote?.P ?? lastTradePrice ?? day.c;
      const bid = ticker.lastQuote?.p ?? lastTradePrice ?? day.c;
      const open = day.o ?? day.c ?? lastTradePrice ?? 0;
      const close = day.c ?? lastTradePrice ?? open;
      const high = day.h ?? close;
      const low = day.l ?? close;
      const volume = day.v ?? 0;
      const vwap = day.vw ?? close;

      formattedTicker = {
        symbol: ticker.ticker || pair,
        price: Number(close),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        volume: Number(volume),
        vwap: Number(vwap),
        trades: Number(day.t ?? 0),
        change: Number(close) - Number(open),
        changePercent: Number(open) ? ((Number(close) - Number(open)) / Number(open)) * 100 : 0,
        bid: Number(bid || close),
        ask: Number(ask || close),
        spread: Number((ask || close) - (bid || close)),
        timestamp: new Date().toISOString()
      };
    } catch (polygonError) {
      logWithCooldown(`ticker-polygon-${pair}`, 'warn', `Polygon ticker unavailable for ${pair}; using fallback providers.`);
      try {
        formattedTicker = await getBinanceTicker(pair);
      } catch (binanceError) {
        logWithCooldown(`ticker-binance-${pair}`, 'warn', `Binance ticker fallback failed for ${pair}; using CoinGecko.`);
        formattedTicker = await getCoinGeckoTicker(pair);
      }
    }
    
    res.set('Cache-Control', 'public, max-age=30');
    res.json(formattedTicker);
  } catch (error) {
    logger.error(`Error getting ticker for ${req.params.pair}:`, error.message);
    
    if (error.message.includes('timeout')) {
      return res.status(504).json({ 
        message: 'Polygon API timeout',
        error: error.message,
        retryable: true
      });
    }
    
    if (error.message.includes('network error')) {
      return res.status(503).json({ 
        message: 'Network error connecting to Polygon',
        error: error.message,
        retryable: true
      });
    }
    
    res.status(500).json({ 
      message: 'Failed to get ticker data',
      error: error.message 
    });
  }
});

// Get OHLC data for crypto pair
router.get('/ohlc/:pair', polygonApiLimiter, async (req, res) => {
  try {
    const { pair } = req.params;
    const { interval = 60, since, limit } = req.query; // Default to 1-hour intervals
    
    if (!pair || pair.length === 0) {
      return res.status(400).json({
        message: 'Pair parameter is required',
        error: 'Missing pair parameter'
      });
    }
    
    // Validate interval
    const intervalNum = parseInt(interval);
    if (isNaN(intervalNum) || intervalNum < 1) {
      return res.status(400).json({
        message: 'Invalid interval parameter',
        error: 'Interval must be a positive number'
      });
    }
    
    let limitNum = 720;
    if (limit) {
      limitNum = parseInt(limit);
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 50000) {
        return res.status(400).json({
          message: 'Invalid limit parameter',
          error: 'Limit must be between 1 and 50000'
        });
      }
    }

    const { multiplier, timespan } = mapMinutesToPolygonRange(intervalNum);
    const effectiveIntervalMinutes = multiplier * POLYGON_INTERVAL_TO_MINUTES[timespan];
    const lookbackDays = since ? Math.max(1, Math.ceil((Date.now() - Number(since) * 1000) / 86400000)) : getLookbackDays(limitNum, effectiveIntervalMinutes);
    const to = new Date();
    const from = new Date(to.getTime() - (lookbackDays * 24 * 60 * 60 * 1000));

    let processedData;
    let lastId = 0;
    try {
      const response = await makePolygonRequest(
        `/v2/aggs/ticker/${encodeURIComponent(pair)}/range/${multiplier}/${timespan}/${from.toISOString().slice(0, 10)}/${to.toISOString().slice(0, 10)}`,
        { adjusted: true, sort: 'asc', limit: limitNum }
      );

      const ohlcArray = response.results || [];
      if (!Array.isArray(ohlcArray) || ohlcArray.length === 0) {
        throw new Error('Invalid OHLC data received from Polygon');
      }

      processedData = ohlcArray.map((candle) => ({
        time: Number(candle.t),
        open: Number(candle.o),
        high: Number(candle.h),
        low: Number(candle.l),
        close: Number(candle.c),
        vwap: Number(candle.vw ?? candle.c),
        volume: Number(candle.v ?? 0),
        trades: Number(candle.n ?? 0)
      })).filter((candle) => !isNaN(candle.time) && !isNaN(candle.open));
      lastId = response.queryCount || response.resultsCount || 0;
    } catch (polygonError) {
      logWithCooldown(`ohlc-polygon-${pair}`, 'warn', `Polygon OHLC unavailable for ${pair}; using fallback providers.`);
      try {
        processedData = await getBinanceOHLC(pair, effectiveIntervalMinutes, limitNum);
        lastId = processedData.length;
      } catch (binanceError) {
        logWithCooldown(`ohlc-binance-${pair}`, 'warn', `Binance OHLC fallback failed for ${pair}; using CoinGecko.`);
        processedData = await getCoinGeckoOHLC(pair, effectiveIntervalMinutes, limitNum);
        lastId = processedData.length;
      }
    }

    processedData = processedData.slice(-limitNum).sort((a, b) => a.time - b.time);

    res.set('Cache-Control', 'public, max-age=60');
    
    res.json({
      symbol: pair,
      data: processedData,
      interval: intervalNum,
      lastId,
      count: processedData.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error getting OHLC data for ${req.params.pair}:`, error.message);
    
    if (error.message.includes('timeout')) {
      return res.status(504).json({ 
        message: 'Polygon API timeout',
        error: error.message,
        retryable: true
      });
    }
    
    if (error.message.includes('network error')) {
      return res.status(503).json({ 
        message: 'Network error connecting to Polygon',
        error: error.message,
        retryable: true
      });
    }
    
    res.status(500).json({ 
      message: 'Failed to get OHLC data',
      error: error.message 
    });
  }
});

// Get recent trades for a pair
router.get('/trades/:pair', async (req, res) => {
  try {
    const { pair } = req.params;
    const { since, limit = 200 } = req.query;

    const response = await makePolygonRequest(`/v3/trades/${encodeURIComponent(pair)}`, {
      timestamp: since,
      order: 'desc',
      limit: Math.min(Number(limit) || 200, 500)
    });

    const trades = response.results || [];
    const formattedTrades = trades.map((trade) => ({
      price: Number(trade.price),
      volume: Number(trade.size),
      time: Number(trade.participant_timestamp || trade.sip_timestamp || trade.trf_timestamp || Date.now()) / 1000000,
      side: trade.conditions?.includes(2) ? 'b' : 's',
      type: trade.exchange ? 'm' : 'l',
      misc: ''
    }));
    
    res.json({
      symbol: pair,
      trades: formattedTrades,
      lastId: response.next_url || null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error getting trades for ${req.params.pair}:`, error.message);
    res.status(500).json({ 
      message: 'Failed to get trades data',
      error: error.message 
    });
  }
});

// Get order book for a pair
router.get('/orderbook/:pair', async (req, res) => {
  try {
    const { pair } = req.params;
    const { count = 100 } = req.query; // Number of entries to return

    const response = await makePolygonRequest(`/v3/quotes/${encodeURIComponent(pair)}`, {
      order: 'desc',
      limit: Math.min(Number(count) || 100, 500)
    });

    const quotes = response.results || [];
    const asks = quotes.map((quote) => ({
      price: Number(quote.ask_price),
      volume: Number(quote.ask_size ?? 0),
      timestamp: Number(quote.participant_timestamp || quote.sip_timestamp || Date.now()) / 1000000
    })).filter((q) => Number.isFinite(q.price));

    const bids = quotes.map((quote) => ({
      price: Number(quote.bid_price),
      volume: Number(quote.bid_size ?? 0),
      timestamp: Number(quote.participant_timestamp || quote.sip_timestamp || Date.now()) / 1000000
    })).filter((q) => Number.isFinite(q.price));
    
    res.json({
      symbol: pair,
      asks,
      bids,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error getting orderbook for ${req.params.pair}:`, error.message);
    res.status(500).json({ 
      message: 'Failed to get orderbook data',
      error: error.message 
    });
  }
});

// Get spread data for a pair
router.get('/spread/:pair', async (req, res) => {
  try {
    const { pair } = req.params;
    const { since, limit = 200 } = req.query;

    const response = await makePolygonRequest(`/v3/quotes/${encodeURIComponent(pair)}`, {
      timestamp: since,
      order: 'desc',
      limit: Math.min(Number(limit) || 200, 500)
    });

    const quotes = response.results || [];
    const formattedSpreads = quotes.map((quote) => ({
      time: Number(quote.participant_timestamp || quote.sip_timestamp || Date.now()) / 1000000,
      bid: Number(quote.bid_price),
      ask: Number(quote.ask_price)
    }));
    
    res.json({
      symbol: pair,
      spreads: formattedSpreads,
      lastId: response.next_url || null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error getting spread data for ${req.params.pair}:`, error.message);
    res.status(500).json({ 
      message: 'Failed to get spread data',
      error: error.message 
    });
  }
});

// Health check endpoint
router.get('/health', healthCheckLimiter, async (req, res) => {
  try {
    const response = await makePolygonRequest('/v1/marketstatus/now');
    const hasApiKey = !!config.POLYGON_API_KEY;
    
    res.json({
      status: 'healthy',
      provider: 'polygon',
      marketStatus: response,
      apiKeysConfigured: hasApiKey,
      features: {
        publicData: true,
        privateData: false,
        realTimeWebSocket: false
      },
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Polygon API health check failed:', error.message);
    
    res.status(503).json({
      status: 'unhealthy',
      provider: 'polygon',
      error: error.message,
      features: {
        publicData: false,
        privateData: false,
        realTimeWebSocket: false
      },
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;