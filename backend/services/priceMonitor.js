const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const { getRedisClient } = require('../utils/redis');
const db = require('../models/database');
const {
  evaluateWatchlistOpportunity,
  floorTimeBucketUtc
} = require('./watchlistOpportunityEvaluator');
const { mergeNotificationPreferences } = require('../utils/notificationPreferences');
const { recordOpportunitySignal } = require('./opportunitySignalsPersistence');
const emailService = require('./emailService');

const OPPORTUNITY_DEDUPE_TTL_SEC = 3600;

class PriceMonitor {
  constructor(io) {
    this.io = io;
    this.redis = getRedisClient();
    /** Fallback when Redis SET NX fails — Map key → expiry ms */
    this.opportunityDedupeMemory = new Map();
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

    const response = await axios.get(`${config.MARKET_DATA_API_URL}${path}`, {
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

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          const priceData = result.value;
          prices.push(priceData);

          // Store in Redis for caching
          this.redis.setEx(
            `price:${priceData.type}:${priceData.symbol}`,
            300, // 5 minutes TTL
            JSON.stringify(priceData)
          );

          this.checkPriceDrops(priceData);
          try {
            await this.emitWatchlistOpportunitySignals(priceData);
          } catch (oppErr) {
            logger.warn(`Opportunity signals skipped: ${oppErr.message}`);
          }
        }
      }
      
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

  /**
   * Deterministic opportunity flags vs alert baseline_price; Redis dedupe per user/symbol/hour bucket.
   */
  async emitWatchlistOpportunitySignals(priceData) {
    const assetType = priceData.type === 'stock' ? 'stock' : 'crypto';
    const symbol = String(priceData.symbol || '').toUpperCase();
    if (!symbol) return;

    const dayChangePct =
      assetType === 'stock'
        ? Number(priceData.changePercent)
        : Number(priceData.change24h);

    let rows;
    try {
      const result = await db.query(
        `SELECT ua.user_id, ua.baseline_price, u.notification_preferences, u.email
         FROM user_alerts ua
         INNER JOIN users u ON u.id = ua.user_id
         WHERE ua.active = true
           AND UPPER(TRIM(ua.symbol)) = $1
           AND ua.asset_type = $2
           AND ua.baseline_price IS NOT NULL`,
        [symbol, assetType]
      );
      rows = result.rows;
    } catch (err) {
      logger.error('emitWatchlistOpportunitySignals query failed:', err);
      return;
    }

    if (!rows.length) return;

    for (const row of rows) {
      const baselinePrice = Number(row.baseline_price);
      const evalResult = evaluateWatchlistOpportunity({
        symbol,
        price: priceData.price,
        baselinePrice,
        dayChangePct: Number.isFinite(dayChangePct) ? dayChangePct : null,
        recentAbsAvgMovePct: null
      });

      if (!evalResult.evaluated || !evalResult.flags.length) continue;

      const bucket = floorTimeBucketUtc(new Date(), 60);
      const dedupeRedisKey = `oppdedupe:${row.user_id}:${assetType}:${symbol}:${bucket}`;
      const allowed = await this.tryOpportunityDedupe(dedupeRedisKey);
      if (!allowed) continue;

      const payload = {
        kind: 'opportunity_signal',
        symbol,
        assetType,
        flags: evalResult.flags,
        reasons: evalResult.reasons,
        vsBaselinePct: evalResult.vsBaselinePct,
        price: priceData.price,
        timestamp: new Date().toISOString()
      };

      await recordOpportunitySignal({
        userId: row.user_id,
        symbol,
        assetType,
        flags: evalResult.flags,
        reasons: evalResult.reasons,
        vsBaselinePct: evalResult.vsBaselinePct,
        price: priceData.price
      });

      const prefs = mergeNotificationPreferences(row.notification_preferences);
      if (prefs.opportunityToasts) {
        this.io.to(`user_${row.user_id}`).emit('opportunitySignal', payload);
      }

      if (prefs.email && row.email && emailService.isConfigured()) {
        await emailService.sendOpportunitySignalEmail(row.email, payload);
      }

      logger.info(
        `Opportunity signal [${evalResult.flags.join(',')}] → user ${row.user_id} ${assetType}:${symbol}` +
          (prefs.opportunityToasts ? '' : ' (toast muted)')
      );
    }
  }

  async tryOpportunityDedupe(redisKey) {
    try {
      const setResult = await this.redis.set(redisKey, '1', {
        NX: true,
        EX: OPPORTUNITY_DEDUPE_TTL_SEC
      });
      return setResult === 'OK';
    } catch {
      const now = Date.now();
      const ttlMs = OPPORTUNITY_DEDUPE_TTL_SEC * 1000;
      const until = this.opportunityDedupeMemory.get(redisKey);
      if (until && until > now) return false;
      this.opportunityDedupeMemory.set(redisKey, now + ttlMs);
      return true;
    }
  }

  async getUserWatchlists() {
    try {
      const result = await db.query(`
        SELECT symbols FROM user_watchlists WHERE name = 'Main'
      `);

      const allSymbols = new Set();
      for (const row of result.rows) {
        const raw = row.symbols;
        const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? JSON.parse(raw || '[]') : [];
        for (const t of arr) {
          if (typeof t === 'string' && t.includes(':')) {
            allSymbols.add(t);
          }
        }
      }

      if (allSymbols.size > 0) {
        return [{ symbols: [...allSymbols] }];
      }

      const legacy = await db.query(`
        SELECT DISTINCT symbol, asset_type
        FROM user_alerts
        WHERE active = true
      `);
      const symbols = legacy.rows.map((row) => `${row.asset_type.toUpperCase()}:${row.symbol}`);
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