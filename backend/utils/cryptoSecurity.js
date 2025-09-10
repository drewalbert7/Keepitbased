const crypto = require('crypto');
const logger = require('./logger');

class CryptoSecurity {
  constructor() {
    // Define parameters first
    this.keyLength = 32;
    this.ivLength = 16;
    this.tagLength = 16;
    this.algorithm = 'aes-256-gcm';
    
    // Use environment-specific encryption key
    this.encryptionKey = this.deriveEncryptionKey();
    
    // Security settings
    this.maxRequestsPerMinute = 100;
    this.maxPrivateRequestsPerMinute = 30;
    this.requestCache = new Map();
    this.rateLimitCache = new Map();
  }

  /**
   * Derive encryption key from environment and system info
   * This ensures keys are encrypted differently per environment
   */
  deriveEncryptionKey() {
    const baseKey = process.env.JWT_SECRET || 'fallback-secret-key';
    const systemSalt = process.env.NODE_ENV + process.env.DATABASE_URL;
    
    return crypto.pbkdf2Sync(baseKey, systemSalt || 'default-salt', 100000, this.keyLength, 'sha256');
  }

  /**
   * Encrypt sensitive data (API keys, secrets)
   */
  encrypt(text) {
    if (!text || typeof text !== 'string') {
      throw new Error('Invalid input for encryption');
    }

    try {
      const iv = crypto.randomBytes(this.ivLength);
      const cipher = crypto.createCipher('aes-256-cbc', this.encryptionKey);
      
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Return iv:encrypted format (no auth tag for CBC)
      return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
      logger.error('Encryption failed:', error.message);
      throw new Error('Encryption failed');
    }
  }

