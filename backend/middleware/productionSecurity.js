/**
 * Production Security Middleware
 * 
 * This middleware adds security headers and protections for production environments.
 * Only enabled when NODE_ENV=production.
 */

const helmet = require('helmet');
const logger = require('../utils/logger');

/**
 * Security headers configuration for production
 */
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      frameSrc: ["'none'"],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
      mediaSrc: ["'self'"],
      childSrc: ["'self'"],
      requireTrustedTypesFor: "'script'",
      trustedTypes: "'self'"
    }
  },
  hsts: {
    maxAge: 63072000, // 2 years
    includeSubDomains: true,
    preload: true,
    forceLoad: true
  },
  frameguard: {
    action: 'deny'
  },
  xssFilter: true,
  noSniff: true,
  ieNoOpen: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: { policy: 'credentialless' },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-site' }
});

/**
 * CORS configuration for production
 */
const corsConfig = {
  origin: process.env.FRONTEND_URL || 'https://keepitbased.com',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Cache-Control'
  ],
  credentials: true,
  maxAge: 86400, // 24 hours
  preflightContinue: false,
  optionsSuccessStatus: 204
};

/**
 * Rate limiting configuration for production
 */
const rateLimitConfig = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests',
    message: 'Rate limit exceeded. Please try again later.'
  }
};

/**
 * Security middleware that checks if environment is production
 */
const checkProduction = (req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    logger.warn('Production security middleware skipped in non-production environment');
    return next();
  }
  next();
};

/**
 * HTTPS enforcement middleware
 */
const enforceHttps = (req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.protocol !== 'https') {
    return res.status(403).json({
      error: 'HTTPS required',
      message: 'This application requires HTTPS in production'
    });
  }
  next();
};

/**
 * Security audit logging middleware
 */
const securityAudit = (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    const securityEvent = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      headers: {
        'x-forwarded-for': req.get('x-forwarded-for'),
        'x-real-ip': req.get('x-real-ip'),
        'host': req.get('host'),
        'connection': req.get('connection')
      }
    };
    
    // Log suspicious requests
    if (isSuspiciousRequest(req)) {
      logger.warn('Suspicious request detected:', securityEvent);
    }
    
    // Log security events
    logger.info('Security event:', securityEvent);
  }
  next();
};

/**
 * Check if request appears suspicious
 */
function isSuspiciousRequest(req) {
  const suspiciousPatterns = [
    /<script/i,
    /javascript:/i,
    /union.*select/i,
    /drop.*table/i,
    /exec\s*\(/i,
    /<iframe/i,
    /on\w+\s*=/i
  ];
  
  const checkString = (str) => {
    if (!str) return false;
    return suspiciousPatterns.some(pattern => pattern.test(str));
  };
  
  // Check request body
  if (req.body && Object.values(req.body).some(checkString)) {
    return true;
  }
  
  // Check query parameters
  if (req.query && Object.values(req.query).some(checkString)) {
    return true;
  }
  
  // Check headers
  if (req.headers && Object.values(req.headers).some(checkString)) {
    return true;
  }
  
  return false;
}

/**
 * Request size limiting middleware
 */
const limitRequestSize = (req, res, next) => {
  const maxSize = process.env.MAX_REQUEST_SIZE || '10mb';
  const bytes = parseSize(maxSize);
  
  // Express body parser automatically handles this, but we add additional logging
  if (req.headers['content-length'] && parseInt(req.headers['content-length']) > bytes) {
    logger.warn('Request size limit exceeded', {
      ip: req.ip,
      method: req.method,
      url: req.url,
      contentLength: req.headers['content-length'],
      maxSize: maxSize
    });
    return res.status(413).json({
      error: 'Request too large',
      message: 'Request size exceeds maximum allowed size'
    });
  }
  
  next();
};

/**
 * Parse size string to bytes
 */
function parseSize(size) {
  const units = {
    'b': 1,
    'kb': 1024,
    'mb': 1024 * 1024,
    'gb': 1024 * 1024 * 1024
  };
  
  const match = size.toLowerCase().match(/^(\d+)(b|kb|mb|gb)$/i);
  if (!match) return 10 * 1024 * 1024; // Default 10MB
  
  return parseInt(match[1]) * units[match[2].toLowerCase()];
}

/**
 * Security error handling middleware
 */
const securityErrorHandler = (err, req, res, next) => {
  if (err && err.name === 'HstsError') {
    logger.error('HSTS error:', err);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Security configuration error'
    });
  }
  
  if (err && err.name === 'JsonPayloadTooLargeError') {
    logger.warn('JSON payload too large', {
      ip: req.ip,
      method: req.method,
      url: req.url
    });
    return res.status(413).json({
      error: 'Payload too large',
      message: 'Request body exceeds size limit'
    });
  }
  
  next(err);
};

/**
 * Production security middleware stack
 */
const productionSecurityStack = [
  checkProduction,
  enforceHttps,
  securityHeaders,
  securityAudit,
  limitRequestSize,
  securityErrorHandler
];

module.exports = {
  securityHeaders,
  corsConfig,
  rateLimitConfig,
  productionSecurityStack,
  checkProduction,
  enforceHttps,
  securityAudit,
  limitRequestSize,
  securityErrorHandler
};