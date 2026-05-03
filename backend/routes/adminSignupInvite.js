const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const db = require('../models/database');
const auth = require('../middleware/auth');
const { requireSignupAdmin } = require('../middleware/requireSignupAdmin');
const { sanitizeInput } = require('../middleware/inputValidation');
const { adminSignupInvitePutLimit } = require('../middleware/authRateLimit');
const signupInvite = require('../services/signupInviteCodeService');
const logger = require('../utils/logger');

const router = express.Router();

const validateNewInviteBody = [
  body('newInviteCode')
    .isLength({ min: 12, max: 512 })
    .withMessage('Invitation code must be between 12 and 512 characters')
    .trim(),
  body('currentPassword')
    .isLength({ min: 8, max: 256 })
    .withMessage('Current password must be provided')
];

router.get('/signup-invite', auth, requireSignupAdmin, async (req, res) => {
  try {
    const status = await signupInvite.statusForAdmin();
    res.json(status);
  } catch (err) {
    logger.error('admin GET signup-invite:', err);
    res.status(500).json({ message: 'Failed to load invite status.' });
  }
});

router.put(
  '/signup-invite',
  sanitizeInput,
  auth,
  requireSignupAdmin,
  adminSignupInvitePutLimit,
  ...validateNewInviteBody,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const pwRow = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
      if (pwRow.rows.length === 0) {
        return res.status(401).json({ message: 'User not found.' });
      }

      const { newInviteCode, currentPassword } = req.body;
      const ok = await bcrypt.compare(currentPassword, pwRow.rows[0].password_hash);
      if (!ok) {
        return res.status(400).json({ message: 'Current password is incorrect.' });
      }

      await signupInvite.setInviteCodePlain(newInviteCode);
      logger.info(`Signup invite code rotated by user id=${req.user.id}`);
      const status = await signupInvite.statusForAdmin();
      res.json({ message: 'Invitation code updated.', ...status });
    } catch (err) {
      logger.error('admin PUT signup-invite:', err);
      res.status(500).json({ message: 'Failed to update invitation code.' });
    }
  }
);

module.exports = router;
