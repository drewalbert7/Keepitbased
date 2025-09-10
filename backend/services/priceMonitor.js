const axios = require('axios');
const logger = require('../utils/logger');
const { getRedisClient } = require('../utils/redis');
const db = require('../models/database');

class PriceMonitor {
  constructor(io) {
    this.io = io;
    this.redis = getRedisClient();
    this.lastPrices = new Map();
    
    // Popular symbols to track by default
    this.defaultSymbols = {
      crypto: ['BTC', 'ETH', 'ADA', 'DOT', 'SOL', 'MATIC', 'LINK', 'UNI'],
      stocks: ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN', 'NVDA', 'META', 'NFLX']
    };
  }

  async getCryptoPrice(symbol) {
    try {
      // Using CoinGecko free API (no key required)
      const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price`, {
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
        throw new Error(`No data found for ${symbol}`);
      }
      
      return {
        symbol: symbol,
        price: data.usd,
        change24h: data.usd_24h_change || 0,
        timestamp: Date.now(),
        type: 'crypto'
      };
    } catch (error) {
      logger.error(`Error fetching crypto price for ${symbol}:`, error.message);
      return null;
    }
  }

  async getStockPrice(symbol) {
    try {
      // Using Alpha Vantage API (free tier)
      const apiKey = process.env.ALPHA_VANTAGE_API_KEY || 'demo';
      const response = await axios.get(`https://www.alphavantage.co/query`, {
        params: {
          function: 'GLOBAL_QUOTE',
          symbol: symbol,
          apikey: apiKey
        },
        timeout: 10000
      });
      
      const quote = response.data['Global Quote'];
      if (!quote || !quote['05. price']) {
        throw new Error(`No data found for ${symbol}`);
      }
      
      return {
        symbol: symbol,
        price: parseFloat(quote['05. price']),
        change24h: parseFloat(quote['09. change']) || 0,
        changePercent: parseFloat(quote['10. change percent'].replace('%', '')) || 0,
        timestamp: Date.now(),
        type: 'stock'
      };
    } catch (error) {
      logger.error(`Error fetching stock price for ${symbol}:`, error.message);
      return null;
    }
  }

  getCoinGeckoId(symbol) {
    const coinMap = {
      'BTC': 'bitcoin',
      'ETH': 'ethereum',
      'ADA': 'cardano',
      'DOT': 'polkadot',
      'SOL': 'solana',
      'MATIC': 'matic-network',
      'LINK': 'chainlink',
      'UNI': 'uniswap'
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
          this.redis.setex(
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
        SELECT DISTINCT symbol, type 
        FROM user_alerts 
        WHERE active = true
      `);
      
      const symbols = result.rows.map(row => `${row.type.toUpperCase()}:${row.symbol}`);
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