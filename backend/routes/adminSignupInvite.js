const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const db = require('../models/database');
const auth = require('../middleware/auth');
const { requireSignupAdmin } = require('../middleware/requireSignupAdmin');
const { sanitizeInput } = require('../middleware/inputValidation');
const { adminSignupInvitePutLimit } = require('../middleware/authRateLimit');
const signupInvite = require('../services/signupInviteCodeService');
const { isSignupInviteAdminFromRow, setSignupAdminForUser } = require('../utils/signupInviteAdmin');
const logger = require('../utils/logger');

const router = express.Router();

const ADMIN_USERS_LIMIT = 500;

const validateNewInviteBody = [
  body('newInviteCode')
    .isLength({ min: 12, max: 512 })
    .withMessage('Invitation code must be between 12 and 512 characters')
    .trim(),
  body('currentPassword')
    .isLength({ min: 8, max: 256 })
    .withMessage('Current password must be provided')
];

router.get('/invites', auth, requireSignupAdmin, async (req, res) => {
  try {
    const globalStatus = await signupInvite.statusForAdmin();
    const personalRows = await db.query(
      `SELECT id, username, email, updated_at
       FROM users
       WHERE signup_passcode_hash IS NOT NULL
       ORDER BY LOWER(COALESCE(username, email)) ASC`
    );
    res.json({
      globalInvite: {
        kind: 'host',
        active: globalStatus.configured,
        updatedAt: globalStatus.updatedAt,
        note: 'Plaintext is stored only as a hash. Rotate below to set a new code you can share.'
      },
      personalPasscodes: personalRows.rows.map((row) => ({
        kind: 'personal',
        userId: row.id,
        username: row.username || null,
        email: row.email,
        active: true,
        updatedAt: row.updated_at ? row.updated_at.toISOString?.() ?? String(row.updated_at) : null
      }))
    });
  } catch (err) {
    logger.error('admin GET invites:', err);
    res.status(500).json({ message: 'Failed to load invite codes.' });
  }
});

router.get('/users', auth, requireSignupAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         u.id,
         u.username,
         u.email,
         u.created_at,
         u.updated_at,
         u.invited_by_user_id,
         inv.username AS invited_by_username,
         inv.email AS invited_by_email,
         (u.signup_passcode_hash IS NOT NULL) AS personal_passcode_active,
         COALESCE(u.is_signup_admin, false) AS is_signup_admin,
         (SELECT COUNT(*)::int FROM users c WHERE c.invited_by_user_id = u.id) AS invitees_count
       FROM users u
       LEFT JOIN users inv ON inv.id = u.invited_by_user_id
       ORDER BY u.created_at DESC
       LIMIT $1`,
      [ADMIN_USERS_LIMIT]
    );
    res.json({
      users: result.rows.map((row) => ({
        id: row.id,
        username: row.username || null,
        email: row.email,
        createdAt: row.created_at ? row.created_at.toISOString?.() ?? String(row.created_at) : null,
        updatedAt: row.updated_at ? row.updated_at.toISOString?.() ?? String(row.updated_at) : null,
        invitedByUserId: row.invited_by_user_id,
        invitedByUsername: row.invited_by_username || null,
        invitedByEmail: row.invited_by_email || null,
        personalPasscodeActive: Boolean(row.personal_passcode_active),
        inviteesCount: Number(row.invitees_count) || 0,
        isSignupInviteAdmin: isSignupInviteAdminFromRow(row)
      })),
      limit: ADMIN_USERS_LIMIT
    });
  } catch (err) {
    logger.error('admin GET users:', err);
    res.status(500).json({ message: 'Failed to load users.' });
  }
});

router.put(
  '/users/:userId/signup-admin',
  sanitizeInput,
  auth,
  requireSignupAdmin,
  body('admin').isBoolean().withMessage('admin must be true or false'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const targetUserId = Number(req.params.userId);
      if (!Number.isFinite(targetUserId) || targetUserId < 1) {
        return res.status(400).json({ message: 'Invalid user id.' });
      }

      const result = await setSignupAdminForUser(targetUserId, req.body.admin, req.user.id);
      logger.info(
        `Signup admin ${req.body.admin ? 'granted' : 'revoked'} for user id=${targetUserId} by id=${req.user.id}`
      );
      res.json({
        message: req.body.admin ? 'Administrator access granted.' : 'Administrator access revoked.',
        user: result
      });
    } catch (err) {
      if (err.statusCode === 404) {
        return res.status(404).json({ message: err.message });
      }
      if (err.statusCode === 400) {
        return res.status(400).json({ message: err.message });
      }
      logger.error('admin PUT signup-admin:', err);
      res.status(500).json({ message: 'Failed to update administrator access.' });
    }
  }
);

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
