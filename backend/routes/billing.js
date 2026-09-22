const express = require('express');
const auth = require('../middleware/auth');
const config = require('../config');
const logger = require('../utils/logger');
const {
  getSubscriptionRow,
  publicSubscriptionView
} = require('../services/subscriptionEntitlement');
const stripeBilling = require('../services/stripeBillingService');

const router = express.Router();

router.get('/status', auth, async (req, res) => {
  try {
    const row = await getSubscriptionRow(req.user.id);
    res.json(publicSubscriptionView(row));
  } catch (err) {
    logger.error(`billing status: ${err.message}`);
    res.status(500).json({ message: 'Could not load billing status' });
  }
});

router.post('/checkout', auth, async (req, res) => {
  try {
    if (!config.ENABLE_MCP_CONNECTOR) {
      return res.status(503).json({ message: 'MCP connector / billing is disabled' });
    }
    if (!stripeBilling.stripeConfigured()) {
      return res.status(503).json({
        message: 'Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID_PRO.',
        code: 'STRIPE_NOT_CONFIGURED'
      });
    }
    const session = await stripeBilling.createCheckoutSession(req.user.id);
    res.json(session);
  } catch (err) {
    logger.error(`billing checkout: ${err.message}`);
    res.status(err.statusCode || 500).json({ message: err.message, code: err.code });
  }
});

router.post('/portal', auth, async (req, res) => {
  try {
    if (!stripeBilling.stripeConfigured()) {
      return res.status(503).json({ message: 'Stripe is not configured', code: 'STRIPE_NOT_CONFIGURED' });
    }
    const session = await stripeBilling.createCustomerPortalSession(req.user.id);
    res.json(session);
  } catch (err) {
    logger.error(`billing portal: ${err.message}`);
    res.status(err.statusCode || 500).json({ message: err.message, code: err.code });
  }
});

module.exports = router;
