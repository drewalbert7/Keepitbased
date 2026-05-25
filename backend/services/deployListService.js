const axios = require('axios');
const db = require('../models/database');
const config = require('../config');
const logger = require('../utils/logger');
const { watchlistService } = require('./watchlistService');
const { buildAgentWatchlistContext } = require('./agentWatchlistContext');
const { parseTwAlertSymbol } = require('../utils/stockMarketIdentity');
const { mergeNotificationPreferences } = require('../utils/notificationPreferences');

const DEFAULT_PREFERENCES = {
  topN: 5,
  confidenceFloor: 0.45,
  maxPositionSizePct: 10,
  watchlistOnly: true,
  scoringWeights: {
    momentum: 0.35,
    trend: 0.3,
    liquidity: 0.2,
    eventRiskPenalty: 0.15
  }
};

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** US listed stocks only — deploy v1 excludes TW and crypto. */
function isDeployEligibleAlert(row) {
  if (!row || String(row.asset_type).toLowerCase() !== 'stock') return false;
  if (parseTwAlertSymbol(row.symbol)) return false;
  return row.active !== false;
}

function isDeployEligibleContextItem(item) {
  if (!item || String(item.assetType).toLowerCase() !== 'stock') return false;
  if (parseTwAlertSymbol(item.symbol)) return false;
  return item.active !== false;
}

async function assertAlertOnWatchlist(userId, alertId) {
  const alertRes = await db.query(
    `SELECT id, user_id, symbol, asset_type, active, baseline_price
     FROM user_alerts WHERE id = $1 AND user_id = $2`,
    [alertId, userId]
  );
  if (!alertRes.rows.length) {
    const err = new Error('Alert not found');
    err.statusCode = 404;
    throw err;
  }
  const alert = alertRes.rows[0];
  if (!isDeployEligibleAlert(alert)) {
    const err = new Error('Only active US stocks can be added to the deploy list');
    err.statusCode = 400;
    throw err;
  }
  const allowed = await watchlistService.getAllowedAlertKeys(userId);
  const key = `${String(alert.asset_type).toLowerCase()}:${String(alert.symbol).toUpperCase()}`;
  if (!allowed.has(key)) {
    const err = new Error('Symbol must be on your Main watchlist before deploy list');
    err.statusCode = 400;
    throw err;
  }
  return alert;
}

/**
 * @param {number} userId
 */
async function listDeployList(userId) {
  const r = await db.query(
    `
    SELECT d.*, a.symbol, a.asset_type, a.baseline_price, a.active AS alert_active
    FROM user_deploy_list_items d
    JOIN user_alerts a ON a.id = d.user_alert_id
    WHERE d.user_id = $1
    ORDER BY d.updated_at DESC
    `,
    [userId]
  );
  return r.rows;
}

/**
 * @param {number} userId
 * @param {number} alertId
 * @param {object} [opts]
 */
async function upsertDeployItem(userId, alertId, opts = {}) {
  await assertAlertOnWatchlist(userId, alertId);

  const targetWeight =
    opts.targetWeightPct != null && Number.isFinite(Number(opts.targetWeightPct))
      ? clamp(Number(opts.targetWeightPct), 0.1, 50)
      : null;
  const source = opts.source === 'grok_optimize' ? 'grok_optimize' : 'manual';

  const r = await db.query(
    `
    INSERT INTO user_deploy_list_items (
      user_id, user_alert_id, target_weight_pct,
      suggested_limit_min, suggested_limit_max,
      source, grok_rationale, status, last_optimized_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, NOW())
    ON CONFLICT (user_id, user_alert_id) DO UPDATE SET
      target_weight_pct = COALESCE(EXCLUDED.target_weight_pct, user_deploy_list_items.target_weight_pct),
      suggested_limit_min = COALESCE(EXCLUDED.suggested_limit_min, user_deploy_list_items.suggested_limit_min),
      suggested_limit_max = COALESCE(EXCLUDED.suggested_limit_max, user_deploy_list_items.suggested_limit_max),
      source = EXCLUDED.source,
      grok_rationale = COALESCE(EXCLUDED.grok_rationale, user_deploy_list_items.grok_rationale),
      status = 'active',
      last_optimized_at = COALESCE(EXCLUDED.last_optimized_at, user_deploy_list_items.last_optimized_at),
      updated_at = NOW()
    RETURNING *
    `,
    [
      userId,
      alertId,
      targetWeight,
      opts.suggestedLimitMin ?? null,
      opts.suggestedLimitMax ?? null,
      source,
      opts.grokRationale ?? null,
      opts.lastOptimizedAt ?? null
    ]
  );
  return r.rows[0];
}

async function removeDeployItem(userId, alertId) {
  const r = await db.query(
    `DELETE FROM user_deploy_list_items
     WHERE user_id = $1 AND user_alert_id = $2
     RETURNING id`,
    [userId, alertId]
  );
  if (!r.rows.length) {
    const err = new Error('Deploy list entry not found');
    err.statusCode = 404;
    throw err;
  }
}

