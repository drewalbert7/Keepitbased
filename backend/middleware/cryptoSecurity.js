const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cryptoSecurity = require('../utils/cryptoSecurity');
const auth = require('./auth');
const logger = require('../utils/logger');

/**
 * Rate limiting middleware for public crypto endpoints
 */
const publicCryptoRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: {
    error: 'Too many requests from this IP',
    message: 'Public crypto API rate limit exceeded. Try again later.',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use IP + User-Agent for better rate limiting
    return `${req.ip}:${req.get('User-Agent')?.slice(0, 100) || 'unknown'}`;
  },
  handler: (req, res) => {
    cryptoSecurity.createAuditLog('rate_limit_exceeded', req.ip, {
      endpoint: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    res.status(429).json({
      error: 'Rate limit exceeded',
      message: 'Too many requests. Please try again later.',
      retryAfter: 60
    });
  }
});

/**
 * Rate limiting middleware for private crypto endpoints (stricter)
 */
const privateCryptoRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute for private endpoints
  message: {
    error: 'Too many requests from this IP',
    message: 'Private crypto API rate limit exceeded. Try again later.',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use authenticated user ID if available, otherwise IP
    const userId = req.user?.id || req.ip;
    return `private:${userId}`;
  },
  handler: (req, res) => {
    cryptoSecurity.createAuditLog('private_rate_limit_exceeded', req.user?.id || req.ip, {
      endpoint: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    res.status(429).json({
      error: 'Rate limit exceeded',
      message: 'Private API rate limit exceeded. Please try again later.',
      retryAfter: 60
    });
  }
});

/**
 * Security headers middleware specifically for crypto endpoints
 */
const cryptoSecurityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "https://api.kraken.com", "wss://ws.kraken.com"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  frameguard: { action: 'deny' },
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
});

/**
 * IP whitelist middleware (optional)
 */
const ipWhitelist = (whitelist = []) => {
  return (req, res, next) => {
    if (!whitelist.length) {
      return next(); // No whitelist = allow all
    }
    
    const clientIP = req.ip || req.connection.remoteAddress;
    
    if (!cryptoSecurity.validateIPWhitelist(clientIP, whitelist)) {
      cryptoSecurity.createAuditLog('ip_blocked', clientIP, {
        endpoint: req.path,
        method: req.method,
        ip: clientIP,
        userAgent: req.get('User-Agent')
      });
      
      logger.warn(`Blocked request from unauthorized IP: ${clientIP}`);
      
      return res.status(403).json({
        error: 'Access forbidden',
        message: 'Your IP address is not authorized to access this endpoint'
      });
    }
    
    next();
  };
};

/**
 * Request signature validation middleware
 */
const validateRequestSignature = (req, res, next) => {
  const signature = req.headers['x-signature'];
  const timestamp = req.headers['x-timestamp'];
  
  if (!signature || !timestamp) {
    return res.status(401).json({
      error: 'Missing security headers',
      message: 'Request signature and timestamp required'
    });
  }
  
  // Check timestamp to prevent replay attacks (5 minute window)
  const now = Date.now();
  const requestTime = parseInt(timestamp);
  const maxAge = 5 * 60 * 1000; // 5 minutes
  
  if (Math.abs(now - requestTime) > maxAge) {
    cryptoSecurity.createAuditLog('replay_attack_attempt', req.ip, {
      endpoint: req.path,
      method: req.method,
      timestamp: requestTime,
      timeDiff: now - requestTime
    });
    
    return res.status(401).json({
      error: 'Request expired',
      message: 'Request timestamp is too old or too far in the future'
    });
  }
  
  // Validate signature (would need shared secret)
  const secret = process.env.REQUEST_SIGNATURE_SECRET;
  if (secret && !cryptoSecurity.validateRequestSignature(req, signature, secret)) {
    cryptoSecurity.createAuditLog('invalid_signature', req.ip, {
      endpoint: req.path,
      method: req.method,
      signature: signature.slice(0, 10) + '...'
    });
    
    return res.status(401).json({
      error: 'Invalid signature',
      message: 'Request signature is invalid'
    });
  }
  
  next();
};

