#!/usr/bin/env node

/**
 * Security Script to rotate API keys and generate secure credentials
 * 
 * Usage:
 * node scripts/rotateApiKeys.js
 * 
 * This script will:
 * 1. Generate new secure JWT secret
 * 2. Generate new session secret
 * 3. Create backup of current .env file
 * 4. Generate new .env file with rotated credentials
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

function generateSecureSecret(length = 64) {
  return crypto.randomBytes(length).toString('hex');
}

function backupEnvFile() {
  const envPath = path.join(__dirname, '../.env');
  const backupPath = path.join(__dirname, '../.env.backup.' + Date.now());
  
  if (fs.existsSync(envPath)) {
    fs.copyFileSync(envPath, backupPath);
    logger.info(`✅ Created backup: ${backupPath}`);
    return backupPath;
  }
  
  logger.warn('⚠️  No .env file found to backup');
  return null;
}

function generateNewEnvFile() {
  const envPath = path.join(__dirname, '../.env');
  const examplePath = path.join(__dirname, '../.env.example');
  
  // Read example file
  let exampleContent = '';
  if (fs.existsSync(examplePath)) {
    exampleContent = fs.readFileSync(examplePath, 'utf8');
  }
  
  // Generate secure secrets
  const newJwtSecret = generateSecureSecret(32);
  const newSessionSecret = generateSecureSecret(32);
  
  // Replace placeholder secrets with generated ones
  const newEnvContent = exampleContent
    .replace(/JWT_SECRET=.*/, `JWT_SECRET=${newJwtSecret}`)
    .replace(/SESSION_SECRET=.*/, `SESSION_SECRET=${newSessionSecret}`)
    .replace(/your-super-secure-jwt-secret-here-minimum-32-characters/, newJwtSecret);
  
  // Write new .env file
  fs.writeFileSync(envPath, newEnvContent);
  logger.info('✅ Generated new .env file with secure credentials');
  
  return {
    jwtSecret: newJwtSecret,
    sessionSecret: newSessionSecret,
    envPath
  };
}

function updateConfigWithNewSecrets(secrets) {
  const configPath = path.join(__dirname, '../config/index.js');
  
  try {
    const configContent = fs.readFileSync(configPath, 'utf8');
    
    // Update the fallback JWT secret generation
    const updatedContent = configContent.replace(
      /fallback-jwt-secret-change-in-production-\+Date.now\(\)/,
      `secure-fallback-${secrets.jwtSecret.substring(0, 16)}-${Date.now()}`
    );
    
    fs.writeFileSync(configPath, updatedContent);
    logger.info('✅ Updated config with new JWT secret pattern');
    
  } catch (error) {
    logger.warn('⚠️  Could not update config file:', error.message);
  }
}

function displaySecurityRecommendations() {
  console.log('\n🔒 SECURITY RECOMMENDATIONS:\n');
  console.log('1. IMMEDIATE ACTIONS:');
  console.log('   • Copy the new credentials from .env to your production environment');
  console.log('   • Rotate any exposed API keys (especially Kraken keys)');
  console.log('   • Update database credentials if they were hardcoded');
  console.log('   • Restart your application to load new environment variables');
  
  console.log('\n2. PRODUCTION SECURITY:');
  console.log('   • Use HTTPS for all API endpoints');
  console.log('   • Enable security headers (Helmet.js)');
  console.log('   • Implement proper CORS configuration');
  console.log('   • Use environment-specific configurations');
  console.log('   • Set up monitoring for failed login attempts');
  
  console.log('\n3. API KEY MANAGEMENT:');
  console.log('   • Use environment variables for all API keys');
  console.log('   • Regularly rotate API keys every 3-6 months');
  console.log('   • Monitor API usage for unusual activity');
  console.log('   • Use different keys for development and production');
  
  console.log('\n4. DATABASE SECURITY:');
  console.log('   • Use database-specific users with limited permissions');
  console.log('   • Enable SSL for database connections');
  console.log('   • Regularly audit database access logs');
  console.log('   • Keep database software updated');
  
  console.log('\n5. BACKUP MANAGEMENT:');
  console.log('   • Store .env backups securely');
  console.log('   • Use version control for configuration templates (not secrets)');
  console.log('   • Document credential rotation procedures');
  console.log('   • Test restoration procedures regularly');
}

async function main() {
  console.log('🔐 Starting API Key and Credential Rotation...\n');
  
  try {
    // Backup current .env file
    const backupPath = backupEnvFile();
    
    // Generate new environment file with secure credentials
    const secrets = generateNewEnvFile();
    
    // Update configuration to use new secret pattern
    updateConfigWithNewSecrets(secrets);
    
    // Display security recommendations
    displaySecurityRecommendations();
    
    console.log('\n✅ Rotation completed successfully!');
    console.log('📋 New credentials generated in: .env');
    if (backupPath) {
      console.log(`💾 Backup saved to: ${backupPath}`);
    }
    
  } catch (error) {
    logger.error('❌ Rotation failed:', error);
    console.error('❌ Rotation failed. Please check the error above and try again.');
    process.exit(1);
  }
}

// Run if this script is executed directly
if (require.main === module) {
  main();
}

module.exports = {
  generateSecureSecret,
  backupEnvFile,
  generateNewEnvFile,
  updateConfigWithNewSecrets
};