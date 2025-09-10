const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const auth = require('../middleware/auth');
const db = require('../models/database');
const logger = require('../utils/logger');

// Update user profile
router.put('/profile', auth, async (req, res) => {
  try {
    const { firstName, lastName, notificationPreferences } = req.body;
    const updates = {};
    
    if (firstName) updates.first_name = firstName;
    if (lastName) updates.last_name = lastName;
    if (notificationPreferences) updates.notification_preferences = JSON.stringify(notificationPreferences);

    const setClause = Object.keys(updates)
      .map((key, index) => `${key} = $${index + 2}`)
      .join(', ');
    
    const values = [req.user.id, ...Object.values(updates)];
    
    const result = await db.query(`
      UPDATE users 
      SET ${setClause}, updated_at = NOW()
      WHERE id = $1
      RETURNING id, email, first_name, last_name, notification_preferences
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = result.rows[0];
    res.json({
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      notificationPreferences: user.notification_preferences
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
    const alertCount = await db.query(`
      SELECT COUNT(*) as total, 
             COUNT(CASE WHEN active = true THEN 1 END) as active
      FROM user_alerts WHERE user_id = $1
    `, [req.user.id]);

    // Get alert history count
    const historyCount = await db.query(`
      SELECT COUNT(*) as total,
             COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as today,
             COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as week
      FROM alert_history WHERE user_id = $1
    `, [req.user.id]);

    // Get most triggered symbols
    const topSymbols = await db.query(`
      SELECT symbol, asset_type, COUNT(*) as count
      FROM alert_history 
      WHERE user_id = $1 
      GROUP BY symbol, asset_type
      ORDER BY count DESC
      LIMIT 5
    `, [req.user.id]);

    res.json({
      alerts: {
        total: parseInt(alertCount.rows[0].total),
        active: parseInt(alertCount.rows[0].active)
      },
      notifications: {
        total: parseInt(historyCount.rows[0].total),
        today: parseInt(historyCount.rows[0].today),
        week: parseInt(historyCount.rows[0].week)
      },
      topSymbols: topSymbols.rows
    });
  } catch (error) {
    logger.error('Error getting user stats:', error);
    res.status(500).json({ message: 'Failed to get user statistics' });
  }
});

module.exports = router;