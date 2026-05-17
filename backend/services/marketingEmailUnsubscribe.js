const db = require('../models/database');
const logger = require('../utils/logger');
const { mergeNotificationPreferences } = require('../utils/notificationPreferences');

/**
 * One-click / profile-equivalent: stop watchlist marketing mail; keep account email channel on
 * so password reset and username recovery still work.
 *
 * @param {number} userId
 */
async function applyMarketingEmailUnsubscribe(userId) {
  const cur = await db.query('SELECT id, email, notification_preferences FROM users WHERE id = $1', [
    userId
  ]);
  if (!cur.rows.length) {
    return { ok: false, reason: 'user_not_found' };
  }

  const row = cur.rows[0];
  const merged = mergeNotificationPreferences({
    ...(row.notification_preferences || {}),
    opportunityEmail: false,
    dailyWatchlistDigestEmail: false,
    dipInsightEmail: false,
    thresholdAlertEmail: false
  });

  await db.query(
    `UPDATE users SET notification_preferences = $1::jsonb, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(merged), userId]
  );

  logger.info(`marketing_email_unsubscribed user=${userId} email=${row.email}`);
  return { ok: true, email: row.email };
}

module.exports = {
  applyMarketingEmailUnsubscribe
};
