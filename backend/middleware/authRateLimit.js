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
 * Per-IP cap across all recovery targets (complements recoveryEmailRateLimit which is IP+email).
 * Prevents spraying many different addresses from one host.
 */
const recoveryEmailPerIpRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 12,
  message: {
    error: 'Too many recovery attempts',
    message: 'Too many account recovery attempts from this network. Please try again in 1 hour.',
    retryAfter: 3600
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `recovery-email-ip:${req.ip}`,
  handler: (req, res) => {
    logger.warn(`Recovery email per-IP rate limit exceeded for IP: ${req.ip} path=${req.path}`);
    cryptoSecurity.createAuditLog('recovery_email_per_ip_rate_limit_exceeded', req.ip, {
      endpoint: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    res.status(429).json({
      error: 'Rate limit exceeded',
      message: 'Too many account recovery attempts from this network. Please try again in 1 hour.',
      retryAfter: 3600
    });
  }
});

/**
 * Shared cap for any unauthenticated route that triggers outbound email (SES).
 * One limiter instance so bots cannot split traffic across /recover-password and /recover-username.
 */
const recoveryEmailRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  // Per client IP + target email: stops inbox flooding to one victim from one host (and caps SES noise).
  max: 3,
  message: {
    error: 'Too many recovery attempts',
    message: 'Too many account recovery attempts. Please try again in 1 hour.',
    retryAfter: 3600
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const e = (req.body?.email && String(req.body.email).toLowerCase().trim()) || '';
    return e ? `recovery-email:${req.ip}:${e}` : `recovery-email:${req.ip}`;
  },
  handler: (req, res) => {
    logger.warn(`Recovery email rate limit exceeded for IP: ${req.ip} path=${req.path}`);

    cryptoSecurity.createAuditLog('recovery_email_rate_limit_exceeded', req.ip, {
      endpoint: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      email: req.body?.email
    });

    res.status(429).json({
      error: 'Rate limit exceeded',
      message: 'Too many account recovery attempts. Please try again in 1 hour.',
      retryAfter: 3600
    });
  }
});

/** @deprecated Use recoveryEmailRateLimit; kept as alias for same middleware (shared store). */
const passwordResetRateLimit = recoveryEmailRateLimit;

/**
 * Admin-only: PUT /api/admin/signup-invite — per authenticated user id
 */
const adminSignupInvitePutLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: {
    error: 'Too many invite rotations',
    message: 'Too many invitation code updates. Try again later.',
    retryAfter: 3600
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const id = req.user?.id ?? 'anonymous';
    return `admin-invite-put:${id}`;
  },
  handler: (req, res) => {
    logger.warn(`Admin invite PUT rate limit for user=${req.user?.id} ip=${req.ip}`);
    res.status(429).json({
      error: 'Rate limit exceeded',
      message: 'Too many invitation code updates. Try again later.',
      retryAfter: 3600
    });
  }
});

module.exports = {
  authRateLimit,
  registrationRateLimit,
  recoveryEmailPerIpRateLimit,
  recoveryEmailRateLimit,
  passwordResetRateLimit,
  adminSignupInvitePutLimit
};