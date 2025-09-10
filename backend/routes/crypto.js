const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../config');
const secureConfig = require('../utils/secureConfig');
const cryptoSecurity = require('../utils/cryptoSecurity');
const { 
  publicCryptoSecurity, 
  privateCryptoSecurity 
} = require('../middleware/cryptoSecurity');

const KRAKEN_API_URL = 'https://api.kraken.com';
const KRAKEN_WS_URL = 'wss://ws.kraken.com';

// Kraken API helper functions
const createKrakenSignature = (path, data, secret) => {
  const message = data + crypto.createHash('sha256').update(data).digest();
  const hmac = crypto.createHmac('sha512', Buffer.from(secret, 'base64'));
  return hmac.update(path + message).digest('base64');
};

const makePrivateRequest = async (endpoint, data = {}) => {
  // Get API credentials from secure storage
  const apiKey = secureConfig.getApiKey('KRAKEN_API_KEY') || config.KRAKEN_API_KEY;
  const apiSecret = secureConfig.getApiKey('KRAKEN_API_SECRET') || config.KRAKEN_API_SECRET;
  
  if (!apiKey || !apiSecret) {
    throw new Error('Kraken API credentials not configured');
  }
  
  const nonce = Date.now() * 1000;
  data.nonce = nonce;
  
  const postData = new URLSearchParams(data).toString();
  const signature = createKrakenSignature(`/0/private/${endpoint}`, postData, apiSecret);
  
  const headers = {
    'API-Key': apiKey,
    'API-Sign': signature,
    'Content-Type': 'application/x-www-form-urlencoded'
  };
  
  const response = await axios.post(`${KRAKEN_API_URL}/0/private/${endpoint}`, postData, { headers });
  return response.data;
};

// Apply security middleware to all routes
router.use(publicCryptoSecurity);

