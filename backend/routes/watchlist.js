const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const auth = require('../middleware/auth');
const logger = require('../utils/logger');
const AlertService = require('../services/alertService');
const { watchlistService } = require('../services/watchlistService');
const { searchUsStocks, getApiKey } = require('../services/stockReferenceService');
const requireDeleteConfirmation = require('../middleware/requireDeleteConfirmation');

const router = express.Router();
const alertService = new AlertService();

const watchlistDeleteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many watchlist removals. Try again later.' },
  keyGenerator: (req) => `wl-del:${req.user?.id ?? req.ip}`
});

const watchlistLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many watchlist requests, retry shortly' }
});

/** Stock name/ticker search (Polygon reference); separate budget from mutation endpoints */
const stockSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 45,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many symbol searches, retry shortly' },
  keyGenerator: (req) => `wl-search:${req.user?.id ?? req.ip}`
});

router.get('/', auth, watchlistLimiter, async (req, res) => {
  try {
    const data = await watchlistService.getMainWatchlist(req.user.id);
    return res.json(data);
  } catch (error) {
    logger.error('GET watchlist failed:', error);
    return res.status(500).json({ message: 'Failed to load watchlist' });
  }
});

/** GET /watchlist/stock-search?q= — US stock lookup for dashboard combobox */
router.get('/stock-search', auth, stockSearchLimiter, async (req, res) => {
  try {
    const raw = req.query.q;
    const q = typeof raw === 'string' ? raw.trim().slice(0, 64) : '';
    if (q.length < 1) {
      return res.json({ results: [], searchAvailable: !!getApiKey() });
    }
    const results = await searchUsStocks(q);
    return res.json({ results, searchAvailable: !!getApiKey() });
  } catch (error) {
    logger.error('GET watchlist stock-search failed:', error);
    return res.status(500).json({ message: 'Symbol search failed' });
  }
});

router.post(
  '/symbols',
  auth,
  watchlistLimiter,
  [
    body('symbol').isString().trim().isLength({ min: 1, max: 24 }),
    body('assetType').optional().isIn(['stock', 'crypto'])
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const assetType = req.body.assetType === 'crypto' ? 'crypto' : 'stock';
      const data =
        assetType === 'crypto'
          ? await watchlistService.addCrypto(req.user.id, req.body.symbol, alertService)
          : await watchlistService.addStock(req.user.id, req.body.symbol, alertService);
      return res.status(201).json(data);
    } catch (error) {
      const code = error.statusCode || 500;
      if (code >= 500) {
        logger.error('POST watchlist symbol failed:', error);
      }
      return res.status(code).json({ message: error.message || 'Failed to add symbol' });
    }
  }
);

router.delete(
  '/symbols/:symbol',
  auth,
  watchlistLimiter,
  watchlistDeleteLimiter,
  requireDeleteConfirmation,
  [
    param('symbol').isString().trim().isLength({ min: 1, max: 24 }),
    query('assetType').optional().isIn(['stock', 'crypto'])
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const assetType = req.query.assetType === 'crypto' ? 'crypto' : 'stock';
      const data = await watchlistService.removeSymbol(req.user.id, req.params.symbol, assetType, alertService);
      return res.json(data);
    } catch (error) {
      const code = error.statusCode || 500;
      if (code >= 500) {
        logger.error('DELETE watchlist symbol failed:', error);
      }
      return res.status(code).json({ message: error.message || 'Failed to remove symbol' });
    }
  }
);

module.exports = router;
