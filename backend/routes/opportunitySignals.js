const express = require('express');
const auth = require('../middleware/auth');
const logger = require('../utils/logger');
const { listOpportunitySignals } = require('../services/opportunitySignalsPersistence');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const raw = Number(req.query.limit);
    const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 50, 1), 100);
    const signals = await listOpportunitySignals(req.user.id, limit);
    return res.json({ signals });
  } catch (error) {
    logger.error('List opportunity signals failed:', error);
    return res.status(500).json({ message: 'Failed to list opportunity signals' });
  }
});

module.exports = router;