  /**
   * Decrypt sensitive data
   */
  decrypt(encryptedText) {
    if (!encryptedText || typeof encryptedText !== 'string') {
      throw new Error('Invalid input for decryption');
    }

    try {
      const parts = encryptedText.split(':');
      if (parts.length !== 2) {
        throw new Error('Invalid encrypted format');
      }

      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];

      const decipher = crypto.createDecipher('aes-256-cbc', this.encryptionKey);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      logger.error('Decryption failed:', error.message);
      throw new Error('Decryption failed');
    }
  }

  /**
   * Securely hash API requests to prevent replay attacks
   */
  hashRequest(method, path, body, timestamp) {
    const payload = `${method}:${path}:${JSON.stringify(body)}:${timestamp}`;
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Validate request signature to prevent tampering
   */
  validateRequestSignature(req, signature, secret) {
    const expectedSignature = this.createRequestSignature(req, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }

  /**
   * Create request signature
   */
  createRequestSignature(req, secret) {
    const timestamp = req.headers['x-timestamp'] || Date.now();
    const payload = `${req.method}:${req.path}:${JSON.stringify(req.body)}:${timestamp}`;
    
    return crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  }

  /**
   * Rate limiting implementation
   */
  checkRateLimit(identifier, isPrivate = false) {
    const limit = isPrivate ? this.maxPrivateRequestsPerMinute : this.maxRequestsPerMinute;
    const windowMs = 60 * 1000; // 1 minute
    const now = Date.now();
    
    if (!this.rateLimitCache.has(identifier)) {
      this.rateLimitCache.set(identifier, []);
    }
    
    const requests = this.rateLimitCache.get(identifier);
    
    // Remove old requests outside the window
    const validRequests = requests.filter(time => now - time < windowMs);
    
    if (validRequests.length >= limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetTime: new Date(validRequests[0] + windowMs)
      };
    }
    
    // Add current request
    validRequests.push(now);
    this.rateLimitCache.set(identifier, validRequests);
    
    return {
      allowed: true,
      limit,
      remaining: limit - validRequests.length,
      resetTime: new Date(now + windowMs)
    };
  }

  /**
   * Sanitize logs to remove sensitive data
   */
  sanitizeForLogging(obj) {
    const sensitiveKeys = [
      'password', 'secret', 'key', 'token', 'auth', 'api_key', 'api_secret',
      'private_key', 'signature', 'nonce', 'authorization'
    ];
    
    const sanitized = { ...obj };
    
    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        sanitized[key] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }

  /**
   * Generate secure random API key identifier
   */
  generateApiKeyId() {
    return 'kib_' + crypto.randomBytes(16).toString('hex');
  }

  /**
   * Validate IP address against whitelist
   */
  validateIPWhitelist(clientIP, whitelist = []) {
    if (!whitelist.length) return true; // No whitelist = allow all
    
    // Support for IP ranges and specific IPs
    return whitelist.some(allowedIP => {
      if (allowedIP.includes('/')) {
        // CIDR notation support would go here
        return false; // Simplified for now
      }
      return clientIP === allowedIP;
    });
  }

  /**
   * Create audit log entry
   */
  createAuditLog(action, userId, details = {}) {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      action,
      userId,
      details: this.sanitizeForLogging(details),
      ip: details.ip || 'unknown',
      userAgent: details.userAgent || 'unknown'
    };
    
    logger.info('Security audit:', auditEntry);
    return auditEntry;
  }

  /**
   * Validate Kraken API signature format
   */
  validateKrakenSignature(path, postData, signature, secret) {
    try {
      const message = postData + crypto.createHash('sha256').update(postData).digest();
      const hmac = crypto.createHmac('sha512', Buffer.from(secret, 'base64'));
      const expectedSignature = hmac.update(path + message).digest('base64');
      
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'base64'),
        Buffer.from(expectedSignature, 'base64')
      );
    } catch (error) {
      logger.error('Kraken signature validation failed:', error.message);
      return false;
    }
  }

  /**
   * Check for suspicious activity patterns
   */
  detectSuspiciousActivity(identifier, action) {
    const suspiciousPatterns = {
      rapidRequests: { threshold: 50, window: 10000 }, // 50 requests in 10 seconds
      failedAttempts: { threshold: 10, window: 300000 }, // 10 failures in 5 minutes
    };
    
    const key = `${identifier}:${action}`;
    if (!this.requestCache.has(key)) {
      this.requestCache.set(key, []);
    }
    
    const activities = this.requestCache.get(key);
    const now = Date.now();
    
    // Clean old activities
    const recentActivities = activities.filter(
      time => now - time < suspiciousPatterns[action]?.window || 60000
    );
    
    recentActivities.push(now);
    this.requestCache.set(key, recentActivities);
    
    const pattern = suspiciousPatterns[action];
    if (pattern && recentActivities.length > pattern.threshold) {
      this.createAuditLog('suspicious_activity_detected', identifier, {
        action,
        count: recentActivities.length,
        threshold: pattern.threshold
      });
      return true;
    }
    
    return false;
  }

  /**
   * Clean up expired cache entries
   */
  cleanupCache() {
    const now = Date.now();
    const maxAge = 3600000; // 1 hour
    
    for (const [key, value] of this.rateLimitCache.entries()) {
      if (Array.isArray(value)) {
        const validEntries = value.filter(time => now - time < maxAge);
        if (validEntries.length === 0) {
          this.rateLimitCache.delete(key);
        } else {
          this.rateLimitCache.set(key, validEntries);
        }
      }
    }
    
    for (const [key, value] of this.requestCache.entries()) {
      if (Array.isArray(value)) {
        const validEntries = value.filter(time => now - time < maxAge);
        if (validEntries.length === 0) {
          this.requestCache.delete(key);
        } else {
          this.requestCache.set(key, validEntries);
        }
      }
    }
  }
}

// Singleton instance
const cryptoSecurity = new CryptoSecurity();

// Cleanup cache every 5 minutes
setInterval(() => {
  cryptoSecurity.cleanupCache();
}, 5 * 60 * 1000);

module.exports = cryptoSecurity;