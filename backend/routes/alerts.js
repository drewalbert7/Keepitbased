const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, param, validationResult } = require('express-validator');
const router = express.Router();
const config = require('../config');
const AlertService = require('../services/alertService');
const auth = require('../middleware/auth');
const logger = require('../utils/logger');
const { persistAgentAuditEvent } = require('../services/agentPersistence');
const { validateAlertSymbol } = require('../utils/alertSymbolValidate');
const requireDeleteConfirmation = require('../middleware/requireDeleteConfirmation');

const alertService = new AlertService();

const alertDeleteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many delete attempts. Try again later.' },
  keyGenerator: (req) => `alert-del:${req.user?.id ?? req.ip}`
});

// Get user's alerts
router.get('/', auth, async (req, res) => {
  try {
    const alerts = await alertService.getUserAlerts(req.user.id);
    res.json(alerts);
  } catch (error) {
    logger.error('Error getting user alerts:', error);
    res.status(500).json({ message: 'Failed to get alerts' });
  }
});

// Create new alert
router.post('/', auth, [
  body('symbol').notEmpty().withMessage('Symbol is required'),
  body('assetType').isIn(['crypto', 'stock']).withMessage('Asset type must be crypto or stock'),
  body('smallThreshold').optional().isFloat({ min: 0.1, max: 50 }).withMessage('Small threshold must be between 0.1 and 50'),
  body('mediumThreshold').optional().isFloat({ min: 0.1, max: 50 }).withMessage('Medium threshold must be between 0.1 and 50'),
  body('largeThreshold').optional().isFloat({ min: 0.1, max: 50 }).withMessage('Large threshold must be between 0.1 and 50')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { symbol, assetType, smallThreshold, mediumThreshold, largeThreshold } = req.body;

    const symCheck = validateAlertSymbol(symbol);
    if (!symCheck.ok) {
      return res.status(400).json({ message: symCheck.message });
    }

    const thresholds = {
      small_threshold: smallThreshold || 5,
      medium_threshold: mediumThreshold || 10,
      large_threshold: largeThreshold || 15
    };

    // Validate threshold order
    if (thresholds.small_threshold >= thresholds.medium_threshold ||
        thresholds.medium_threshold >= thresholds.large_threshold) {
      return res.status(400).json({
        message: 'Thresholds must be in ascending order: small < medium < large'
      });
    }

    const gapSm = thresholds.medium_threshold - thresholds.small_threshold;
    const gapMl = thresholds.large_threshold - thresholds.medium_threshold;
    if (gapSm < 0.5 || gapMl < 0.5) {
      return res.status(400).json({
        message: 'Leave at least 0.5% between small/medium and medium/large tiers'
      });
    }

    const existingCount = await alertService.countUserAlerts(req.user.id);
    if (existingCount >= config.MAX_ALERTS_PER_USER) {
      void persistAgentAuditEvent({
        userId: req.user.id,
        action: 'user_alert_quota_blocked',
        detail: { symbol: symCheck.symbol, count: existingCount }
      });
      return res.status(403).json({
        message: `Maximum ${config.MAX_ALERTS_PER_USER} alerts per account. Remove an alert before adding another.`
      });
    }

    const alert = await alertService.createAlert(
      req.user.id,
      symCheck.symbol,
      assetType.toLowerCase(),
      thresholds
    );

    void persistAgentAuditEvent({
      userId: req.user.id,
      action: 'user_alert_created',
      detail: {
        symbol: symCheck.symbol,
        assetType: assetType.toLowerCase(),
        alertId: alert.id
      }
    });

    res.status(201).json(alert);
  } catch (error) {
    if (error.code === '23505') { // Unique constraint violation
      return res.status(409).json({ message: 'Alert already exists for this symbol' });
    }
    logger.error('Error creating alert:', error);
    res.status(500).json({ message: 'Failed to create alert' });
  }
});

// Update alert
router.put('/:id', auth, [
  param('id').isInt({ min: 1 }).toInt(),
  body('smallThreshold').optional().isFloat({ min: 0.1, max: 50 }),
  body('mediumThreshold').optional().isFloat({ min: 0.1, max: 50 }),
  body('largeThreshold').optional().isFloat({ min: 0.1, max: 50 }),
  body('active').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { smallThreshold, mediumThreshold, largeThreshold, active } = req.body;
    const updates = {};
    
    if (smallThreshold !== undefined) updates.small_threshold = smallThreshold;
    if (mediumThreshold !== undefined) updates.medium_threshold = mediumThreshold;
    if (largeThreshold !== undefined) updates.large_threshold = largeThreshold;
    if (active !== undefined) updates.active = active;

    const alert = await alertService.updateAlert(req.params.id, req.user.id, updates);
    
    if (!alert) {
      return res.status(404).json({ message: 'Alert not found' });
    }
    
    res.json(alert);
  } catch (error) {
    logger.error('Error updating alert:', error);
    res.status(500).json({ message: 'Failed to update alert' });
  }
});

// Delete alert
router.delete(
  '/:id',
  auth,
  alertDeleteLimiter,
  requireDeleteConfirmation,
  [param('id').isInt({ min: 1 }).toInt()],
  async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const alert = await alertService.deleteAlert(req.params.id, req.user.id);
    
    if (!alert) {
      return res.status(404).json({ message: 'Alert not found' });
    }
    
    res.json({ message: 'Alert deleted successfully' });
  } catch (error) {
    logger.error('Error deleting alert:', error);
    res.status(500).json({ message: 'Failed to delete alert' });
  }
});

// Get alert history
router.get('/history', auth, async (req, res) => {
  try {
    const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 10_000);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const result = await require('../models/database').query(`
      SELECT * FROM alert_history 
      WHERE user_id = $1 
      ORDER BY created_at DESC 
      LIMIT $2 OFFSET $3
    `, [req.user.id, limit, offset]);

    const countResult = await require('../models/database').query(`
      SELECT COUNT(*) FROM alert_history WHERE user_id = $1
    `, [req.user.id]);

    res.json({
      alerts: result.rows,
      pagination: {
        page,
        limit,
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(parseInt(countResult.rows[0].count) / limit)
      }
    });
  } catch (error) {
    logger.error('Error getting alert history:', error);
    res.status(500).json({ message: 'Failed to get alert history' });
  }
});

module.exports = router;