const logger = require('../utils/logger');
const db = require('../models/database');
const { getRedisClient } = require('../utils/redis');

/**
 * Watchlist alert rows (`user_alerts`): symbols, baselines, optional % threshold columns
 * used by agent context sizing hints. Opportunity tiers + email/toasts are handled by
 * `priceMonitor` only — no legacy small/medium/large polling loop.
 */
class AlertService {
  constructor() {
    this.redis = getRedisClient();
  }

  async createAlert(userId, symbol, assetType, thresholds = {}) {
    try {
      const {
        small_threshold = 5,
        medium_threshold = 10,
        large_threshold = 15
      } = thresholds;

      const cachedPrice = await this.redis.get(
        `price:${String(assetType).toLowerCase()}:${String(symbol).toUpperCase()}`
      );
      let baselinePrice = null;

      if (cachedPrice) {
        const priceData = JSON.parse(cachedPrice);
        baselinePrice = priceData.price;
      }

      const result = await db.query(
        `
        INSERT INTO user_alerts (
          user_id, symbol, asset_type, small_threshold,
          medium_threshold, large_threshold, baseline_price,
          active, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW(), NOW())
        RETURNING *
      `,
        [
          userId,
          symbol,
          assetType,
          small_threshold,
          medium_threshold,
          large_threshold,
          baselinePrice
        ]
      );

      return result.rows[0];
    } catch (error) {
      logger.error('Error creating alert:', error);
      throw error;
    }
  }

  async getUserAlerts(userId) {
    try {
      const result = await db.query(
        `
        SELECT * FROM user_alerts
        WHERE user_id = $1
        ORDER BY created_at DESC
      `,
        [userId]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error getting user alerts:', error);
      throw error;
    }
  }

  /** Total alerts (all states) for quota checks. */
  async countUserAlerts(userId) {
    const result = await db.query(
      `SELECT COUNT(*)::int AS c FROM user_alerts WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0]?.c ?? 0;
  }

  async updateAlert(alertId, userId, updates) {
    try {
      const allowedFields = [
        'small_threshold',
        'medium_threshold',
        'large_threshold',
        'baseline_price',
        'active'
      ];
      const filteredUpdates = {};

      Object.keys(updates).forEach((key) => {
        if (allowedFields.includes(key)) {
          filteredUpdates[key] = updates[key];
        }
      });

      if (Object.keys(filteredUpdates).length === 0) {
        throw new Error('No valid fields to update');
      }

      const entries = Object.entries(filteredUpdates);
      const values = [alertId, userId, ...entries.map(([, v]) => v)];
      const setClause = entries.map(([key], index) => `${key} = $${index + 3}`).join(', ');

      const result = await db.query(
        `UPDATE user_alerts
         SET ${setClause}, updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        values
      );

      return result.rows[0];
    } catch (error) {
      logger.error('Error updating alert:', error);
      throw error;
    }
  }

  async deleteAlert(alertId, userId) {
    try {
      const result = await db.query(
        `
        DELETE FROM user_alerts
        WHERE id = $1 AND user_id = $2
        RETURNING *
      `,
        [alertId, userId]
      );

      return result.rows[0];
    } catch (error) {
      logger.error('Error deleting alert:', error);
      throw error;
    }
  }
}

module.exports = AlertService;
