const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const auth = require('../middleware/auth');
const logger = require('../utils/logger');
const config = require('../config');

const router = express.Router();

const fundamentalsRateLimiter = rateLimit({
  windowMs: Number(process.env.FUNDAMENTALS_RATE_WINDOW_MS || 60_000),
  max: Number(process.env.FUNDAMENTALS_RATE_MAX || 48),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many fundamentals requests — retry shortly' },
  handler: (_req, res) =>
    res.status(429).json({ message: 'Too many fundamentals requests — retry shortly' })
});

router.get('/:symbol', auth, fundamentalsRateLimiter, async (req, res) => {
  const raw = (req.params.symbol || '').trim().toUpperCase();
  const symbol = raw.replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
  if (!symbol || symbol.length > 8 || !/^[A-Z0-9.\-]+$/.test(symbol)) {
    return res.status(400).json({ message: 'Invalid symbol' });
  }

  const base = (config.PYTHON_SERVICE_URL || 'http://127.0.0.1:5001').replace(/\/$/, '');
  const url = `${base}/stock/${encodeURIComponent(symbol)}/fundamentals`;
  const ms = Number(process.env.FUNDAMENTALS_PYTHON_TIMEOUT_MS || 28_000);

  try {
    const { data, status } = await axios.get(url, {
      timeout: ms,
      validateStatus: () => true,
      headers: { Accept: 'application/json', 'User-Agent': 'KeepItBased/1.0' }
    });
    if (status >= 400) {
      const msg =
        data && typeof data === 'object' && data.error
          ? String(data.error)
          : `upstream ${status}`;
      logger.warn(`fundamentals upstream ${symbol}: ${msg}`);
      return res.status(status >= 500 ? 502 : status).json({
        message: 'Fundamentals unavailable',
        detail: msg
      });
    }
    return res.json(data);
  } catch (err) {
    logger.error(`fundamentals proxy ${symbol}: ${err.message}`);
    return res.status(504).json({ message: 'Fundamentals upstream timeout or error' });
  }
});

module.exports = router;