/**
 * Suspicious activity detection middleware
 */
const detectSuspiciousActivity = (req, res, next) => {
  const identifier = req.user?.id || req.ip;
  const isPrivate = req.path.includes('/balance') || req.path.includes('/trades-history');
  
  // Check rate limiting
  const rateCheck = cryptoSecurity.checkRateLimit(identifier, isPrivate);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      message: 'Too many requests',
      retryAfter: Math.ceil((rateCheck.resetTime - new Date()) / 1000)
    });
  }
  
  // Check for suspicious patterns
  if (cryptoSecurity.detectSuspiciousActivity(identifier, 'rapidRequests')) {
    logger.warn(`Suspicious activity detected for ${identifier}`);
    
    // Don't block immediately, but log and potentially alert
    cryptoSecurity.createAuditLog('suspicious_activity', identifier, {
      endpoint: req.path,
      method: req.method,
      ip: req.ip
    });
  }
  
  next();
};

/**
 * Enhanced logging middleware for crypto endpoints
 */
const cryptoAuditLog = (req, res, next) => {
  const startTime = Date.now();
  const originalSend = res.send;
  
  res.send = function(data) {
    const endTime = Date.now();
    const responseTime = endTime - startTime;
    
    // Log request details (sanitized)
    const logData = {
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id || 'anonymous',
      statusCode: res.statusCode,
      responseTime,
      timestamp: new Date().toISOString()
    };
    
    // Don't log sensitive data
    if (!req.path.includes('/balance') && !req.path.includes('/trades-history')) {
      logData.query = cryptoSecurity.sanitizeForLogging(req.query);
    }
    
    if (res.statusCode >= 400) {
      logger.warn('Crypto API error:', logData);
    } else {
      logger.info('Crypto API request:', logData);
    }
    
    originalSend.call(this, data);
  };
  
  next();
};

/**
 * Authentication middleware for private crypto endpoints
 */
const requireAuthForPrivate = (req, res, next) => {
  const isPrivateEndpoint = req.path.includes('/balance') || 
                           req.path.includes('/trades-history') ||
                           req.path.includes('/orders');
  
  if (isPrivateEndpoint) {
    return auth(req, res, next);
  }
  
  next();
};

/**
 * API key validation middleware
 */
const validateApiKeys = (req, res, next) => {
  const isPrivateEndpoint = req.path.includes('/balance') || 
                           req.path.includes('/trades-history') ||
                           req.path.includes('/orders');
  
  if (isPrivateEndpoint) {
    const config = require('../config');
    
    if (!config.KRAKEN_API_KEY || !config.KRAKEN_API_SECRET) {
      return res.status(503).json({
        error: 'Service unavailable',
        message: 'Private API endpoints are not configured'
      });
    }
  }
  
  next();
};

/**
 * Combined security middleware for public crypto endpoints
 */
const publicCryptoSecurity = [
  cryptoSecurityHeaders,
  cryptoAuditLog,
  detectSuspiciousActivity,
  publicCryptoRateLimit
];

/**
 * Combined security middleware for private crypto endpoints
 */
const privateCryptoSecurity = [
  cryptoSecurityHeaders,
  cryptoAuditLog,
  requireAuthForPrivate,
  validateApiKeys,
  detectSuspiciousActivity,
  privateCryptoRateLimit
];

module.exports = {
  publicCryptoSecurity,
  privateCryptoSecurity,
  cryptoSecurityHeaders,
  publicCryptoRateLimit,
  privateCryptoRateLimit,
  ipWhitelist,
  validateRequestSignature,
  detectSuspiciousActivity,
  cryptoAuditLog,
  requireAuthForPrivate,
  validateApiKeys
};