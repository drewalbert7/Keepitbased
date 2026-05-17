const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const db = require('../models/database');
const auth = require('../middleware/auth');
const {
  authRateLimit,
  registrationRateLimit,
  passwordResetRateLimit,
  recoveryEmailRateLimit,
  recoveryEmailPerIpRateLimit
} = require('../middleware/authRateLimit');
const { verifyTurnstile } = require('../middleware/verifyTurnstile');
const { sanitizeInput, validateEmail, validatePassword, handleValidationErrors } = require('../middleware/inputValidation');
const logger = require('../utils/logger');
const config = require('../config');
const emailService = require('../services/emailService');
const { mergeNotificationPreferences } = require('../utils/notificationPreferences');
const signupInviteCodeService = require('../services/signupInviteCodeService');
const userSignupPasscodeService = require('../services/userSignupPasscodeService');
const { isSignupInviteAdmin } = require('../utils/signupInviteAdmin');
const cryptoSecurity = require('../utils/cryptoSecurity');

function serializeUserSafe(userRow) {
  return {
    id: userRow.id,
    email: userRow.email,
    username: userRow.username || null,
    firstName: userRow.first_name,
    lastName: userRow.last_name,
    notificationPreferences: mergeNotificationPreferences(userRow.notification_preferences),
    isSignupInviteAdmin: isSignupInviteAdmin(userRow.email)
  };
}

// Development mode flag for graceful fallback
const isDevelopment = process.env.NODE_ENV === 'development';

// Helper function for development fallback
const getDevelopmentFallback = async (email) => {
  if (!isDevelopment || email !== 'test@example.com') {
    return null;
  }
  
  logger.warn('Using development fallback - create a real user for production');
  return {
    id: 1,
    email: 'test@example.com',
    password_hash: '$2a$12$I8YdG.r51mYdUqTEJIUii.ssswnDy7dzeFnsMfsAojK/uAKQQfSJe',
    username: 'testuser',
    first_name: 'Test',
    last_name: 'User'
  };
};

// Register
router.post('/register', sanitizeInput, registrationRateLimit, [
  validateEmail,
  validatePassword,
  body('username')
    .matches(/^[a-zA-Z0-9_]{3,32}$/)
    .withMessage('Username must be 3–32 characters: letters, numbers, or underscore only')
    .trim(),
  body('inviteCode')
    .isLength({ min: 8, max: 512 })
    .withMessage('Invitation or passcode must be between 8 and 512 characters')
    .trim()
], handleValidationErrors, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, username, inviteCode } = req.body;
    const usernameNorm = String(username).trim().toLowerCase();

    const globalInviteReady = await signupInviteCodeService.inviteCodeConfigured();
    const personalInviteReady = await userSignupPasscodeService.anyUserHasSignupPasscode();
    if (!globalInviteReady && !personalInviteReady) {
      logger.warn(`Registration rejected: no signup channel configured (ip=${req.ip})`);
      return res.status(503).json({
        message: 'Account signup is temporarily unavailable.'
      });
    }

    let invitedByUserId = null;
    let inviteAccepted = false;
    if (globalInviteReady) {
      const globalOk = await signupInviteCodeService.verifyInviteCode(inviteCode || '');
      if (globalOk) {
        inviteAccepted = true;
      }
    }
    if (!inviteAccepted) {
      const personal = await userSignupPasscodeService.verifyUserPasscode(inviteCode || '');
      if (personal.ok) {
        inviteAccepted = true;
        invitedByUserId = personal.inviterUserId;
      }
    }
    if (!inviteAccepted) {
      cryptoSecurity.createAuditLog('invite_signup_denied', req.ip, {
        endpoint: '/register',
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      return res.status(403).json({ message: 'Invalid invitation code or passcode.' });
    }

    // Check if user already exists
    const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: 'User already exists' });
    }

    const dupName = await db.query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
      [usernameNorm]
    );
    if (dupName.rows.length > 0) {
      return res.status(409).json({ message: 'Username is already taken' });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user (display names deprecated — username only for new accounts)
    const result = await db.query(
      `
      INSERT INTO users (
        email, password_hash, username, first_name, last_name,
        invited_by_user_id, email_last_seen_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, NULL, NULL, $4, NOW(), NOW(), NOW())
      RETURNING id, email, username, first_name, last_name, created_at
    `,
      [email, passwordHash, usernameNorm, invitedByUserId]
    );

    const user = result.rows[0];

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRES_IN }
    );

    res.status(201).json({
      message: 'User created successfully',
      token,
      user: serializeUserSafe({ ...user, notification_preferences: null })
    });
  } catch (error) {
    logger.error('Error registering user:', error);
    res.status(500).json({ message: 'Registration failed' });
  }
});

