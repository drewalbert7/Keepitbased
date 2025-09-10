const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Sanitize input to prevent XSS and injection attacks
 */
const sanitizeInput = (req, res, next) => {
  try {
    // Sanitize body inputs
    if (req.body) {
      Object.keys(req.body).forEach(key => {
        if (typeof req.body[key] === 'string') {
          // Remove potential XSS characters
          req.body[key] = req.body[key]
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/javascript:/gi, '')
            .replace(/on\w+\s*=/gi, '');
          
          // Trim whitespace
          req.body[key] = req.body[key].trim();
        }
      });
    }
    
    // Sanitize query parameters
    if (req.query) {
      Object.keys(req.query).forEach(key => {
        if (typeof req.query[key] === 'string') {
          req.query[key] = req.query[key].trim();
        }
      });
    }
    
    next();
  } catch (error) {
    logger.error('Input sanitization error:', error);
    res.status(400).json({ message: 'Invalid input format' });
  }
};

/**
 * Validate email format
 */
const validateEmail = body('email')
  .isEmail()
  .withMessage('Valid email is required')
  .normalizeEmail();

/**
 * Validate password strength
 */
const validatePassword = body('password')
  .isLength({ min: 8 })
  .withMessage('Password must be at least 8 characters')
  .matches(/[a-z]/)
  .withMessage('Password must contain at least one lowercase letter')
  .matches(/[A-Z]/)
  .withMessage('Password must contain at least one uppercase letter')
  .matches(/[0-9]/)
  .withMessage('Password must contain at least one number')
  .matches(/[^a-zA-Z0-9]/)
  .withMessage('Password must contain at least one special character');

/**
 * Validate username format
 */
const validateUsername = body('username')
  .isLength({ min: 3, max: 30 })
  .withMessage('Username must be between 3 and 30 characters')
  .matches(/^[a-zA-Z0-9_]+$/)
  .withMessage('Username can only contain letters, numbers, and underscores');

/**
 * Validate stock/crypto symbol format
 */
const validateSymbol = body('symbol')
  .isLength({ min: 1, max: 20 })
  .withMessage('Symbol must be between 1 and 20 characters')
  .matches(/^[A-Za-z0-9\-._]+$/)
  .withMessage('Symbol contains invalid characters');

/**
 * Validate numeric values
 */
const validateNumber = (field, min = 0, max = undefined) => 
  body(field)
    .isFloat({ min })
    .withMessage(`${field} must be a valid number`)
    .custom((value) => {
      if (max !== undefined && parseFloat(value) > max) {
        throw new Error(`${field} cannot exceed ${max}`);
      }
      return true;
    });

/**
 * Validate threshold percentages
 */
const validateThreshold = body('threshold')
  .isFloat({ min: 0.1, max: 50 })
  .withMessage('Threshold must be between 0.1% and 50%');

/**
 * Validate price values
 */
const validatePrice = body('price')
  .isFloat({ min: 0 })
  .withMessage('Price must be a positive number');

/**
 * Middleware to handle validation errors
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation failed:', { errors: errors.array() });
    
    const formattedErrors = errors.array().map(error => ({
      field: error.path,
      message: error.msg
    }));
    
    return res.status(400).json({
      error: 'Validation failed',
      message: 'Please check your input and try again.',
      errors: formattedErrors
    });
  }
  next();
};

/**
 * Validate UUID format
 */
const validateUUID = (param) => 
  body(param)
    .isUUID()
    .withMessage(`${param} must be a valid UUID`);

/**
 * Validate pagination parameters
 */
const validatePagination = (req, res, next) => {
  const { page = 1, limit = 10 } = req.query;
  
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  
  if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
    return res.status(400).json({
      error: 'Invalid pagination parameters',
      message: 'Page must be >= 1, limit must be between 1 and 100'
    });
  }
  
  req.query.page = pageNum;
  req.query.limit = limitNum;
  next();
};

/**
 * Secure file upload validation
 */
const validateFileUpload = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }
  
  // Check file type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
  if (!allowedTypes.includes(req.file.mimetype)) {
    return res.status(400).json({ message: 'Invalid file type. Only JPEG, PNG, and GIF are allowed.' });
  }
  
  // Check file size (max 5MB)
  if (req.file.size > 5 * 1024 * 1024) {
    return res.status(400).json({ message: 'File too large. Maximum size is 5MB.' });
  }
  
  next();
};

/**
 * SQL injection detection middleware
 */
const detectSQLInjection = (req, res, next) => {
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|EXEC|EXECUTE|DECLARE|CREATE|ALTER|TRUNCATE)\b)/gi,
    /('|--|\/\*|\*\/|;|\||\x00)/gi,
    /(\bOR\b\s+\d+\s*=\s*\d+)/gi,
    /(\bAND\b\s+\d+\s*=\s*\d+)/gi
  ];
  
  const checkString = (str) => {
    if (typeof str !== 'string') return false;
    return sqlPatterns.some(pattern => pattern.test(str));
  };
  
  // Check request body
  if (req.body && Object.values(req.body).some(checkString)) {
    logger.warn('Potential SQL injection attempt detected in body');
    return res.status(400).json({ message: 'Invalid input format' });
  }
  
  // Check query parameters
  if (req.query && Object.values(req.query).some(checkString)) {
    logger.warn('Potential SQL injection attempt detected in query');
    return res.status(400).json({ message: 'Invalid input format' });
  }
  
  next();
};

module.exports = {
  sanitizeInput,
  validateEmail,
  validatePassword,
  validateUsername,
  validateSymbol,
  validateNumber,
  validateThreshold,
  validatePrice,
  validateUUID,
  validatePagination,
  validateFileUpload,
  detectSQLInjection,
  handleValidationErrors
};