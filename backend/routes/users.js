const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const auth = require('../middleware/auth');
const db = require('../models/database');
const logger = require('../utils/logger');
const { mergeNotificationPreferences } = require('../utils/notificationPreferences');
const userSignupPasscodeService = require('../services/userSignupPasscodeService');
const emailService = require('../services/emailService');
const appConfig = require('../config');

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

function parseUsername(value, label) {
  if (value === undefined || value === null) {
    return { error: `${label} is required` };
  }
  const s = String(value).trim().toLowerCase();
  if (!s) {
    return { error: `${label} cannot be empty` };
  }
  if (!USERNAME_RE.test(s)) {
    return {
      error: `${label} must be 3–32 characters and use only letters, numbers, or underscore`
    };
  }
  return { value: s };
}

/** Whether client tried to send deprecated name fields. */
function bodyHasLegacyNames(req) {
  return (
    Object.prototype.hasOwnProperty.call(req.body, 'firstName') ||
    Object.prototype.hasOwnProperty.call(req.body, 'lastName')
  );
}

// --- Signup passcode (personal invite) — register before generic /profile ---

router.get('/profile/signup-passcode', auth, async (req, res) => {
  try {
    const active = await userSignupPasscodeService.hasPasscodeForUser(req.user.id);
    res.json({ active });
  } catch (err) {
    logger.error('GET signup-passcode:', err);
    res.status(500).json({ message: 'Failed to load passcode status' });
  }
});

/** Logged-in only: host mail + digest flags (not exposed on public GET /api/health/config). */
router.get('/profile/host-notification-flags', auth, (req, res) => {
  try {
    res.json({
      smtpConfigured: emailService.isConfigured(),
      dailyWatchlistDigestEnabled:
        !!appConfig.ENABLE_DAILY_WATCHLIST_DIGEST_EMAIL &&
        !appConfig.DISABLE_DAILY_WATCHLIST_DIGEST_EMAIL,
      dailyWatchlistDigestCron: appConfig.DAILY_WATCHLIST_DIGEST_CRON
    });
  } catch (err) {
    logger.error('GET host-notification-flags:', err);
    res.status(500).json({ message: 'Failed to load host notification flags' });
  }
});

router.put(
  '/profile/signup-passcode',
  auth,
  [
    body('clear').optional().isBoolean(),
    body('passcode').optional().isString().isLength({ min: 8, max: 128 }).trim()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { clear, passcode } = req.body;
      if (clear === true) {
        await userSignupPasscodeService.clearPasscodeForUser(req.user.id);
        return res.json({
          message: 'Your signup passcode has been removed. New accounts can no longer use it.',
          lastPasscodeShown: null
        });
      }
      if (typeof passcode !== 'string' || !passcode.trim()) {
        return res.status(400).json({ message: 'Provide passcode (8+ characters) or clear: true' });
      }
      const plain = await userSignupPasscodeService.setPasscodeForUser(req.user.id, passcode);
      logger.info(`User ${req.user.id} set personal signup passcode`);
      return res.json({
        message:
          'Passcode saved. Copy it now — it will not be shown again. Share it only with people you want to allow to register.',
        lastPasscodeShown: plain
      });
    } catch (err) {
      const msg = err?.message || 'Failed to update passcode';
      logger.error('PUT signup-passcode:', err);
      return res.status(400).json({ message: msg });
    }
  }
);

// Update user profile
router.put('/profile', auth, async (req, res) => {
  try {
    if (bodyHasLegacyNames(req)) {
      return res.status(400).json({
        message: 'First and last name are no longer used. Set your public username instead.'
      });
    }

    const { username, notificationPreferences } = req.body;
    const updates = {};

    if (Object.prototype.hasOwnProperty.call(req.body, 'username')) {
      const parsed = parseUsername(username, 'Username');
      if (parsed.error) {
        return res.status(400).json({ message: parsed.error });
      }
      const clash = await db.query(
        'SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id <> $2',
        [parsed.value, req.user.id]
      );
      if (clash.rows.length > 0) {
        return res.status(409).json({ message: 'Username is already taken' });
      }
      updates.username = parsed.value;
    }

    if (notificationPreferences) {
      const cur = await db.query('SELECT notification_preferences FROM users WHERE id = $1', [req.user.id]);
      const merged = mergeNotificationPreferences({
        ...(cur.rows[0]?.notification_preferences || {}),
        ...notificationPreferences
      });
      updates.notification_preferences = JSON.stringify(merged);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No profile fields to update' });
    }

    const setClause = Object.keys(updates)
      .map((key, index) => `${key} = $${index + 2}`)
      .join(', ');

    const values = [req.user.id, ...Object.values(updates)];

    const result = await db.query(
      `
      UPDATE users
      SET ${setClause}, updated_at = NOW()
      WHERE id = $1
      RETURNING id, email, username, first_name, last_name, notification_preferences
    `,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = result.rows[0];
    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      notificationPreferences: mergeNotificationPreferences(user.notification_preferences)
    });
  } catch (error) {
    logger.error('Error updating user profile:', error);
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

// Get user statistics
router.get('/stats', auth, async (req, res) => {
  try {
    // Get alert count
    const alertCount = await db.query(
      `
      SELECT COUNT(*) as total,
             COUNT(CASE WHEN active = true THEN 1 END) as active
      FROM user_alerts WHERE user_id = $1
    `,
      [req.user.id]
    );

    // Get alert history count
    const historyCount = await db.query(
      `
      SELECT COUNT(*) as total,
             COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as today,
             COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as week
      FROM alert_history WHERE user_id = $1
    `,
      [req.user.id]
    );

    // Get most triggered symbols
    const topSymbols = await db.query(
      `
      SELECT symbol, asset_type, COUNT(*) as count
      FROM alert_history
      WHERE user_id = $1
      GROUP BY symbol, asset_type
      ORDER BY count DESC
      LIMIT 5
    `,
      [req.user.id]
    );

    res.json({
      alerts: {
        total: parseInt(alertCount.rows[0].total, 10),
        active: parseInt(alertCount.rows[0].active, 10)
      },
      notifications: {
        total: parseInt(historyCount.rows[0].total, 10),
        today: parseInt(historyCount.rows[0].today, 10),
        week: parseInt(historyCount.rows[0].week, 10)
      },
      topSymbols: topSymbols.rows
    });
  } catch (error) {
    logger.error('Error getting user stats:', error);
    res.status(500).json({ message: 'Failed to get user statistics' });
  }
});

module.exports = router;
