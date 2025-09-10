const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const db = require('../models/database');
const auth = require('../middleware/auth');
const { authRateLimit, registrationRateLimit, passwordResetRateLimit } = require('../middleware/authRateLimit');
const { sanitizeInput, validateEmail, validatePassword, handleValidationErrors } = require('../middleware/inputValidation');
const logger = require('../utils/logger');
const config = require('../config');
const emailService = require('../services/emailService');

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
    first_name: 'Test',
    last_name: 'User'
  };
};

// Register
router.post('/register', sanitizeInput, registrationRateLimit, [
  validateEmail,
  validatePassword,
  body('firstName').isLength({ min: 1, max: 50 }).withMessage('First name must be between 1 and 50 characters').trim(),
  body('lastName').isLength({ min: 1, max: 50 }).withMessage('Last name must be between 1 and 50 characters').trim()
], handleValidationErrors, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, firstName, lastName } = req.body;

    // Check if user already exists
    const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: 'User already exists' });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user
    const result = await db.query(`
      INSERT INTO users (email, password_hash, first_name, last_name, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING id, email, first_name, last_name, created_at
    `, [email, passwordHash, firstName, lastName]);

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
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name
      }
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
      const result = await db.query(`
        SELECT id, email, password_hash, first_name, last_name, notification_preferences
        FROM users WHERE email = $1
      `, [email]);

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

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRES_IN }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        notificationPreferences: user.notification_preferences || { email: true, push: true }
      }
    });
  } catch (error) {
    logger.error('Error logging in user:', error);
    res.status(500).json({ message: 'Login failed' });
  }
});

// Get current user
router.get('/me', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, email, first_name, last_name, notification_preferences, created_at
      FROM users WHERE id = $1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = result.rows[0];
    res.json({
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      notificationPreferences: user.notification_preferences,
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

// Recover username
router.post('/recover-username', [
  body('email').isEmail().withMessage('Valid email is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email } = req.body;

    // Find user by email
    const result = await db.query('SELECT email FROM users WHERE email = $1', [email]);
    
    if (result.rows.length === 0) {
      // Don't reveal if email exists or not for security
      return res.json({ message: 'If an account with that email exists, the username has been sent to the email address.' });
    }

    // Send username recovery email
    logger.info(`Username recovery requested for email: ${email}`);
    await emailService.sendUsernameRecovery(email);
    
    res.json({ message: 'If an account with that email exists, the username has been sent to the email address.' });
  } catch (error) {
    logger.error('Error recovering username:', error);
    res.status(500).json({ message: 'Failed to recover username' });
  }
});

// Recover password (reset password)
router.post('/recover-password', passwordResetRateLimit, [
  body('email').isEmail().withMessage('Valid email is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

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