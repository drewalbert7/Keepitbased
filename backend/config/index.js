const path = require('path');
const fs = require('fs');

// Load environment variables with multiple fallback paths
function loadEnvironment() {
  const possibleEnvPaths = [
    path.join(__dirname, '../.env'),
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), 'backend/.env'),
    '/home/dstrad/keepitbased/backend/.env'
  ];

  for (const envPath of possibleEnvPaths) {
    if (fs.existsSync(envPath)) {
      require('dotenv').config({ path: envPath });
      console.log(`✅ Loaded environment from: ${envPath}`);
      break;
    }
  }
}

// Load environment
loadEnvironment();

// Configuration with robust defaults
const config = {
  // Server
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT) || 3001,
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',

  // Database - with fallback for development
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://dstrad:password@localhost:5432/keepitbased',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',

  // Python Service
  PYTHON_SERVICE_URL: process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:5001',

  // JWT - CRITICAL: Always have a fallback secret
  JWT_SECRET: process.env.JWT_SECRET || 'fallback-jwt-secret-change-in-production-' + Date.now(),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',

  // API Keys
  ALPHA_VANTAGE_API_KEY: process.env.ALPHA_VANTAGE_API_KEY || 'demo',
  POLYGON_API_KEY: process.env.POLYGON_API_KEY || '',
  COINAPI_KEY: process.env.COINAPI_KEY || '',
  
  // Kraken API (for crypto)
  KRAKEN_API_KEY: process.env.KRAKEN_API_KEY || '',
  KRAKEN_API_SECRET: process.env.KRAKEN_API_SECRET || '',

  // Email
  SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT: parseInt(process.env.SMTP_PORT) || 587,
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,

  // Features
  PRICE_CHECK_INTERVAL_MS: parseInt(process.env.PRICE_CHECK_INTERVAL_MS) || 60000,
  MAX_ALERTS_PER_USER: parseInt(process.env.MAX_ALERTS_PER_USER) || 50,

  // Development mode settings
  ENABLE_TEST_USER: process.env.NODE_ENV === 'development' || process.env.ENABLE_TEST_USER === 'true',
  GRACEFUL_DB_FAILURE: process.env.GRACEFUL_DB_FAILURE !== 'false',

  // HTTPS Configuration
  HTTPS_ENABLED: process.env.HTTPS_ENABLED === 'true',
  HTTPS_PORT: parseInt(process.env.HTTPS_PORT) || 3443,
  SSL_KEY_PATH: process.env.SSL_KEY_PATH || path.join(__dirname, '../ssl/server.key'),
  SSL_CERT_PATH: process.env.SSL_CERT_PATH || path.join(__dirname, '../ssl/server.crt')
};

// Validation function
function validateConfig() {
  const errors = [];
  const warnings = [];

  // Critical validations
  if (!config.JWT_SECRET || config.JWT_SECRET === 'your-super-secret-jwt-key-change-in-production') {
    warnings.push('⚠️  Using default JWT_SECRET - change this in production!');
  }

  if (config.DATABASE_URL === 'postgresql://dstrad:password@localhost:5432/keepitbased') {
    warnings.push('⚠️  Using default database credentials');
  }

  // Port validation
  if (isNaN(config.PORT) || config.PORT < 1 || config.PORT > 65535) {
    errors.push('❌ Invalid PORT number');
  }

  // Environment specific validations
  if (config.NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET) {
      errors.push('❌ JWT_SECRET must be set in production');
    }
    if (!process.env.DATABASE_URL) {
      warnings.push('⚠️  DATABASE_URL not explicitly set in production');
    }
    if (config.HTTPS_ENABLED && (!config.SSL_KEY_PATH || !config.SSL_CERT_PATH)) {
      warnings.push('⚠️  HTTPS enabled but SSL certificates not configured');
    }
  }

  // Log results
  if (warnings.length > 0) {
    console.log('\n🟡 Configuration Warnings:');
    warnings.forEach(warning => console.log(`   ${warning}`));
  }

  if (errors.length > 0) {
    console.log('\n🔴 Configuration Errors:');
    errors.forEach(error => console.log(`   ${error}`));
    return false;
  }

  console.log('\n✅ Configuration validated successfully');
  return true;
}

// Export config and validation
module.exports = {
  ...config,
  validate: validateConfig,
  
  // Helper functions
  isDevelopment: () => config.NODE_ENV === 'development',
  isProduction: () => config.NODE_ENV === 'production',
  
  // Database helpers
  getDatabaseConfig: () => ({
    connectionString: config.DATABASE_URL,
    ssl: config.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  })
};