const express = require('express');
const rateLimit = require('express-rate-limit');
const auth = require('../middleware/auth');
const logger = require('../utils/logger');
const { getXPulse } = require('../services/xInvestorFeedService');

const router = express.Router();

const socialLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many social feed requests, retry shortly' }
});

/**
 * Curated posts from configured X accounts + cashtag aggregation.
 * Not a substitute for research — requires official API credentials.
 */
router.get('/x-pulse', auth, socialLimiter, async (req, res) => {
  try {
    const data = await getXPulse();
    return res.json(data);
  } catch (error) {
    logger.error('x-pulse failed:', error);
    return res.status(500).json({ message: 'Failed to load X pulse' });
  }
});

module.exports = router;
