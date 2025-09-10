const logger = require('../utils/logger');
const db = require('../models/database');
const emailService = require('./emailService');
const { getRedisClient } = require('../utils/redis');

class AlertService {
  constructor(io) {
    this.io = io;
    this.redis = getRedisClient();
  }

  async processAlerts() {
    try {
      // Get all active alerts
      const alerts = await db.query(`
        SELECT ua.*, u.email, u.notification_preferences
        FROM user_alerts ua
        JOIN users u ON ua.user_id = u.id
        WHERE ua.active = true
        ORDER BY ua.created_at DESC
      `);

      if (alerts.rows.length === 0) {
        return;
      }

      logger.info(`Processing ${alerts.rows.length} active alerts`);

      for (const alert of alerts.rows) {
        await this.checkAlert(alert);
      }
    } catch (error) {
      logger.error('Error processing alerts:', error);
    }
  }

  async checkAlert(alert) {
    try {
      // Get current price from Redis cache
      const cachedPrice = await this.redis.get(`price:${alert.asset_type}:${alert.symbol}`);
      
      if (!cachedPrice) {
        return; // No price data available
      }

      const priceData = JSON.parse(cachedPrice);
      const currentPrice = priceData.price;

      // Calculate price drop percentage from baseline
      if (!alert.baseline_price) {
        // Set baseline price if not set
        await this.updateBaselinePrice(alert.id, currentPrice);
        return;
      }

      const dropPercentage = ((alert.baseline_price - currentPrice) / alert.baseline_price) * 100;

      // Check if drop meets any threshold
      const triggeredLevel = this.getTriggeredLevel(dropPercentage, alert);
      
      if (triggeredLevel) {
        // Check if we already sent this level alert recently
        const cooldownKey = `alert_sent:${alert.id}:${triggeredLevel}`;
        const recentAlert = await this.redis.get(cooldownKey);
        
        if (!recentAlert) {
          await this.triggerAlert(alert, priceData, dropPercentage, triggeredLevel);
          
          // Set cooldown (1 hour)
          await this.redis.setex(cooldownKey, 3600, 'true');
        }
      }

      // Update baseline if price has recovered significantly
      if (currentPrice > alert.baseline_price * 1.02) { // 2% recovery
        await this.updateBaselinePrice(alert.id, currentPrice);
      }

    } catch (error) {
      logger.error(`Error checking alert ${alert.id}:`, error);
    }
  }

  getTriggeredLevel(dropPercentage, alert) {
    if (dropPercentage >= alert.large_threshold) {
      return 'large';
    } else if (dropPercentage >= alert.medium_threshold) {
      return 'medium';
    } else if (dropPercentage >= alert.small_threshold) {
      return 'small';
    }
    return null;
  }

  async triggerAlert(alert, priceData, dropPercentage, level) {
    try {
      logger.info(`Triggering ${level} alert for ${alert.symbol} - ${dropPercentage.toFixed(2)}% drop`);

      const alertData = {
        id: alert.id,
        userId: alert.user_id,
        symbol: alert.symbol,
        assetType: alert.asset_type,
        level: level,
        currentPrice: priceData.price,
        baselinePrice: alert.baseline_price,
        dropPercentage: dropPercentage.toFixed(2),
        threshold: alert[`${level}_threshold`],
        timestamp: new Date().toISOString(),
        message: this.generateAlertMessage(alert, priceData, dropPercentage, level)
      };

      // Store alert in database
      await db.query(`
        INSERT INTO alert_history (
          user_id, symbol, asset_type, alert_level, 
          current_price, baseline_price, drop_percentage,
          threshold_percentage, message, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      `, [
        alert.user_id,
        alert.symbol,
        alert.asset_type,
        level,
        priceData.price,
        alert.baseline_price,
        dropPercentage,
        alert[`${level}_threshold`],
        alertData.message
      ]);

      // Send real-time notification to user
      this.io.to(`user_${alert.user_id}`).emit('alert', alertData);

      // Send email if enabled
      const notificationPrefs = alert.notification_preferences || {};
      if (notificationPrefs.email !== false) {
        await emailService.sendAlert(alert.email, alertData);
      }

      // Send push notification if enabled
      if (notificationPrefs.push !== false) {
        await this.sendPushNotification(alert.user_id, alertData);
      }

    } catch (error) {
      logger.error('Error triggering alert:', error);
    }
  }

