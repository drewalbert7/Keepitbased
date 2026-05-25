const express = require('express');
const { body, param, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const auth = require('../middleware/auth');
const AlertService = require('../services/alertService');
const logger = require('../utils/logger');
const deployListService = require('../services/deployListService');
const { mergeNotificationPreferences } = require('../utils/notificationPreferences');

const router = express.Router();
const alertService = new AlertService();

const deployListLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many deploy list requests, retry shortly' },
  keyGenerator: (req) => `deploy-list:${req.user?.id ?? req.ip}`
});

const optimizeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Deploy list optimization rate limit — try again shortly' },
  keyGenerator: (req) => `deploy-opt:${req.user?.id ?? req.ip}`
});

function mapRow(row) {
  return {
    id: row.id,
    userAlertId: row.user_alert_id,
    symbol: String(row.symbol || '').toUpperCase(),
    assetType: row.asset_type,
    baselinePrice: row.baseline_price != null ? Number(row.baseline_price) : null,
    targetWeightPct: row.target_weight_pct != null ? Number(row.target_weight_pct) : null,
    suggestedLimitMin: row.suggested_limit_min != null ? Number(row.suggested_limit_min) : null,
    suggestedLimitMax: row.suggested_limit_max != null ? Number(row.suggested_limit_max) : null,
    source: row.source,
    grokRationale: row.grok_rationale,
    status: row.status,
    lastOptimizedAt: row.last_optimized_at,
    updatedAt: row.updated_at
  };
}

router.get('/', auth, deployListLimiter, async (req, res) => {
  try {
    const rows = await deployListService.listDeployList(req.user.id);
    const items = rows.map(mapRow);
    const totalWeight = items.reduce((s, it) => s + (it.targetWeightPct || 0), 0);
    return res.json({
      items,
      totalTargetWeightPct: Number(totalWeight.toFixed(2)),
      disclaimer:
        'Educational deploy intent only — no brokerage orders are placed until execution is connected.',
      brokerConnected: false
    });
  } catch (error) {
    logger.error('GET deploy-list failed:', error);
    return res.status(500).json({ message: 'Failed to load deploy list' });
  }
});

router.post(
  '/items',
  auth,
  deployListLimiter,
  [
    body('alertId').isInt({ min: 1 }),
    body('targetWeightPct').optional({ checkFalsy: true }).isFloat({ min: 0.1, max: 50 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const row = await deployListService.upsertDeployItem(req.user.id, Number(req.body.alertId), {
        targetWeightPct: req.body.targetWeightPct,
        source: 'manual'
      });
      return res.status(201).json({ item: mapRow(row) });
    } catch (error) {
      const code = error.statusCode || 500;
      if (code >= 500) logger.error('POST deploy-list item failed:', error);
      return res.status(code).json({ message: error.message || 'Failed to add deploy list item' });
    }
  }
);

router.delete(
  '/items/:alertId',
  auth,
  deployListLimiter,
  [param('alertId').isInt({ min: 1 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      await deployListService.removeDeployItem(req.user.id, Number(req.params.alertId));
      return res.json({ ok: true });
    } catch (error) {
      const code = error.statusCode || 500;
      if (code >= 500) logger.error('DELETE deploy-list item failed:', error);
      return res.status(code).json({ message: error.message || 'Failed to remove deploy list item' });
    }
  }
);

router.delete('/', auth, deployListLimiter, async (req, res) => {
  try {
    await deployListService.clearDeployList(req.user.id);
    return res.json({ ok: true });
  } catch (error) {
    logger.error('DELETE deploy-list clear failed:', error);
    return res.status(500).json({ message: 'Failed to clear deploy list' });
  }
});

router.post('/optimize', auth, optimizeLimiter, async (req, res) => {
  try {
    const prefs = mergeNotificationPreferences(req.user.notification_preferences);
    const maxPositionPct = prefs.agentMaxPositionSizePct ?? 10;
    const result = await deployListService.optimizeDeployListWithGrok({
      userId: req.user.id,
      alertService,
      preferences: {
        maxPositionSizePct: maxPositionPct,
        topN: Math.min(8, Number(req.body?.topN) || 5),
        confidenceFloor: Number(req.body?.confidenceFloor) || 0.45,
        watchlistOnly: true
      }
    });
    const items = (result.items || []).map(mapRow);
    return res.json({ ...result, items });
  } catch (error) {
    const code = error.statusCode || 500;
    if (code >= 500) logger.error('POST deploy-list optimize failed:', error);
    return res.status(code).json({ message: error.message || 'Deploy list optimization failed' });
  }
});

module.exports = router;
