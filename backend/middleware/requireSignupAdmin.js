const db = require('../models/database');
const logger = require('../utils/logger');
const { parseAdminSignupEmails } = require('../utils/signupInviteAdmin');

/**
 * ADMIN_SIGNUP_EMAILS — comma-separated list of user emails allowed to rotate signup invite code.
 */
async function requireSignupAdmin(req, res, next) {
  try {
    const allowed = parseAdminSignupEmails();
    if (allowed.length === 0) {
      logger.warn('requireSignupAdmin: ADMIN_SIGNUP_EMAILS is empty');
      return res.status(503).json({
        message: 'Invite admin is not configured (set ADMIN_SIGNUP_EMAILS on the server).'
      });
    }

    const result = await db.query('SELECT lower(trim(email)) AS email FROM users WHERE id = $1', [
      req.user.id
    ]);
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'User not found.' });
    }
    const email = result.rows[0].email;
    if (!allowed.includes(email)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }
    next();
  } catch (err) {
    logger.error('requireSignupAdmin error:', err);
    res.status(500).json({ message: 'Failed to verify permissions.' });
  }
}

module.exports = { requireSignupAdmin, parseAdminSignupEmails };
