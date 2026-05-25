const db = require('../models/database');

/**
 * @param {number} userId
 * @returns {Promise<Set<number>>}
 */
async function getDeployAlertIdSet(userId) {
  const r = await db.query(
    `SELECT user_alert_id FROM user_deploy_list_items
     WHERE user_id = $1 AND status = 'active'`,
    [userId]
  );
  return new Set(r.rows.map((row) => Number(row.user_alert_id)));
}

module.exports = { getDeployAlertIdSet };
