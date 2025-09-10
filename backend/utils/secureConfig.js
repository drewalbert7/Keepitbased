const fs = require('fs');
const path = require('path');
const cryptoSecurity = require('./cryptoSecurity');
const logger = require('./logger');

class SecureConfigManager {
  constructor() {
    this.encryptedConfigPath = path.join(__dirname, '../config/encrypted.json');
    this.configCache = new Map();
    this.cacheTimeout = 300000; // 5 minutes
    
    // Initialize encrypted config file if it doesn't exist
    this.initializeEncryptedConfig();
  }

  /**
   * Initialize encrypted configuration file
   */
  initializeEncryptedConfig() {
    if (!fs.existsSync(this.encryptedConfigPath)) {
      const initialConfig = {
        version: '1.0',
        created: new Date().toISOString(),
        encrypted_keys: {},
        metadata: {
          lastUpdated: new Date().toISOString(),
          keyCount: 0
        }
      };
      
      try {
        fs.writeFileSync(
          this.encryptedConfigPath, 
          JSON.stringify(initialConfig, null, 2),
          { mode: 0o600 } // Read/write for owner only
        );
        logger.info('Initialized encrypted configuration file');
      } catch (error) {
        logger.error('Failed to initialize encrypted config:', error.message);
      }
    }
  }

  /**
   * Encrypt and store API keys securely
   */
  storeApiKeys(keys) {
    try {
      const config = this.loadEncryptedConfig();
      
      for (const [keyName, keyValue] of Object.entries(keys)) {
        if (keyValue && keyValue.length > 0) {
          // Encrypt the API key
          const encrypted = cryptoSecurity.encrypt(keyValue);
          config.encrypted_keys[keyName] = {
            encrypted: encrypted,
            created: new Date().toISOString(),
            lastUsed: null,
            usageCount: 0
          };
          
          logger.info(`Stored encrypted API key: ${keyName}`);
        }
      }
      
      config.metadata.lastUpdated = new Date().toISOString();
      config.metadata.keyCount = Object.keys(config.encrypted_keys).length;
      
      this.saveEncryptedConfig(config);
      this.invalidateCache();
      
      return true;
    } catch (error) {
      logger.error('Failed to store API keys:', error.message);
      return false;
    }
  }

  /**
   * Retrieve and decrypt API keys
   */
  getApiKey(keyName) {
    const cacheKey = `apikey_${keyName}`;
    
    // Check cache first
    if (this.configCache.has(cacheKey)) {
      const cached = this.configCache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.value;
      }
    }
    
    try {
      const config = this.loadEncryptedConfig();
      const keyData = config.encrypted_keys[keyName];
      
      if (!keyData) {
        return null;
      }
      
      // Decrypt the key
      const decrypted = cryptoSecurity.decrypt(keyData.encrypted);
      
      // Update usage statistics
      keyData.lastUsed = new Date().toISOString();
      keyData.usageCount = (keyData.usageCount || 0) + 1;
      this.saveEncryptedConfig(config);
      
      // Cache the decrypted key
      this.configCache.set(cacheKey, {
        value: decrypted,
        timestamp: Date.now()
      });
      
      return decrypted;
    } catch (error) {
      logger.error(`Failed to retrieve API key ${keyName}:`, error.message);
      return null;
    }
  }

  /**
   * Load encrypted configuration
   */
  loadEncryptedConfig() {
    try {
      if (!fs.existsSync(this.encryptedConfigPath)) {
        this.initializeEncryptedConfig();
      }
      
      const data = fs.readFileSync(this.encryptedConfigPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      logger.error('Failed to load encrypted config:', error.message);
      return {
        version: '1.0',
        created: new Date().toISOString(),
        encrypted_keys: {},
        metadata: { lastUpdated: new Date().toISOString(), keyCount: 0 }
      };
    }
  }

  /**
   * Save encrypted configuration
   */
  saveEncryptedConfig(config) {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.encryptedConfigPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      
      fs.writeFileSync(
        this.encryptedConfigPath,
        JSON.stringify(config, null, 2),
        { mode: 0o600 }
      );
    } catch (error) {
      logger.error('Failed to save encrypted config:', error.message);
      throw error;
    }
  }

  /**
   * Invalidate configuration cache
   */
  invalidateCache() {
    this.configCache.clear();
  }

  /**
   * Rotate API keys (for security)
   */
  rotateApiKeys(newKeys) {
    try {
      const config = this.loadEncryptedConfig();
      
      // Archive old keys
      config.archived_keys = config.archived_keys || {};
      const timestamp = new Date().toISOString();
      
      for (const [keyName, keyData] of Object.entries(config.encrypted_keys)) {
        const archiveKey = `${keyName}_${timestamp}`;
        config.archived_keys[archiveKey] = {
          ...keyData,
          archivedAt: timestamp
        };
      }
      
      // Clear current keys
      config.encrypted_keys = {};
      
      // Store new keys
      for (const [keyName, keyValue] of Object.entries(newKeys)) {
        if (keyValue && keyValue.length > 0) {
          const encrypted = cryptoSecurity.encrypt(keyValue);
          config.encrypted_keys[keyName] = {
            encrypted: encrypted,
            created: timestamp,
            lastUsed: null,
            usageCount: 0
          };
        }
      }
      
      config.metadata.lastRotation = timestamp;
      config.metadata.lastUpdated = timestamp;
      config.metadata.keyCount = Object.keys(config.encrypted_keys).length;
      
      this.saveEncryptedConfig(config);
      this.invalidateCache();
      
      logger.info('API keys rotated successfully');
      return true;
    } catch (error) {
      logger.error('Failed to rotate API keys:', error.message);
      return false;
    }
  }

  /**
   * Get API key statistics (without exposing keys)
   */
  getKeyStatistics() {
    try {
      const config = this.loadEncryptedConfig();
      const stats = {};
      
      for (const [keyName, keyData] of Object.entries(config.encrypted_keys)) {
        stats[keyName] = {
          created: keyData.created,
          lastUsed: keyData.lastUsed,
          usageCount: keyData.usageCount || 0,
          hasKey: true
        };
      }
      
      return {
        totalKeys: Object.keys(config.encrypted_keys).length,
        lastUpdated: config.metadata.lastUpdated,
        keys: stats
      };
    } catch (error) {
      logger.error('Failed to get key statistics:', error.message);
      return null;
    }
  }

  /**
   * Validate configuration integrity
   */
  validateConfigIntegrity() {
    try {
      const config = this.loadEncryptedConfig();
      
      // Check if config is properly formatted
      if (!config.version || !config.encrypted_keys || !config.metadata) {
        return { valid: false, error: 'Invalid config structure' };
      }
      
      // Try to decrypt one key to verify encryption is working
      const keyNames = Object.keys(config.encrypted_keys);
      if (keyNames.length > 0) {
        const testKey = keyNames[0];
        try {
          cryptoSecurity.decrypt(config.encrypted_keys[testKey].encrypted);
        } catch (error) {
          return { valid: false, error: 'Decryption test failed' };
        }
      }
      
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Export configuration for backup (keys remain encrypted)
   */
  exportEncryptedBackup() {
    try {
      const config = this.loadEncryptedConfig();
      const backup = {
        ...config,
        exportedAt: new Date().toISOString(),
        exportedBy: 'SecureConfigManager'
      };
      
      return JSON.stringify(backup, null, 2);
    } catch (error) {
      logger.error('Failed to export backup:', error.message);
      return null;
    }
  }
}

module.exports = new SecureConfigManager();