async function clearDeployList(userId) {
  await db.query(`DELETE FROM user_deploy_list_items WHERE user_id = $1`, [userId]);
}

async function proxyOpportunityScan(payload) {
  const serviceUrl = config.PYTHON_SERVICE_URL || 'http://127.0.0.1:5001';
  const timeoutMs = config.AGENT_PYTHON_TIMEOUT_MS || 120000;
  const response = await axios.post(`${serviceUrl}/agent/opportunities`, payload, { timeout: timeoutMs });
  return response.data;
}

/**
 * Grok-backed deploy list optimization via existing opportunity scan graph.
 * @param {object} params
 * @param {number} params.userId
 * @param {import('./alertService')} params.alertService
 * @param {object} [params.preferences]
 */
async function optimizeDeployListWithGrok({ userId, alertService, preferences }) {
  const prefs = { ...DEFAULT_PREFERENCES, ...(preferences || {}) };
  const maxPct = clamp(Number(prefs.maxPositionSizePct) || 10, 1, 50);
  prefs.maxPositionSizePct = maxPct;
  prefs.topN = clamp(Number(prefs.topN) || 5, 1, 10);

  const ctx = await buildAgentWatchlistContext({
    alertService,
    userId,
    maxPositionPct: maxPct
  });

  const eligible = (ctx.items || []).filter(isDeployEligibleContextItem);
  if (!eligible.length) {
    const err = new Error('Add US stocks to your watchlist before optimizing the deploy list');
    err.statusCode = 400;
    throw err;
  }

  const filteredCtx = {
    ...ctx,
    items: eligible,
    policyNote:
      'Deploy-list optimization: rank US watchlist names with the best dip vs baseline and suggest portfolio % within the user max position cap. Educational only.'
  };

  const prompt =
    'Optimize my capital deploy list. Rank US watchlist symbols with the best ideal-dip opportunities vs baselines. ' +
    `For each top pick, suggest what fraction of portfolio to deploy (each name capped at ${maxPct}% max). ` +
    'Prefer names with meaningful dip vs baseline and strong risk/reward. Output ranked candidates with limit bands.';

  let scan;
  try {
    scan = await proxyOpportunityScan({
      prompt,
      mode: 'recommend_only',
      preferences: prefs,
      userId,
      watchlistContext: filteredCtx,
      assistantIntent: 'scan_rank',
      conversationHistory: []
    });
  } catch (e) {
    logger.warn(`deploy-list optimize LangGraph failed user=${userId}: ${e.message}`);
    const err = new Error('Grok optimization unavailable — try again or add symbols manually');
    err.statusCode = 503;
    throw err;
  }

  const candidates = Array.isArray(scan?.output?.topCandidates) ? scan.output.topCandidates : [];
  if (!candidates.length) {
    return {
      optimized: false,
      message: 'No candidates met confidence floor — try lowering confidence or widening watchlist',
      items: await listDeployList(userId),
      scanMeta: scan?.runMetadata || null
    };
  }

  const alertBySymbol = new Map();
  for (const it of eligible) {
    alertBySymbol.set(String(it.symbol).toUpperCase(), it.alertId);
  }

  const now = new Date().toISOString();
  const perNameCap = maxPct;
  const n = candidates.length;
  const evenShare = clamp(perNameCap, 0.5, Math.max(0.5, perNameCap / Math.max(1, n)));

  await clearDeployList(userId);

  const inserted = [];
  for (const c of candidates.slice(0, prefs.topN)) {
    const sym = String(c.symbol || '').toUpperCase();
    const alertId = alertBySymbol.get(sym);
    if (!alertId) continue;

    const score = Number(c.score) || 0;
    const conf = Number(c.confidence) || 0;
    const weight = clamp(Number((evenShare * (0.85 + score * 0.15)).toFixed(2)), 0.5, perNameCap);
    const band = c.suggestedLimitBand || {};
    const row = await upsertDeployItem(userId, alertId, {
      targetWeightPct: weight,
      suggestedLimitMin: band.min ?? null,
      suggestedLimitMax: band.max ?? null,
      source: 'grok_optimize',
      grokRationale: [c.whyNow, `score ${score.toFixed(2)}, confidence ${conf.toFixed(2)}`]
        .filter(Boolean)
        .join(' · '),
      lastOptimizedAt: now
    });
    inserted.push(row);
  }

  return {
    optimized: true,
    message: `Deploy list updated with ${inserted.length} Grok-ranked US name(s)`,
    items: await listDeployList(userId),
    topCandidates: candidates.slice(0, prefs.topN),
    scanMeta: scan?.runMetadata || null,
    reply: scan?.reply || null
  };
}

module.exports = {
  isDeployEligibleAlert,
  isDeployEligibleContextItem,
  listDeployList,
  upsertDeployItem,
  removeDeployItem,
  clearDeployList,
  optimizeDeployListWithGrok
};
