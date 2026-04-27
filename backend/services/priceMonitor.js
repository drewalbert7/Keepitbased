const axios = require('axios');
const logger = require('../utils/logger');
const { getRedisClient } = require('../utils/redis');
const db = require('../models/database');

class PriceMonitor {
  constructor(io) {
    this.io = io;
    this.redis = getRedisClient();
    this.lastPrices = new Map();
    this.polygonCryptoUnavailable = false;
    this.polygonStocksUnavailable = false;
    this.coinGeckoRateLimitedUntil = 0;
    this.logCooldownMs = 5 * 60 * 1000;
    this.lastLogByKey = new Map();
    
    // Popular symbols to track by default
    this.defaultSymbols = {
      crypto: ['BTC', 'ETH'],
      stocks: []
    };
  }

  async getCryptoPrice(symbol) {
    try {
      if (this.polygonCryptoUnavailable) {
        return this.getCryptoPriceFromBinance(symbol);
      }

      const polygonSymbol = this.toPolygonCryptoSymbol(symbol);
      const response = await this.makePolygonRequest(`/v2/snapshot/locale/global/markets/crypto/tickers/${encodeURIComponent(polygonSymbol)}`);
      const ticker = response.ticker;

      if (!ticker) {
        throw new Error(`No Polygon crypto snapshot found for ${polygonSymbol}`);
      }

      const open = Number(ticker.day?.o ?? ticker.day?.c ?? 0);
      const close = Number(ticker.day?.c ?? ticker.lastTrade?.p ?? open);
      const changePercent = open ? ((close - open) / open) * 100 : 0;

      return {
        symbol: symbol,
        price: close,
        change24h: changePercent,
        timestamp: Date.now(),
        type: 'crypto'
      };
    } catch (error) {
      if (error.response?.status === 403 && !this.polygonCryptoUnavailable) {
        this.polygonCryptoUnavailable = true;
        this.logWithCooldown('polygon-crypto-entitlement', 'warn', 'Polygon crypto snapshot endpoints are unavailable for this API key; using fallback providers.');
      }
      this.logWithCooldown(`polygon-crypto-failure-${symbol}`, 'warn', `Polygon crypto price fetch failed for ${symbol}; falling back to Binance.`);
      return this.getCryptoPriceFromBinance(symbol);
    }
  }
  async getCryptoPriceFromBinance(symbol) {
    try {
      const response = await axios.get('https://api.binance.com/api/v3/ticker/24hr', {
        params: { symbol: `${symbol.toUpperCase()}USDT` },
        timeout: 10000
      });

      return {
        symbol,
        price: Number(response.data.lastPrice),
        change24h: Number(response.data.priceChangePercent || 0),
        timestamp: Date.now(),
        type: 'crypto'
      };
    } catch (error) {
      this.logWithCooldown(`binance-crypto-failure-${symbol}`, 'warn', `Binance crypto fallback failed for ${symbol}; trying CoinGecko.`);
      return this.getCryptoPriceFromCoinGecko(symbol);
    }
  }


  async getStockPrice(symbol) {
    try {
      if (this.polygonStocksUnavailable) {
        return null;
      }

      const response = await this.makePolygonRequest(`/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(symbol)}`);
      const ticker = response.ticker;

      if (!ticker) {
        throw new Error(`No Polygon stock snapshot found for ${symbol}`);
      }

      const open = Number(ticker.day?.o ?? ticker.day?.c ?? 0);
      const close = Number(ticker.day?.c ?? ticker.lastTrade?.p ?? open);
      const change = close - open;
      const changePercent = open ? (change / open) * 100 : 0;

      return {
        symbol: symbol,
        price: close,
        change24h: change,
        changePercent,
        timestamp: Date.now(),
        type: 'stock'
      };
    } catch (error) {
      if (error.response?.status === 403 && !this.polygonStocksUnavailable) {
        this.polygonStocksUnavailable = true;
        this.logWithCooldown('polygon-stock-entitlement', 'warn', 'Polygon stock snapshot endpoints are unavailable for this API key.');
      }
      this.logWithCooldown(`polygon-stock-failure-${symbol}`, 'warn', `Polygon stock price fetch failed for ${symbol}.`);
      return null;
    }
  }

  async getCryptoPriceFromCoinGecko(symbol) {
    try {
      if (Date.now() < this.coinGeckoRateLimitedUntil) {
        return this.getLastKnownPrice('crypto', symbol);
      }

      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
        params: {
          ids: this.getCoinGeckoId(symbol),
          vs_currencies: 'usd',
          include_24hr_change: true
        },
        timeout: 10000
      });

      const coinId = this.getCoinGeckoId(symbol);
      const data = response.data[coinId];
      if (!data) {
        throw new Error(`No CoinGecko data found for ${symbol}`);
      }

