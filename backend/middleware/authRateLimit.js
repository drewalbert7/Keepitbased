const rateLimit = require('express-rate-limit');
const cryptoSecurity = require('../utils/cryptoSecurity');
const logger = require('../utils/logger');

/**
 * Strict rate limiting for authentication endpoints to prevent brute force attacks
 */
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per 15 minutes per IP
  message: {
    error: 'Too many authentication attempts',
    message: 'Too many login attempts. Please try again in 15 minutes.',
    retryAfter: 900
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use IP for auth rate limiting (no user-agent to avoid fingerprinting issues)
    return req.ip;
  },
  handler: (req, res) => {
    logger.warn(`Auth rate limit exceeded for IP: ${req.ip}`);
    
    cryptoSecurity.createAuditLog('auth_rate_limit_exceeded', req.ip, {
      endpoint: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      body: req.body // Log failed attempt (without sensitive data)
    });
    
    res.status(429).json({
      error: 'Rate limit exceeded',
      message: 'Too many authentication attempts. Please try again in 15 minutes.',
      retryAfter: 900
    });
  }
});

/**
 * More lenient rate limiting for registration (but still protected)
 */
const registrationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 registration attempts per hour per IP
  message: {
    error: 'Too many registration attempts',
    message: 'Too many registration attempts. Please try again in 1 hour.',
    retryAfter: 3600
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip;
  },
  handler: (req, res) => {
    logger.warn(`Registration rate limit exceeded for IP: ${req.ip}`);
    
    cryptoSecurity.createAuditLog('registration_rate_limit_exceeded', req.ip, {
      endpoint: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    res.status(429).json({
      error: 'Rate limit exceeded',
      message: 'Too many registration attempts. Please try again in 1 hour.',
      retryAfter: 3600
    });
  }
});

/**
 * Password reset rate limiting (very strict to prevent abuse)
 */
const passwordResetRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 2, // 2 password reset requests per hour per IP
  message: {
    error: 'Too many password reset attempts',
    message: 'Too many password reset attempts. Please try again in 1 hour.',
    retryAfter: 3600
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip;
  },
  handler: (req, res) => {
    logger.warn(`Password reset rate limit exceeded for IP: ${req.ip}`);
    
    cryptoSecurity.createAuditLog('password_reset_rate_limit_exceeded', req.ip, {
      endpoint: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      email: req.body.email // Log reset attempt (email is not sensitive)
    });
    
    res.status(429).json({
      error: 'Rate limit exceeded',
      message: 'Too many password reset attempts. Please try again in 1 hour.',
      retryAfter: 3600
    });
  }
});

module.exports = {
  authRateLimit,
  registrationRateLimit,
  passwordResetRateLimit
};