// Get available crypto trading pairs
router.get('/pairs', async (req, res) => {
  try {
    const response = await axios.get(`${KRAKEN_API_URL}/0/public/AssetPairs`);
    
    if (response.data.error && response.data.error.length > 0) {
      throw new Error(response.data.error.join(', '));
    }
    
    const pairs = response.data.result;
    
    // Filter for USD pairs and format them nicely
    const usdPairs = Object.entries(pairs)
      .filter(([, pair]) => pair.quote === 'ZUSD' || pair.quote === 'USD')
      .map(([pairName, pair]) => ({
        symbol: pairName,
        wsname: pair.wsname,
        base: pair.base,
        quote: pair.quote,
        displayName: `${pair.base}/${pair.quote}`,
        lotSize: pair.lot_decimals,
        priceDecimals: pair.pair_decimals
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    
    res.json({
      pairs: usdPairs,
      total: usdPairs.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error getting crypto pairs:', error.message);
    res.status(500).json({ 
      message: 'Failed to get crypto pairs',
      error: error.message 
    });
  }
});

// Get current ticker/quote for crypto pair
router.get('/ticker/:pair', async (req, res) => {
  try {
    const { pair } = req.params;
    
    const response = await axios.get(`${KRAKEN_API_URL}/0/public/Ticker`, {
      params: { pair }
    });
    
    if (response.data.error && response.data.error.length > 0) {
      throw new Error(response.data.error.join(', '));
    }
    
    const ticker = Object.values(response.data.result)[0];
    const pairInfo = Object.keys(response.data.result)[0];
    
    const formattedTicker = {
      symbol: pairInfo,
      price: parseFloat(ticker.c[0]), // Last trade price
      open: parseFloat(ticker.o), // Today's opening price
      high: parseFloat(ticker.h[1]), // Today's high
      low: parseFloat(ticker.l[1]), // Today's low
      volume: parseFloat(ticker.v[1]), // 24h volume
      vwap: parseFloat(ticker.p[1]), // 24h volume weighted average price
      trades: parseInt(ticker.t[1]), // Number of trades today
      change: parseFloat(ticker.c[0]) - parseFloat(ticker.o),
      changePercent: ((parseFloat(ticker.c[0]) - parseFloat(ticker.o)) / parseFloat(ticker.o)) * 100,
      bid: parseFloat(ticker.b[0]),
      ask: parseFloat(ticker.a[0]),
      spread: parseFloat(ticker.a[0]) - parseFloat(ticker.b[0]),
      timestamp: new Date().toISOString()
    };
    
    res.json(formattedTicker);
  } catch (error) {
    logger.error(`Error getting ticker for ${req.params.pair}:`, error.message);
    res.status(500).json({ 
      message: 'Failed to get ticker data',
      error: error.message 
    });
  }
});

// Get OHLC data for crypto pair
router.get('/ohlc/:pair', async (req, res) => {
  try {
    const { pair } = req.params;
    const { interval = 60, since } = req.query; // Default to 1-hour intervals
    
    const params = { pair, interval };
    if (since) params.since = since;
    
    const response = await axios.get(`${KRAKEN_API_URL}/0/public/OHLC`, { params });
    
    if (response.data.error && response.data.error.length > 0) {
      throw new Error(response.data.error.join(', '));
    }
    
    const ohlcArray = Object.values(response.data.result)[0];
    const lastId = response.data.result.last;
    
    const chartData = ohlcArray.map(candle => ({
      time: parseInt(candle[0]), // Unix timestamp
      open: parseFloat(candle[1]),
      high: parseFloat(candle[2]),
      low: parseFloat(candle[3]),
      close: parseFloat(candle[4]),
      vwap: parseFloat(candle[5]),
      volume: parseFloat(candle[6]),
      trades: parseInt(candle[7])
    }));
    
    res.json({
      symbol: pair,
      data: chartData,
      interval: parseInt(interval),
      lastId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error getting OHLC data for ${req.params.pair}:`, error.message);
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
    const { since } = req.query;
    
    const params = { pair };
    if (since) params.since = since;
    
    const response = await axios.get(`${KRAKEN_API_URL}/0/public/Trades`, { params });
    
    if (response.data.error && response.data.error.length > 0) {
      throw new Error(response.data.error.join(', '));
    }
    
    const trades = Object.values(response.data.result)[0];
    const lastId = response.data.result.last;
    
    const formattedTrades = trades.map(trade => ({
      price: parseFloat(trade[0]),
      volume: parseFloat(trade[1]),
      time: parseFloat(trade[2]),
      side: trade[3], // 'b' = buy, 's' = sell
      type: trade[4], // 'm' = market, 'l' = limit
      misc: trade[5]
    }));
    
    res.json({
      symbol: pair,
      trades: formattedTrades,
      lastId,
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
    
    const response = await axios.get(`${KRAKEN_API_URL}/0/public/Depth`, {
      params: { pair, count }
    });
    
    if (response.data.error && response.data.error.length > 0) {
      throw new Error(response.data.error.join(', '));
    }
    
    const orderbook = Object.values(response.data.result)[0];
    
    const formatOrders = (orders) => orders.map(order => ({
      price: parseFloat(order[0]),
      volume: parseFloat(order[1]),
      timestamp: parseInt(order[2])
    }));
    
    res.json({
      symbol: pair,
      asks: formatOrders(orderbook.asks),
      bids: formatOrders(orderbook.bids),
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
    const { since } = req.query;
    
    const params = { pair };
    if (since) params.since = since;
    
    const response = await axios.get(`${KRAKEN_API_URL}/0/public/Spread`, { params });
    
    if (response.data.error && response.data.error.length > 0) {
      throw new Error(response.data.error.join(', '));
    }
    
    const spreads = Object.values(response.data.result)[0];
    const lastId = response.data.result.last;
    
    const formattedSpreads = spreads.map(spread => ({
      time: parseInt(spread[0]),
      bid: parseFloat(spread[1]),
      ask: parseFloat(spread[2])
    }));
    
    res.json({
      symbol: pair,
      spreads: formattedSpreads,
      lastId,
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

// Private endpoints (require API keys)

// Get account balance (requires API keys)
router.get('/balance', privateCryptoSecurity, async (req, res) => {
  try {
    const result = await makePrivateRequest('Balance');
    
    if (result.error && result.error.length > 0) {
      throw new Error(result.error.join(', '));
    }
    
    // Format balance data
    const balances = Object.entries(result.result).map(([asset, balance]) => ({
      asset,
      balance: parseFloat(balance),
      available: parseFloat(balance) // Simplified - could include locked amounts
    }));
    
    res.json({
      balances,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error getting account balance:', error.message);
    
    if (error.message.includes('not configured')) {
      return res.status(400).json({ 
        message: 'Kraken API credentials required for this endpoint',
        error: error.message 
      });
    }
    
    res.status(500).json({ 
      message: 'Failed to get account balance',
      error: error.message 
    });
  }
});

// Get trade history (requires API keys)
router.get('/trades-history', privateCryptoSecurity, async (req, res) => {
  try {
    const { start, end, ofs } = req.query;
    const params = {};
    
    if (start) params.start = start;
    if (end) params.end = end;
    if (ofs) params.ofs = ofs;
    
    const result = await makePrivateRequest('TradesHistory', params);
    
    if (result.error && result.error.length > 0) {
      throw new Error(result.error.join(', '));
    }
    
    res.json({
      trades: result.result.trades,
      count: result.result.count,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error getting trade history:', error.message);
    
    if (error.message.includes('not configured')) {
      return res.status(400).json({ 
        message: 'Kraken API credentials required for this endpoint',
        error: error.message 
      });
    }
    
    res.status(500).json({ 
      message: 'Failed to get trade history',
      error: error.message 
    });
  }
});

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    const response = await axios.get(`${KRAKEN_API_URL}/0/public/SystemStatus`);
    
    const hasApiKeys = !!(config.KRAKEN_API_KEY && config.KRAKEN_API_SECRET);
    
    res.json({
      status: 'healthy',
      krakenStatus: response.data.result,
      wsUrl: KRAKEN_WS_URL,
      apiKeysConfigured: hasApiKeys,
      features: {
        publicData: true,
        privateData: hasApiKeys,
        realTimeWebSocket: true
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Kraken API health check failed:', error.message);
    res.status(503).json({
      status: 'unhealthy',
      error: 'Kraken API unavailable',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;