      return {
        symbol,
        price: Number(data.usd),
        change24h: Number(data.usd_24h_change || 0),
        timestamp: Date.now(),
        type: 'crypto'
      };
    } catch (error) {
      if (error.response?.status === 429) {
        this.coinGeckoRateLimitedUntil = Date.now() + 60 * 1000;
        this.logWithCooldown('coingecko-rate-limit', 'warn', 'CoinGecko rate-limited. Using cached crypto prices for 60s.');
        return this.getLastKnownPrice('crypto', symbol);
      }
      this.logWithCooldown(`coingecko-failure-${symbol}`, 'error', `CoinGecko fallback failed for ${symbol}.`);
      return null;
    }
  }

  async makePolygonRequest(path, params = {}) {
    const apiKey = process.env.POLYGON_API_KEY || process.env.MASSIVE_API_KEY;
    if (!apiKey) {
      throw new Error('POLYGON_API_KEY is not configured');
    }

    const response = await axios.get(`https://api.polygon.io${path}`, {
      params: {
        ...params,
        apiKey
      },
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Polygon-API-Key': apiKey
      },
      timeout: 10000
    });

    return response.data;
  }

  toPolygonCryptoSymbol(symbol) {
    return `X:${symbol.toUpperCase()}USD`;
  }

  getLastKnownPrice(type, symbol) {
    const key = `${type}:${symbol}`;
    return this.lastPrices.get(key) || null;
  }

  logWithCooldown(key, level, message) {
    const last = this.lastLogByKey.get(key) || 0;
    if (Date.now() - last < this.logCooldownMs) {
      return;
    }
    this.lastLogByKey.set(key, Date.now());
    logger[level](message);
  }

  getCoinGeckoId(symbol) {
    const coinMap = {
      BTC: 'bitcoin',
      ETH: 'ethereum',
      ADA: 'cardano',
      DOT: 'polkadot',
      SOL: 'solana',
      MATIC: 'matic-network',
      LINK: 'chainlink',
      UNI: 'uniswap'
    };
    return coinMap[symbol] || symbol.toLowerCase();
  }

  async checkAllPrices() {
    logger.info('Starting price check cycle...');
    
    try {
      // Get user watchlists from database
      const watchlists = await this.getUserWatchlists();
      const allSymbols = new Set();
      
      // Collect all symbols from user watchlists
      watchlists.forEach(watchlist => {
        watchlist.symbols.forEach(symbol => allSymbols.add(symbol));
      });
      
      // Add default symbols if no user symbols
      if (allSymbols.size === 0) {
        this.defaultSymbols.crypto.forEach(symbol => allSymbols.add(`CRYPTO:${symbol}`));
        this.defaultSymbols.stocks.forEach(symbol => allSymbols.add(`STOCK:${symbol}`));
      }
      
      const pricePromises = [];
      
      for (const symbolWithType of allSymbols) {
        const [type, symbol] = symbolWithType.split(':');
        
        if (type === 'CRYPTO') {
          pricePromises.push(this.getCryptoPrice(symbol));
        } else if (type === 'STOCK') {
          pricePromises.push(this.getStockPrice(symbol));
        }
      }
      
      const results = await Promise.allSettled(pricePromises);
      const prices = [];
      
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          const priceData = result.value;
          prices.push(priceData);
          
          // Store in Redis for caching
          this.redis.setEx(
            `price:${priceData.type}:${priceData.symbol}`,
            300, // 5 minutes TTL
            JSON.stringify(priceData)
          );
          
          // Check for price drops
          this.checkPriceDrops(priceData);
        }
      });
      
      // Emit prices to connected clients
      this.io.to('price-updates').emit('priceUpdate', prices);
      
      logger.info(`Price check completed: ${prices.length} symbols updated`);
      return prices;
      
    } catch (error) {
      logger.error('Error in checkAllPrices:', error);
      return [];
    }
  }

  async checkPriceDrops(currentPrice) {
    const key = `${currentPrice.type}:${currentPrice.symbol}`;
    const lastPrice = this.lastPrices.get(key);
    
    if (lastPrice && lastPrice.price > currentPrice.price) {
      const dropPercentage = ((lastPrice.price - currentPrice.price) / lastPrice.price) * 100;
      
      if (dropPercentage >= 5) { // Minimum 5% drop
        logger.info(`Price drop detected: ${key} dropped ${dropPercentage.toFixed(2)}%`);
        
        // Emit price drop event
        this.io.emit('priceDrop', {
          symbol: currentPrice.symbol,
          type: currentPrice.type,
          currentPrice: currentPrice.price,
          previousPrice: lastPrice.price,
          dropPercentage: dropPercentage,
          timestamp: currentPrice.timestamp
        });
      }
    }
    
    this.lastPrices.set(key, currentPrice);
  }

  async getUserWatchlists() {
    try {
      const result = await db.query(`
        SELECT DISTINCT symbol, asset_type 
        FROM user_alerts 
        WHERE active = true
      `);
      
      const symbols = result.rows.map(row => `${row.asset_type.toUpperCase()}:${row.symbol}`);
      return [{ symbols }];
      
    } catch (error) {
      logger.error('Error getting user watchlists:', error);
      return [];
    }
  }

  async getCachedPrice(type, symbol) {
    try {
      const cached = await this.redis.get(`price:${type}:${symbol}`);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.error(`Error getting cached price for ${type}:${symbol}:`, error);
      return null;
    }
  }
}

module.exports = PriceMonitor;