  generateAlertMessage(alert, priceData, dropPercentage, level) {
    const levelEmojis = {
      small: '🟡',
      medium: '🟠', 
      large: '🔴'
    };

    const emoji = levelEmojis[level];
    const symbol = alert.symbol;
    const assetType = alert.asset_type.toUpperCase();
    
    return `${emoji} ${level.toUpperCase()} BUY SIGNAL: ${assetType} ${symbol} has dropped ${dropPercentage.toFixed(2)}% to $${priceData.price.toFixed(2)}. Time to buy the dip!`;
  }

  async updateBaselinePrice(alertId, newPrice) {
    try {
      await db.query(`
        UPDATE user_alerts 
        SET baseline_price = $1, updated_at = NOW()
        WHERE id = $2
      `, [newPrice, alertId]);
      
      logger.info(`Updated baseline price for alert ${alertId}: $${newPrice}`);
    } catch (error) {
      logger.error('Error updating baseline price:', error);
    }
  }

  async sendPushNotification(userId, alertData) {
    // TODO: Implement push notifications using service like Firebase FCM
    logger.info(`Push notification would be sent to user ${userId}:`, alertData.message);
  }

  async createAlert(userId, symbol, assetType, thresholds = {}) {
    try {
      const {
        small_threshold = 5,
        medium_threshold = 10,
        large_threshold = 15
      } = thresholds;

      // Get current price as baseline
      const cachedPrice = await this.redis.get(`price:${assetType}:${symbol}`);
      let baselinePrice = null;
      
      if (cachedPrice) {
        const priceData = JSON.parse(cachedPrice);
        baselinePrice = priceData.price;
      }

      const result = await db.query(`
        INSERT INTO user_alerts (
          user_id, symbol, asset_type, small_threshold,
          medium_threshold, large_threshold, baseline_price,
          active, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW(), NOW())
        RETURNING *
      `, [
        userId, symbol, assetType, small_threshold,
        medium_threshold, large_threshold, baselinePrice
      ]);

      return result.rows[0];
    } catch (error) {
      logger.error('Error creating alert:', error);
      throw error;
    }
  }

  async getUserAlerts(userId) {
    try {
      const result = await db.query(`
        SELECT * FROM user_alerts 
        WHERE user_id = $1 
        ORDER BY created_at DESC
      `, [userId]);

      return result.rows;
    } catch (error) {
      logger.error('Error getting user alerts:', error);
      throw error;
    }
  }

  async updateAlert(alertId, updates) {
    try {
      // Only allow updating specific fields to prevent SQL injection
      const allowedFields = ['small_threshold', 'medium_threshold', 'large_threshold', 'baseline_price', 'active'];
      const filteredUpdates = {};
      const values = [alertId];
      let paramIndex = 2;
      
      // Filter and validate updates
      Object.keys(updates).forEach(key => {
        if (allowedFields.includes(key)) {
          filteredUpdates[key] = updates[key];
          values.push(updates[key]);
          paramIndex++;
        }
      });
      
      if (Object.keys(filteredUpdates).length === 0) {
        throw new Error('No valid fields to update');
      }
      
      // Build SET clause with parameterized queries
      const setClause = Object.keys(filteredUpdates)
        .map((key, index) => `${key} $${index + 2}`)
        .join(', ');
      
      const result = await db.query(
        `UPDATE user_alerts 
         SET ${setClause}, updated_at = NOW()
         WHERE id = $1
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
      const result = await db.query(`
        DELETE FROM user_alerts 
        WHERE id = $1 AND user_id = $2
        RETURNING *
      `, [alertId, userId]);

      return result.rows[0];
    } catch (error) {
      logger.error('Error deleting alert:', error);
      throw error;
    }
  }
}

module.exports = AlertService;