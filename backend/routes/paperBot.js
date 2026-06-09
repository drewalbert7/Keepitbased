const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const auth = require('../middleware/auth');
const logger = require('../utils/logger');
const paperBotService = require('../services/paperBotService');

const router = express.Router();

const paperBotLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many paper bot requests, retry shortly' },
  keyGenerator: (req) => `paper-bot:${req.user?.id ?? req.ip}`
});

router.get('/policy-snapshot', auth, paperBotLimiter, async (req, res) => {
  try {
    const snapshot = await paperBotService.getPolicySnapshot(req.user.id);
    return res.json(snapshot);
  } catch (error) {
    logger.error('GET paper-bot/policy-snapshot failed:', error);
    return res.status(500).json({ message: 'Failed to load policy snapshot' });
  }
});

router.post('/dry-run', auth, paperBotLimiter, async (req, res) => {
  try {
    const result = await paperBotService.dryRun(req.user.id);
    return res.json(result);
  } catch (error) {
    logger.error('POST paper-bot/dry-run failed:', error);
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Dry-run failed'
    });
  }
});

router.get('/events', auth, paperBotLimiter, async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 15));
    const events = await paperBotService.getRecentEvents(req.user.id, limit);
    return res.json({ events });
  } catch (error) {
    logger.error('GET paper-bot/events failed:', error);
    return res.status(500).json({ message: 'Failed to load bot events' });
  }
});

router.get('/autoresearch/latest', auth, paperBotLimiter, async (req, res) => {
  try {
    const payload = await paperBotService.getAutoresearchLatest(req.user.id);
    return res.json(payload);
  } catch (error) {
    logger.error('GET paper-bot/autoresearch/latest failed:', error);
    return res.status(500).json({ message: 'Failed to load autoresearch summary' });
  }
});

router.post('/autoresearch/promote', auth, paperBotLimiter, async (req, res) => {
  try {
    const result = await paperBotService.promoteAutoresearchPatch(req.user.id, {
      commitSha: req.body?.commitSha || req.body?.commit_sha,
      experimentId: req.body?.experimentId || req.body?.experiment_id
    });
    return res.json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
        code: error.code
      });
    }
    logger.error('POST paper-bot/autoresearch/promote failed:', error);
    return res.status(500).json({ message: 'Failed to promote patch' });
  }
});

router.post('/reset', auth, paperBotLimiter, async (req, res) => {
  try {
    const state = await paperBotService.resetAccount(req.user.id);
    return res.json(state);
  } catch (error) {
    logger.error('POST paper-bot/reset failed:', error);
    return res.status(500).json({ message: 'Failed to reset paper account' });
  }
});

router.get('/state', auth, paperBotLimiter, async (req, res) => {
  try {
    const state = await paperBotService.getState(req.user.id);
    return res.json(state);
  } catch (error) {
    logger.error('GET paper-bot/state failed:', error);
    return res.status(500).json({ message: 'Failed to load paper bot state' });
  }
});

router.post(
  '/kill-switch',
  auth,
  paperBotLimiter,
  [body('armed').isBoolean(), body('confirmPhrase').optional().isString().trim()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const account = await paperBotService.setKillSwitch(req.user.id, {
        armed: req.body.armed,
        confirmPhrase: req.body.confirmPhrase
      });
      return res.json({ account });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({ message: error.message, code: error.code });
      }
      logger.error('POST paper-bot/kill-switch failed:', error);
      return res.status(500).json({ message: 'Failed to update kill switch' });
    }
  }
);

router.patch(
  '/settings',
  auth,
  paperBotLimiter,
  [body('tradeDeployListOnly').optional().isBoolean()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      if (typeof req.body.tradeDeployListOnly !== 'boolean') {
        return res.status(400).json({ message: 'No settings to update' });
      }
      const account = await paperBotService.setTradeDeployListOnly(
        req.user.id,
        req.body.tradeDeployListOnly
      );
      return res.json({ account });
    } catch (error) {
      logger.error('PATCH paper-bot/settings failed:', error);
      return res.status(500).json({ message: 'Failed to update paper bot settings' });
    }
  }
);

router.post('/simulate-day', auth, paperBotLimiter, async (req, res) => {
  try {
    const state = await paperBotService.simulateDay(req.user.id);
    return res.json(state);
  } catch (error) {
    logger.error('POST paper-bot/simulate-day failed:', error);
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Simulate day failed'
    });
  }
});

router.post(
  '/manual-trade',
  auth,
  paperBotLimiter,
  [
    body('symbol').isString().trim().notEmpty(),
    body('side').isIn(['buy', 'sell']),
    body('notionalUsd').isFloat({ min: 1, max: 50000 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const state = await paperBotService.manualTrade(req.user.id, {
        symbol: req.body.symbol,
        side: req.body.side,
        notionalUsd: Number(req.body.notionalUsd)
      });
      return res.json(state);
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      logger.error('POST paper-bot/manual-trade failed:', error);
      return res.status(500).json({ message: 'Manual trade failed' });
    }
  }
);

const noteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many note requests, retry shortly' },
  keyGenerator: (req) => `paper-bot-note:${req.user?.id ?? req.ip}`
});

router.post(
  '/notes',
  auth,
  noteLimiter,
  [body('note').isString().trim().isLength({ min: 1, max: 4000 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const state = await paperBotService.interpretNote(req.user.id, req.body.note);
      return res.json(state);
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      logger.error('POST paper-bot/notes failed:', error);
      return res.status(500).json({ message: 'Failed to interpret note' });
    }
  }
);

router.post('/rules/:id/approve', auth, paperBotLimiter, async (req, res) => {
  try {
    const state = await paperBotService.approveRule(req.user.id, req.params.id);
    return res.json(state);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    logger.error('POST paper-bot/rules approve failed:', error);
    return res.status(500).json({ message: 'Failed to approve rule' });
  }
});

router.post('/rules/:id/dismiss', auth, paperBotLimiter, async (req, res) => {
  try {
    const state = await paperBotService.dismissRule(req.user.id, req.params.id);
    return res.json(state);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    logger.error('POST paper-bot/rules dismiss failed:', error);
    return res.status(500).json({ message: 'Failed to dismiss rule' });
  }
});

module.exports = router;
