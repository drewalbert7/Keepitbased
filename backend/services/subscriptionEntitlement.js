const db = require('../models/database');
const config = require('../config');

const PAID_STATUSES = new Set(['active', 'trialing', 'comped']);

/**
 * @param {object|null} row users row or partial
 */
function statusIsPaid(row) {
  if (!row) return false;
  if (config.MCP_ENTITLEMENT_BYPASS) return true;
  const status = String(row.subscription_status || 'none').toLowerCase();
  return PAID_STATUSES.has(status);
}

async function getSubscriptionRow(userId) {
  const { rows } = await db.query(
    `SELECT id, email, stripe_customer_id, stripe_subscription_id,
            subscription_status, subscription_price_id, subscription_current_period_end
     FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] || null;
}

async function userHasMcpAccess(userId) {
  if (config.MCP_ENTITLEMENT_BYPASS) return true;
  const row = await getSubscriptionRow(userId);
  return statusIsPaid(row);
}

function publicSubscriptionView(row) {
  if (!row) {
    return {
      status: 'none',
      paid: Boolean(config.MCP_ENTITLEMENT_BYPASS),
      priceId: null,
      currentPeriodEnd: null,
      stripeConfigured: Boolean(config.STRIPE_SECRET_KEY && config.STRIPE_PRICE_ID_PRO),
      mcpConnectorEnabled: Boolean(config.ENABLE_MCP_CONNECTOR),
      bypass: Boolean(config.MCP_ENTITLEMENT_BYPASS)
    };
  }
  return {
    status: row.subscription_status || 'none',
    paid: statusIsPaid(row),
    priceId: row.subscription_price_id || null,
    currentPeriodEnd: row.subscription_current_period_end || null,
    stripeConfigured: Boolean(config.STRIPE_SECRET_KEY && config.STRIPE_PRICE_ID_PRO),
    mcpConnectorEnabled: Boolean(config.ENABLE_MCP_CONNECTOR),
    bypass: Boolean(config.MCP_ENTITLEMENT_BYPASS)
  };
}

module.exports = {
  PAID_STATUSES,
  statusIsPaid,
  getSubscriptionRow,
  userHasMcpAccess,
  publicSubscriptionView
};