// Login
router.post('/login', sanitizeInput, authRateLimit, [
  validateEmail,
  body('password').isLength({ min: 1 }).withMessage('Password is required')
], handleValidationErrors, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;
    let user = null;

    try {
      // Try database first
      const result = await db.query(
        `
        SELECT id, email, password_hash, username, first_name, last_name, notification_preferences
        FROM users WHERE email = $1
      `,
        [email]
      );

      if (result.rows.length > 0) {
        user = result.rows[0];
      }
    } catch (dbError) {
      logger.warn('Database query failed, attempting development fallback:', dbError.message);
      
      // Development fallback only if database completely fails
      if (isDevelopment) {
        user = await getDevelopmentFallback(email);
      }
    }

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    try {
      await db.query(
        `UPDATE users SET email_last_seen_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [user.id]
      );
    } catch (e) {
      logger.warn(`email_last_seen_at update skipped: ${e.message}`);
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRES_IN }
    );

    res.json({
      message: 'Login successful',
      token,
      user: serializeUserSafe(user)
    });
  } catch (error) {
    logger.error('Error logging in user:', error);
    res.status(500).json({ message: 'Login failed' });
  }
});

// Get current user
router.get('/me', auth, async (req, res) => {
  try {
    const result = await db.query(
      `
      SELECT id, email, username, first_name, last_name, notification_preferences, created_at
      FROM users WHERE id = $1
    `,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = result.rows[0];
    res.json({
      ...serializeUserSafe(user),
      createdAt: user.created_at
    });
  } catch (error) {
    logger.error('Error getting user profile:', error);
    res.status(500).json({ message: 'Failed to get user profile' });
  }
});

// Change password
router.post('/change-password', [
  auth,
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;

    // Get current user with password hash
    const result = await db.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = result.rows[0];

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValidPassword) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    // Hash new password
    const saltRounds = 12;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password in database
    await db.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newPasswordHash, req.user.id]
    );

    logger.info(`Password changed for user ID: ${req.user.id}`);
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    logger.error('Error changing password:', error);
    res.status(500).json({ message: 'Failed to change password' });
  }
});

// Recover username (sends email — same SES abuse cap as password recovery)
router.post(
  '/recover-username',
  sanitizeInput,
  [body('email').isEmail().withMessage('Valid email is required')],
  handleValidationErrors,
  recoveryEmailPerIpRateLimit,
  recoveryEmailRateLimit,
  verifyTurnstile,
  async (req, res) => {
  try {
    const { email } = req.body;

    // Find user by email
    const result = await db.query(
      'SELECT email, username FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      // Don't reveal if email exists or not for security
      return res.json({ message: 'If an account with that email exists, the username has been sent to the email address.' });
    }

    const row = result.rows[0];
    const uname = row.username ? String(row.username) : '';

    // Send username recovery email
    logger.info(`Username recovery requested for email: ${email}`);
    await emailService.sendUsernameRecovery(email, uname);
    
    res.json({ message: 'If an account with that email exists, the username has been sent to the email address.' });
  } catch (error) {
    logger.error('Error recovering username:', error);
    res.status(500).json({ message: 'Failed to recover username' });
  }
});

// Recover password (reset password)
router.post(
  '/recover-password',
  sanitizeInput,
  [body('email').isEmail().withMessage('Valid email is required')],
  handleValidationErrors,
  recoveryEmailPerIpRateLimit,
  passwordResetRateLimit,
  verifyTurnstile,
  async (req, res) => {
  try {
    const { email } = req.body;

    // Find user by email
    const result = await db.query('SELECT id, email FROM users WHERE email = $1', [email]);
    
    if (result.rows.length === 0) {
      // Don't reveal if email exists or not for security
      return res.json({ message: 'If an account with that email exists, password reset instructions have been sent to the email address.' });
    }

    const user = result.rows[0];

    // Generate password reset token (in production, use crypto.randomBytes)
    const resetToken = jwt.sign(
      { userId: user.id, purpose: 'password_reset' },
      config.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Store reset token in database (you may want to create a separate table for this)
    await db.query(
      'UPDATE users SET reset_token = $1, reset_token_expires = NOW() + INTERVAL \'1 hour\' WHERE id = $2',
      [resetToken, user.id]
    );

    // Send password reset email
    logger.info(`Password reset requested for email: ${email}`);
    await emailService.sendPasswordReset(email, resetToken);
    
    res.json({ message: 'If an account with that email exists, password reset instructions have been sent to the email address.' });
  } catch (error) {
    logger.error('Error recovering password:', error);
    res.status(500).json({ message: 'Failed to recover password' });
  }
});

// Reset password with token
router.post('/reset-password', [
  body('token').notEmpty().withMessage('Reset token is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { token, newPassword } = req.body;

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, config.JWT_SECRET);
      if (decoded.purpose !== 'password_reset') {
        throw new Error('Invalid token purpose');
      }
    } catch (err) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    // Check if token exists and is not expired
    const result = await db.query(
      'SELECT id FROM users WHERE id = $1 AND reset_token = $2 AND reset_token_expires > NOW()',
      [decoded.userId, token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    // Hash new password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password and clear reset token
    await db.query(
      'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL, updated_at = NOW() WHERE id = $2',
      [passwordHash, decoded.userId]
    );

    logger.info(`Password reset completed for user ID: ${decoded.userId}`);
    res.json({ message: 'Password reset successful. You can now log in with your new password.' });
  } catch (error) {
    logger.error('Error resetting password:', error);
    res.status(500).json({ message: 'Failed to reset password' });
  }
});

module.exports = router;