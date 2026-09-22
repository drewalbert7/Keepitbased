const express = require('express');
const logger = require('../utils/logger');
const stripeBilling = require('../services/stripeBillingService');

const router = express.Router();

/**
 * Stripe webhooks — must be mounted with express.raw({ type: 'application/json' }).
 */
router.post('/', async (req, res) => {
  const signature = req.headers['stripe-signature'];
  if (!signature) {
    return res.status(400).send('Missing stripe-signature');
  }
  let event;
  try {
    event = stripeBilling.constructEvent(req.body, signature);
  } catch (err) {
    logger.warn(`Stripe webhook signature failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    await stripeBilling.handleWebhookEvent(event);
    res.json({ received: true });
  } catch (err) {
    logger.error(`Stripe webhook handler failed (${event.type}): ${err.message}`);
    res.status(500).json({ message: 'Webhook handler failed' });
  }
});

module.exports = router;
