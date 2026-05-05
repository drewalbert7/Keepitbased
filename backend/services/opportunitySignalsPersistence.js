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
    const result = await db.query(
      `INSERT INTO opportunity_signals (
        user_id, symbol, asset_type, flags, reasons, vs_baseline_pct, price
      ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
      RETURNING id`,
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
    return result.rows[0]?.id ?? null;
  } catch (err) {
    logger.warn(`opportunity_signals insert skipped: ${err.message}`);
    return null;
  }
}

/**
 * Attach UltimateDipBuyer / Grok dip-insight output to the signal row (same event as deterministic flags).
 * @param {number} userId
 * @param {number} signalId
 * @param {object} assessment — serialized JSON (verdict, confidence, reasoning, insight blob, etc.)
 */
async function updateOpportunitySignalAiAssessment(userId, signalId, assessment) {
  if (!userId || !signalId || !assessment || typeof assessment !== 'object') return;
  try {
    await db.query(
      `UPDATE opportunity_signals
       SET ai_assessment = $3::jsonb
       WHERE id = $1 AND user_id = $2`,
      [signalId, userId, JSON.stringify(assessment)]
    );
  } catch (err) {
    logger.warn(`opportunity_signals ai_assessment update skipped: ${err.message}`);
  }
}

async function listOpportunitySignals(userId, limit = 50) {
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const result = await db.query(
    `SELECT id, symbol, asset_type, flags, reasons, vs_baseline_pct, price, created_at, ai_assessment
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
  updateOpportunitySignalAiAssessment,
  listOpportunitySignals
};
