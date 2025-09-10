const { Pool } = require('pg');
const logger = require('../utils/logger');
const config = require('../config');

const pool = new Pool(config.getDatabaseConfig());

// Test connection
pool.connect((err, client, release) => {
  if (err) {
    logger.error('Error connecting to PostgreSQL:', err);
  } else {
    logger.info('Connected to PostgreSQL database');
    release();
  }
});

// Initialize database tables
async function initializeDatabase() {
  const client = await pool.connect();
  
  try {
    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        notification_preferences JSONB DEFAULT '{"email": true, "push": true}',
        verified BOOLEAN DEFAULT false,
        reset_token VARCHAR(500),
        reset_token_expires TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // User alerts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_alerts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        symbol VARCHAR(20) NOT NULL,
        asset_type VARCHAR(10) NOT NULL CHECK (asset_type IN ('crypto', 'stock')),
        small_threshold DECIMAL(5,2) DEFAULT 5.00,
        medium_threshold DECIMAL(5,2) DEFAULT 10.00,
        large_threshold DECIMAL(5,2) DEFAULT 15.00,
        baseline_price DECIMAL(15,8),
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, symbol, asset_type)
      )
    `);

    // Alert history table
    await client.query(`
      CREATE TABLE IF NOT EXISTS alert_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        symbol VARCHAR(20) NOT NULL,
        asset_type VARCHAR(10) NOT NULL,
        alert_level VARCHAR(10) NOT NULL,
        current_price DECIMAL(15,8) NOT NULL,
        baseline_price DECIMAL(15,8) NOT NULL,
        drop_percentage DECIMAL(5,2) NOT NULL,
        threshold_percentage DECIMAL(5,2) NOT NULL,
        message TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // User sessions table (for JWT blacklisting)
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token_jti VARCHAR(255) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Watchlists table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_watchlists (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        symbols JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Price history table (for charts)
    await client.query(`
      CREATE TABLE IF NOT EXISTS price_history (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(20) NOT NULL,
        asset_type VARCHAR(10) NOT NULL,
        price DECIMAL(15,8) NOT NULL,
        volume DECIMAL(20,8),
        market_cap DECIMAL(20,8),
        change_24h DECIMAL(5,2),
        timestamp TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create indexes for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_alerts_user_id ON user_alerts(user_id);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_alerts_symbol ON user_alerts(symbol, asset_type);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_alert_history_user_id ON alert_history(user_id);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_alert_history_created_at ON alert_history(created_at DESC);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_price_history_symbol ON price_history(symbol, asset_type, timestamp DESC);
    `);

    // Add migration for reset token columns (safely add if they don't exist)
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token VARCHAR(500);
    `);
    
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP;
    `);

    logger.info('Database initialized successfully');
    
  } catch (error) {
    logger.error('Error initializing database:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Initialize on startup (don't exit on failure for development)
initializeDatabase().catch(error => {
  logger.error('Failed to initialize database:', error);
  logger.warn('Continuing without database - some features may not work');
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  initializeDatabase
};