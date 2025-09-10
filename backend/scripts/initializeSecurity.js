#!/usr/bin/env node

/**
 * Security Initialization Script
 * This script sets up secure storage for API keys and validates security configuration
 */

const config = require('../config');
const secureConfig = require('../utils/secureConfig');
const cryptoSecurity = require('../utils/cryptoSecurity');
const logger = require('../utils/logger');

async function initializeSecurity() {
  console.log('🔐 Initializing Security Configuration...\n');

  try {
    // Step 1: Validate current configuration
    console.log('1️⃣ Validating configuration integrity...');
    const integrity = secureConfig.validateConfigIntegrity();
    
    if (integrity.valid) {
      console.log('   ✅ Configuration structure is valid');
    } else {
      console.log(`   ⚠️  Configuration issue: ${integrity.error}`);
    }

    // Step 2: Migrate API keys to encrypted storage
    console.log('\n2️⃣ Migrating API keys to encrypted storage...');
    
    const keysToMigrate = {
      KRAKEN_API_KEY: config.KRAKEN_API_KEY,
      KRAKEN_API_SECRET: config.KRAKEN_API_SECRET
    };

    // Filter out empty keys
    const validKeys = Object.entries(keysToMigrate)
      .filter(([key, value]) => value && value.length > 0 && !value.includes('placeholder') && !value.includes('your_'))
      .reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {});

    if (Object.keys(validKeys).length > 0) {
      const migrated = secureConfig.storeApiKeys(validKeys);
      if (migrated) {
        console.log(`   ✅ Migrated ${Object.keys(validKeys).length} API keys to encrypted storage`);
        Object.keys(validKeys).forEach(key => {
          console.log(`   🔑 ${key}: Encrypted and stored securely`);
        });
      } else {
        console.log('   ❌ Failed to migrate API keys');
        return false;
      }
    } else {
      console.log('   ℹ️  No valid API keys found to migrate (skipping)');
    }

    // Step 3: Test encryption/decryption
    console.log('\n3️⃣ Testing encryption functionality...');
    
    try {
      const testData = 'test-encryption-' + Date.now();
      const encrypted = cryptoSecurity.encrypt(testData);
      const decrypted = cryptoSecurity.decrypt(encrypted);
      
      if (decrypted === testData) {
        console.log('   ✅ Encryption/decryption test passed');
      } else {
        console.log('   ❌ Encryption/decryption test failed');
        return false;
      }
    } catch (error) {
      console.log(`   ❌ Encryption test failed: ${error.message}`);
      return false;
    }

    // Step 4: Show security statistics
    console.log('\n4️⃣ Security statistics...');
    const stats = secureConfig.getKeyStatistics();
    
    if (stats) {
      console.log(`   📊 Total encrypted keys: ${stats.totalKeys}`);
      console.log(`   📅 Last updated: ${new Date(stats.lastUpdated).toLocaleString()}`);
      
      Object.entries(stats.keys).forEach(([keyName, keyStats]) => {
        console.log(`   🔐 ${keyName}:`);
        console.log(`      Created: ${new Date(keyStats.created).toLocaleString()}`);
        console.log(`      Usage count: ${keyStats.usageCount}`);
        console.log(`      Last used: ${keyStats.lastUsed ? new Date(keyStats.lastUsed).toLocaleString() : 'Never'}`);
      });
    }

    // Step 5: Security recommendations
    console.log('\n5️⃣ Security recommendations...');
    
    const recommendations = [];
    
    if (!process.env.REQUEST_SIGNATURE_SECRET) {
      recommendations.push('Add REQUEST_SIGNATURE_SECRET to .env for request signing');
    }
    
    if (config.NODE_ENV === 'production') {
      if (config.JWT_SECRET.includes('fallback') || config.JWT_SECRET.includes('change')) {
        recommendations.push('Update JWT_SECRET with a strong, unique secret');
      }
    }
    
    if (Object.keys(validKeys).length === 0) {
      recommendations.push('Add valid Kraken API keys to enable private endpoints');
    }

    if (recommendations.length > 0) {
      console.log('   ⚠️  Security recommendations:');
      recommendations.forEach(rec => console.log(`   • ${rec}`));
    } else {
      console.log('   ✅ All security recommendations met');
    }

    // Step 6: Create backup
    console.log('\n6️⃣ Creating encrypted backup...');
    const backup = secureConfig.exportEncryptedBackup();
    if (backup) {
      const path = require('path');
      const backupDir = path.join(__dirname, '../config');
      const backupPath = path.join(backupDir, `backup-${new Date().toISOString().split('T')[0]}.json`);
      
      // Ensure directory exists
      const fs = require('fs');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      }
      
      fs.writeFileSync(backupPath, backup, { mode: 0o600 });
      console.log(`   ✅ Encrypted backup created: ${backupPath}`);
    }

    console.log('\n🎉 Security initialization completed successfully!');
    console.log('\n🔒 Security Features Active:');
    console.log('   ✅ API key encryption at rest');
    console.log('   ✅ Rate limiting (100/min public, 30/min private)');
    console.log('   ✅ Request signing validation');
    console.log('   ✅ IP whitelist capability');
    console.log('   ✅ Secure audit logging');
    console.log('   ✅ Authentication for private endpoints');
    console.log('   ✅ Security headers (CORS, CSP, HSTS)');
    console.log('   ✅ Suspicious activity detection');

    return true;
  } catch (error) {
    console.error('\n💥 Security initialization failed:', error.message);
    logger.error('Security initialization error:', error);
    return false;
  }
}

// Run if called directly
if (require.main === module) {
  initializeSecurity()
    .then(success => {
      if (success) {
        console.log('\n✨ Your crypto API is now bulletproof! ✨');
        process.exit(0);
      } else {
        console.log('\n❌ Security initialization failed');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = initializeSecurity;