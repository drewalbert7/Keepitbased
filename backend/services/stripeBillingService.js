const Stripe = require('stripe');
const config = require('../config');
const db = require('../models/database');
const logger = require('../utils/logger');
const { getSubscriptionRow } = require('./subscriptionEntitlement');

let stripeClient = null;

function getStripe() {
  if (!config.STRIPE_SECRET_KEY) {
    const err = new Error('Stripe is not configured (STRIPE_SECRET_KEY)');
    err.statusCode = 503;
    err.code = 'STRIPE_NOT_CONFIGURED';
    throw err;
  }
  if (!stripeClient) {
    stripeClient = new Stripe(config.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

function stripeConfigured() {
  return Boolean(config.STRIPE_SECRET_KEY && config.STRIPE_PRICE_ID_PRO);
}

function frontendBase() {
  return String(config.FRONTEND_URL || 'https://app.keepitbased.com').replace(/\/$/, '');
}

async function ensureStripeCustomer(userId) {
  const row = await getSubscriptionRow(userId);
  if (!row) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }
  if (row.stripe_customer_id) return row.stripe_customer_id;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: row.email,
    metadata: { keepitbased_user_id: String(userId) }
  });
  await db.query(`UPDATE users SET stripe_customer_id = $2 WHERE id = $1`, [
    userId,
    customer.id
  ]);
  return customer.id;
}

async function createCheckoutSession(userId) {
  if (!config.STRIPE_PRICE_ID_PRO) {
    const err = new Error('STRIPE_PRICE_ID_PRO is not set');
    err.statusCode = 503;
    err.code = 'STRIPE_PRICE_MISSING';
    throw err;
  }
  const customerId = await ensureStripeCustomer(userId);
  const stripe = getStripe();
  const base = frontendBase();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: String(userId),
    line_items: [{ price: config.STRIPE_PRICE_ID_PRO, quantity: 1 }],
    success_url: `${base}/mcp?billing=success`,
    cancel_url: `${base}/mcp?billing=cancel`,
    metadata: { keepitbased_user_id: String(userId) },
    subscription_data: {
      metadata: { keepitbased_user_id: String(userId) }
    }
  });
  return { url: session.url, id: session.id };
}

async function createCustomerPortalSession(userId) {
  const customerId = await ensureStripeCustomer(userId);
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${frontendBase()}/mcp`
  });
  return { url: session.url };
}

async function applySubscriptionToUser({
  userId,
  customerId,
  subscriptionId,
  status,
  priceId,
  currentPeriodEnd
}) {
  if (userId) {
    await db.query(
      `UPDATE users SET
         stripe_customer_id = COALESCE($2, stripe_customer_id),
         stripe_subscription_id = COALESCE($3, stripe_subscription_id),
         subscription_status = COALESCE($4, subscription_status),
         subscription_price_id = $5,
         subscription_current_period_end = $6
       WHERE id = $1`,
      [
        userId,
        customerId || null,
        subscriptionId || null,
        status || null,
        priceId || null,
        currentPeriodEnd || null
      ]
    );
    return;
  }
  if (customerId) {
    await db.query(
      `UPDATE users SET
         stripe_subscription_id = $2,
         subscription_status = $3,
         subscription_price_id = $4,
         subscription_current_period_end = $5
       WHERE stripe_customer_id = $1`,
      [customerId, subscriptionId || null, status || 'none', priceId || null, currentPeriodEnd || null]
    );
  }
}

async function syncFromSubscriptionObject(sub) {
  if (!sub || typeof sub !== 'object') return;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  const userIdRaw = sub.metadata?.keepitbased_user_id;
  const userId = userIdRaw ? parseInt(userIdRaw, 10) : null;
  const priceId = sub.items?.data?.[0]?.price?.id || null;
  const periodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000)
    : null;

  if (userId && Number.isFinite(userId)) {
    await applySubscriptionToUser({
      userId,
      customerId,
      subscriptionId: sub.id,
      status: sub.status,
      priceId,
      currentPeriodEnd: periodEnd
    });
    return;
  }

  if (customerId) {
    await db.query(
      `UPDATE users
       SET stripe_subscription_id = $2,
           subscription_status = $3,
           subscription_price_id = $4,
           subscription_current_period_end = $5
       WHERE stripe_customer_id = $1`,
      [customerId, sub.id, sub.status || 'none', priceId, periodEnd]
    );
  }
}

async function handleWebhookEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = parseInt(session.client_reference_id || session.metadata?.keepitbased_user_id, 10);
      if (session.customer && userId && Number.isFinite(userId)) {
        await db.query(
          `UPDATE users SET stripe_customer_id = COALESCE(stripe_customer_id, $2) WHERE id = $1`,
          [userId, session.customer]
        );
      }
      if (session.subscription) {
        const stripe = getStripe();
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        await syncFromSubscriptionObject(sub);
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      await syncFromSubscriptionObject(event.data.object);
      break;
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const inv = event.data.object;
      if (inv.subscription) {
        const stripe = getStripe();
        const sub = await stripe.subscriptions.retrieve(inv.subscription);
        await syncFromSubscriptionObject(sub);
      }
      break;
    }
    default:
      logger.debug?.(`Stripe webhook ignored: ${event.type}`);
  }
}

function constructEvent(rawBody, signature) {
  const stripe = getStripe();
  if (!config.STRIPE_WEBHOOK_SECRET) {
    const err = new Error('STRIPE_WEBHOOK_SECRET is not set');
    err.statusCode = 503;
    throw err;
  }
  return stripe.webhooks.constructEvent(rawBody, signature, config.STRIPE_WEBHOOK_SECRET);
}

module.exports = {
  getStripe,
  stripeConfigured,
  ensureStripeCustomer,
  createCheckoutSession,
  createCustomerPortalSession,
  syncFromSubscriptionObject,
  handleWebhookEvent,
  constructEvent
};
