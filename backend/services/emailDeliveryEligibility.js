const db = require('../models/database');
const logger = require('../utils/logger');

function sunsetDisabled() {
  return process.env.DISABLE_EMAIL_ENGAGEMENT_SUNSET === 'true';
}

/**
 * Hard bounce / complaint — do not send any mail to this address (including recovery).
 */
async function isSesDeliverySuppressed(email) {
  if (!email || typeof email !== 'string') return false;
  const r = await db.query(
    `SELECT 1 FROM users
     WHERE LOWER(email) = LOWER($1) AND email_ses_suppressed_at IS NOT NULL
     LIMIT 1`,
    [email.trim()]
  );
  return r.rows.length > 0;
}

/**
 * Opt-in marketing-style mail (alerts, digests, opportunity emails): respect SES suppression
 * and optional 6-month engagement window (login/register updates `email_last_seen_at`).
 */
async function shouldSkipOptionalMarketingEmail(email, logTag) {
  if (!email || typeof email !== 'string') return { skip: true, reason: 'no_email' };
  const r = await db.query(
    `SELECT id,
       (email_ses_suppressed_at IS NOT NULL) AS ses_bad,
       (COALESCE(email_last_seen_at, created_at) >= NOW() - INTERVAL '6 months') AS recent_enough
     FROM users WHERE LOWER(email) = LOWER($1)`,
    [email.trim()]
  );
  const row = r.rows[0];
  if (!row) return { skip: false };
  if (row.ses_bad) {
    logger.warn(`SES suppressed — skip ${logTag} user=${row.id}`);
    return { skip: true, reason: 'ses' };
  }
  if (!sunsetDisabled() && !row.recent_enough) {
    logger.info(`Engagement sunset — skip ${logTag} user=${row.id}`);
    return { skip: true, reason: 'sunset' };
  }
  return { skip: false };
}

module.exports = {
  isSesDeliverySuppressed,
  shouldSkipOptionalMarketingEmail,
  sunsetDisabled
};
