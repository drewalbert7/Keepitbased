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

module.exports = router;
