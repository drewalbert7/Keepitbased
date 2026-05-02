/**
 * Server-to-server endpoints for the Python LangGraph agent (quote/history/tools).
 * Requires AGENT_INTERNAL_SECRET and X-User-Id — never expose to browsers.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const config = require('../config');
const AlertService = require('../services/alertService');
const { watchlistService } = require('../services/watchlistService');
const { persistAgentAuditEvent } = require('../services/agentPersistence');
const logger = require('../utils/logger');
const { validateAlertSymbol } = require('../utils/alertSymbolValidate');

const router = express.Router();
const alertService = new AlertService(null);

const internalAlertsReadLimiter = rateLimit({
  windowMs: config.INTERNAL_AGENT_READ_WINDOW_MS,
  max: config.INTERNAL_AGENT_READ_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Internal agent: too many alert list requests for this user' },
  keyGenerator: (req) => `ia-read:${req.internalUserId ?? 'na'}`
});

const internalAlertsWriteLimiter = rateLimit({
  windowMs: config.INTERNAL_AGENT_WRITE_WINDOW_MS,
  max: config.INTERNAL_AGENT_WRITE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Internal agent: too many alert create requests for this user' },
  keyGenerator: (req) => `ia-write:${req.internalUserId ?? 'na'}`
});

function internalAuth(req, res, next) {
  const expected = process.env.AGENT_INTERNAL_SECRET;
  if (!expected || typeof expected !== 'string') {
    logger.warn('internal agent route blocked: AGENT_INTERNAL_SECRET not set');
    return res.status(503).json({ message: 'Agent internal API not configured' });
  }
  const provided = req.headers['x-agent-internal-secret'];
  if (provided !== expected) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  const uid = parseInt(req.headers['x-user-id'], 10);
  if (!Number.isFinite(uid) || uid < 1) {
    return res.status(400).json({ message: 'Valid X-User-Id header required' });
  }
  req.internalUserId = uid;
  next();
}

/** Active + inactive alerts for grounding; agent filters. */
router.get('/alerts', internalAuth, internalAlertsReadLimiter, async (req, res) => {
  try {
    const rows = await alertService.getUserAlerts(req.internalUserId);
    let filtered = [];
    try {
      const allowed = await watchlistService.getAllowedAlertKeys(req.internalUserId);
      filtered = rows.filter((r) =>
        allowed.has(`${String(r.asset_type).toLowerCase()}:${String(r.symbol || '').toUpperCase()}`)
      );
    } catch (wlErr) {
      logger.warn(`internal alerts watchlist filter skipped: ${wlErr.message}`);
      filtered = rows;
    }
    const alerts = filtered.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      asset_type: r.asset_type,
      active: r.active,
      small_threshold: Number(r.small_threshold),
      medium_threshold: Number(r.medium_threshold),
      large_threshold: Number(r.large_threshold),
      baseline_price: r.baseline_price != null ? Number(r.baseline_price) : null
    }));
    return res.json({ alerts });
  } catch (error) {
    logger.error('internal agent alerts failed:', error);
    return res.status(500).json({ message: 'Failed to load alerts' });
  }
});

/** Create alert for user — same rules as POST /api/alerts (service-to-service). */
router.post(
  '/alerts',
  internalAuth,
  internalAlertsWriteLimiter,
  [
    body('symbol').isString().trim().isLength({ min: 1, max: 16 }),
    body('assetType').isIn(['crypto', 'stock']),
    body('smallThreshold').isFloat({ min: 0.1, max: 50 }),
    body('mediumThreshold').isFloat({ min: 0.1, max: 50 }),
    body('largeThreshold').isFloat({ min: 0.1, max: 50 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        symbol,
        assetType,
        smallThreshold,
        mediumThreshold,
        largeThreshold
      } = req.body;

      if (
        smallThreshold >= mediumThreshold ||
        mediumThreshold >= largeThreshold
      ) {
        return res.status(400).json({
          message: 'Thresholds must be ascending: small < medium < large'
        });
      }

      const gapSm = mediumThreshold - smallThreshold;
      const gapMl = largeThreshold - mediumThreshold;
      if (gapSm < 0.5 || gapMl < 0.5) {
        return res.status(400).json({
          message: 'Leave at least 0.5% between small/medium and medium/large tiers'
        });
      }

      const symCheck = validateAlertSymbol(symbol);
      if (!symCheck.ok) {
        return res.status(400).json({ message: symCheck.message });
      }

      const existingCount = await alertService.countUserAlerts(req.internalUserId);
      if (existingCount >= config.MAX_ALERTS_PER_USER) {
        const rid =
          typeof req.headers['x-agent-run-id'] === 'string'
            ? req.headers['x-agent-run-id'].trim().slice(0, 128)
            : null;
        void persistAgentAuditEvent({
          userId: req.internalUserId,
          action: 'internal_alert_quota_blocked',
          detail: {
            symbol: symCheck.symbol,
            count: existingCount,
            ...(rid ? { agentRunId: rid } : {})
          }
        });
        return res.status(403).json({
          message: `Maximum ${config.MAX_ALERTS_PER_USER} alerts per account`
        });
      }

      const created = await alertService.createAlert(
        req.internalUserId,
        symCheck.symbol,
        assetType.toLowerCase(),
        {
          small_threshold: smallThreshold,
          medium_threshold: mediumThreshold,
          large_threshold: largeThreshold
        }
      );

      const agentRunIdRaw = req.headers['x-agent-run-id'];
      const agentRunId =
        typeof agentRunIdRaw === 'string' && agentRunIdRaw.trim().length > 0
          ? agentRunIdRaw.trim().slice(0, 128)
          : null;
      if (agentRunId) {
        logger.info(
          `internal agent alert created user=${req.internalUserId} symbol=${symCheck.symbol} runId=${agentRunId}`
        );
      }

      void persistAgentAuditEvent({
        userId: req.internalUserId,
        action: 'internal_api_alert_created',
        detail: {
          symbol: symCheck.symbol,
          assetType: assetType.toLowerCase(),
          alertId: created.id,
          thresholds: { small: smallThreshold, medium: mediumThreshold, large: largeThreshold },
          ...(agentRunId ? { agentRunId } : {})
        }
      });

      return res.status(201).json({
        alert: {
          id: created.id,
          symbol: created.symbol,
          asset_type: created.asset_type,
          active: created.active,
          small_threshold: Number(created.small_threshold),
          medium_threshold: Number(created.medium_threshold),
          large_threshold: Number(created.large_threshold),
          baseline_price:
            created.baseline_price != null ? Number(created.baseline_price) : null
        }
      });
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({ message: 'Alert already exists for this symbol' });
      }
      logger.error('internal agent create alert failed:', error);
      return res.status(500).json({ message: 'Failed to create alert' });
    }
  }
);

module.exports = router;
