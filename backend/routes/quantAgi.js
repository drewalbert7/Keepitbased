const express = require('express');
const { query, validationResult } = require('express-validator');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const auth = require('../middleware/auth');
const config = require('../config');
const logger = require('../utils/logger');
const { resolveQuantAgiBaseUrl } = require('../utils/quantAgiBaseUrl');
const { isAllowedSidecarRequest, normalizeSubPath } = require('../utils/quantAgiSidecarAllowlist');

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

const sidecarLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many Quant AGI sidecar requests, retry shortly' },
  keyGenerator: (req) => `quant-sidecar:${req.user?.id ?? req.ip}`
});

const codingChatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 24,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Coding advisor rate limit — try again in a minute' },
  keyGenerator: (req) => `quant-coding:${req.user?.id ?? req.ip}`
});

function sidecarSubPath(req) {
  const raw = req.params[0] || '';
  return normalizeSubPath(raw);
}

async function proxySidecar(req, res) {
  const subPath = sidecarSubPath(req);
  if (!subPath || !isAllowedSidecarRequest(req.method, subPath)) {
    return res.status(403).json({ message: 'Quant AGI path not allowed' });
  }

  const base = resolveQuantAgiBaseUrl();
  const targetUrl = `${base}/${subPath}`;
  const timeout =
    subPath.startsWith('v1/coding-chat')
      ? config.QUANT_AGI_TIMEOUT_MS || 120000
      : config.QUANT_AGI_RANK_TIMEOUT_MS || 45000;

  try {
    const axiosConfig = {
      method: req.method,
      url: targetUrl,
      params: req.query,
      timeout,
      validateStatus: (s) => s >= 200 && s < 300,
      responseType: 'json'
    };
    if (req.method === 'POST') {
      axiosConfig.data = req.body;
      axiosConfig.headers = { 'Content-Type': 'application/json' };
    }

    const { data } = await axios(axiosConfig);
    return res.json(data && typeof data === 'object' ? data : { ok: true, data });
  } catch (err) {
    const status = err.response?.status;
    logger.warn(
      `Quant AGI sidecar proxy failed (${subPath}): ${err.message}${status ? ` (${status})` : ''}`
    );
    if (err.response?.data && typeof err.response.data === 'object') {
      return res.status(status && status >= 400 && status < 600 ? status : 502).json(err.response.data);
    }
    return res.status(status && status >= 400 && status < 600 ? status : 502).json({
      ok: false,
      message: 'Quant AGI sidecar unavailable',
      detail: err.message
    });
  }
}

router.all('/sidecar/*', auth, (req, res) => {
  const subPath = sidecarSubPath(req);
  if (subPath?.startsWith('v1/coding-chat') && req.method === 'POST') {
    return codingChatLimiter(req, res, () => proxySidecar(req, res));
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    return sidecarLimiter(req, res, () => proxySidecar(req, res));
  }
  return res.status(405).json({ message: 'Method not allowed' });
});

module.exports = router;
