const express = require('express');
const { body, param, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const auth = require('../middleware/auth');
const logger = require('../utils/logger');
const AlertService = require('../services/alertService');
const { watchlistService } = require('../services/watchlistService');

const router = express.Router();
const alertService = new AlertService();

const watchlistLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many watchlist requests, retry shortly' }
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

router.post(
  '/symbols',
  auth,
  watchlistLimiter,
  [body('symbol').isString().trim().isLength({ min: 1, max: 16 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const data = await watchlistService.addStock(req.user.id, req.body.symbol, alertService);
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
  [param('symbol').isString().trim().isLength({ min: 1, max: 16 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const data = await watchlistService.removeStock(req.user.id, req.params.symbol, alertService);
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
