const express = require('express');
const { query, validationResult } = require('express-validator');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const auth = require('../middleware/auth');
const config = require('../config');
const logger = require('../utils/logger');
const { resolveQuantAgiBaseUrl } = require('../utils/quantAgiBaseUrl');

const router = express.Router();

const RANK_STRATEGIES = new Set([
  'momentum_liquidity',
  'photonics_chokepoint',
  'rule_breaker_gardner',
  'rule_breaker_gardner_early'
]);

const rankLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many Quant AGI rank requests, retry shortly' },
  keyGenerator: (req) => `quant-rank:${req.user?.id ?? req.ip}`
});

router.get(
  '/market-universe-rank',
  auth,
  rankLimiter,
  [
    query('strategy').optional().isString().trim(),
    query('top_n').optional().isInt({ min: 5, max: 50 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      let strategy = String(req.query.strategy || 'momentum_liquidity').trim();
      if (!RANK_STRATEGIES.has(strategy)) {
        strategy = 'momentum_liquidity';
      }

      const topN = Number(req.query.top_n) || 25;
      const base = resolveQuantAgiBaseUrl();
      const timeout = config.QUANT_AGI_RANK_TIMEOUT_MS || 45000;

      const { data } = await axios.get(`${base}/diag/market-universe-rank`, {
        params: { strategy, top_n: topN },
        timeout,
        validateStatus: (s) => s >= 200 && s < 300
      });

      return res.json(data && typeof data === 'object' ? data : { ok: false, positions: [] });
    } catch (err) {
      const status = err.response?.status;
      logger.warn(`Quant AGI rank proxy failed: ${err.message}${status ? ` (${status})` : ''}`);
      return res.status(status && status >= 400 && status < 600 ? status : 502).json({
        ok: false,
        message: 'Quant AGI rank unavailable',
        detail: err.message
      });
    }
  }
);

module.exports = router;
