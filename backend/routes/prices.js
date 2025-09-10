const express = require('express');
const router = express.Router();
const PriceMonitor = require('../services/priceMonitor');
const auth = require('../middleware/auth');
const logger = require('../utils/logger');

const priceMonitor = new PriceMonitor();

// Get current prices for symbols
router.get('/current', async (req, res) => {
  try {
    const { symbols } = req.query;
    if (!symbols) {
      return res.status(400).json({ message: 'Symbols parameter is required' });
    }

    const symbolList = symbols.split(',').map(s => s.trim().toUpperCase());
    const prices = [];

    for (const symbolWithType of symbolList) {
      const [type, symbol] = symbolWithType.split(':');
      if (!type || !symbol) continue;

      const cached = await priceMonitor.getCachedPrice(type.toLowerCase(), symbol);
      if (cached) {
        prices.push(cached);
      } else {
        // Trigger fresh price fetch
        let priceData = null;
        if (type.toLowerCase() === 'crypto') {
          priceData = await priceMonitor.getCryptoPrice(symbol);
        } else if (type.toLowerCase() === 'stock') {
          priceData = await priceMonitor.getStockPrice(symbol);
        }
        if (priceData) prices.push(priceData);
      }
    }

    res.json(prices);
  } catch (error) {
    logger.error('Error getting current prices:', error);
    res.status(500).json({ message: 'Failed to get prices' });
  }
});

// Get popular symbols
router.get('/popular', (req, res) => {
  try {
    const popularSymbols = {
      crypto: [
        { symbol: 'BTC', name: 'Bitcoin', type: 'crypto' },
        { symbol: 'ETH', name: 'Ethereum', type: 'crypto' },
        { symbol: 'ADA', name: 'Cardano', type: 'crypto' },
        { symbol: 'SOL', name: 'Solana', type: 'crypto' },
        { symbol: 'DOT', name: 'Polkadot', type: 'crypto' },
        { symbol: 'MATIC', name: 'Polygon', type: 'crypto' },
        { symbol: 'LINK', name: 'Chainlink', type: 'crypto' },
        { symbol: 'UNI', name: 'Uniswap', type: 'crypto' }
      ],
      stocks: [
        { symbol: 'AAPL', name: 'Apple Inc.', type: 'stock' },
        { symbol: 'GOOGL', name: 'Alphabet Inc.', type: 'stock' },
        { symbol: 'MSFT', name: 'Microsoft Corp.', type: 'stock' },
        { symbol: 'TSLA', name: 'Tesla Inc.', type: 'stock' },
        { symbol: 'AMZN', name: 'Amazon.com Inc.', type: 'stock' },
        { symbol: 'NVDA', name: 'NVIDIA Corp.', type: 'stock' },
        { symbol: 'META', name: 'Meta Platforms Inc.', type: 'stock' },
        { symbol: 'NFLX', name: 'Netflix Inc.', type: 'stock' }
      ]
    };

    res.json(popularSymbols);
  } catch (error) {
    logger.error('Error getting popular symbols:', error);
    res.status(500).json({ message: 'Failed to get popular symbols' });
  }
});

// Search symbols
router.get('/search', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query || query.length < 2) {
      return res.status(400).json({ message: 'Query must be at least 2 characters' });
    }

    // Simple search implementation - in production, you'd use a proper search service
    const searchQuery = query.toLowerCase();
    const allSymbols = [
      // Crypto symbols
      { symbol: 'BTC', name: 'Bitcoin', type: 'crypto' },
      { symbol: 'ETH', name: 'Ethereum', type: 'crypto' },
      { symbol: 'ADA', name: 'Cardano', type: 'crypto' },
      { symbol: 'SOL', name: 'Solana', type: 'crypto' },
      { symbol: 'DOT', name: 'Polkadot', type: 'crypto' },
      { symbol: 'MATIC', name: 'Polygon', type: 'crypto' },
      { symbol: 'LINK', name: 'Chainlink', type: 'crypto' },
      { symbol: 'UNI', name: 'Uniswap', type: 'crypto' },
      // Stock symbols
      { symbol: 'AAPL', name: 'Apple Inc.', type: 'stock' },
      { symbol: 'GOOGL', name: 'Alphabet Inc.', type: 'stock' },
      { symbol: 'MSFT', name: 'Microsoft Corp.', type: 'stock' },
      { symbol: 'TSLA', name: 'Tesla Inc.', type: 'stock' },
      { symbol: 'AMZN', name: 'Amazon.com Inc.', type: 'stock' },
      { symbol: 'NVDA', name: 'NVIDIA Corp.', type: 'stock' },
      { symbol: 'META', name: 'Meta Platforms Inc.', type: 'stock' },
      { symbol: 'NFLX', name: 'Netflix Inc.', type: 'stock' }
    ];

    const results = allSymbols.filter(item => 
      item.symbol.toLowerCase().includes(searchQuery) ||
      item.name.toLowerCase().includes(searchQuery)
    );

    res.json(results.slice(0, 10)); // Limit to 10 results
  } catch (error) {
    logger.error('Error searching symbols:', error);
    res.status(500).json({ message: 'Search failed' });
  }
});

module.exports = router;