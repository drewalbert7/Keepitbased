const logger = require('../utils/logger');
const { userIsSignupAdmin, anySignupAdminConfigured } = require('../utils/signupInviteAdmin');

async function requireSignupAdmin(req, res, next) {
  try {
    if (!(await anySignupAdminConfigured())) {
      logger.warn('requireSignupAdmin: no administrators configured');
      return res.status(503).json({
        message:
          'Invite admin is not configured (set ADMIN_SIGNUP_EMAILS or promote a user in the database).'
      });
    }

    const isAdmin = await userIsSignupAdmin(req.user.id);
    if (!isAdmin) {
      return res.status(403).json({ message: 'Forbidden.' });
    }
    next();
  } catch (err) {
    logger.error('requireSignupAdmin error:', err);
    res.status(500).json({ message: 'Failed to verify permissions.' });
  }
}

module.exports = { requireSignupAdmin };
