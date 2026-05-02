const db = require('../models/database');
const logger = require('../utils/logger');

async function recordOpportunitySignal({
  userId,
  symbol,
  assetType,
  flags,
  reasons,
  vsBaselinePct,
  price
}) {
  try {
    await db.query(
      `INSERT INTO opportunity_signals (
        user_id, symbol, asset_type, flags, reasons, vs_baseline_pct, price
      ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
      [
        userId,
        String(symbol).toUpperCase(),
        assetType,
        JSON.stringify(flags || []),
        JSON.stringify(reasons || []),
        vsBaselinePct != null ? Number(vsBaselinePct) : null,
        Number(price)
      ]
    );
  } catch (err) {
    logger.warn(`opportunity_signals insert skipped: ${err.message}`);
  }
}

async function listOpportunitySignals(userId, limit = 50) {
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const result = await db.query(
    `SELECT id, symbol, asset_type, flags, reasons, vs_baseline_pct, price, created_at
     FROM opportunity_signals
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, cap]
  );
  return result.rows;
}

module.exports = {
  recordOpportunitySignal,
  listOpportunitySignals
};
