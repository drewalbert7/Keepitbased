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

// Serialize schema init — concurrent callers (server + scripts) must not race CREATE TABLE.
let databaseInitPromise = null;

async function initializeDatabase() {
  if (!databaseInitPromise) {
    databaseInitPromise = runInitializeDatabase().catch((err) => {
      databaseInitPromise = null;
      throw err;
    });
  }
  return databaseInitPromise;
}

async function runInitializeDatabase() {
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

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_watchlists_user_name ON user_watchlists(user_id, name)
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

    // Agent audit: one row per /api/agent/chat invocation + paired messages
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        external_run_id VARCHAR(128),
        source VARCHAR(32) NOT NULL DEFAULT 'chat',
        prompt TEXT,
        mode VARCHAR(32),
        preferences JSONB,
        reply TEXT,
        output JSONB,
        run_metadata JSONB,
        provider_used VARCHAR(32),
        fallback_used BOOLEAN,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_messages (
        id SERIAL PRIMARY KEY,
        run_id INTEGER NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
        seq SMALLINT NOT NULL,
        role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(run_id, seq)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_runs_user_id ON agent_runs(user_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_runs_created_at ON agent_runs(created_at DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_messages_run_id ON agent_messages(run_id);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_audit_events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action VARCHAR(80) NOT NULL,
        detail JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_audit_user_created
      ON agent_audit_events(user_id, created_at DESC);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS opportunity_signals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        symbol VARCHAR(20) NOT NULL,
        asset_type VARCHAR(10) NOT NULL CHECK (asset_type IN ('crypto', 'stock')),
        flags JSONB NOT NULL DEFAULT '[]',
        reasons JSONB NOT NULL DEFAULT '[]',
        vs_baseline_pct DECIMAL(12,4),
        price DECIMAL(20,8) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_opportunity_signals_user_created
      ON opportunity_signals(user_id, created_at DESC);
    `);

    // §11 Phase B — normalized research artifacts (news, later X/filings)
    await client.query(`
      CREATE TABLE IF NOT EXISTS research_artifacts (
        id BIGSERIAL PRIMARY KEY,
        source VARCHAR(32) NOT NULL,
        symbol VARCHAR(32) NOT NULL,
        asset_type VARCHAR(10) NOT NULL CHECK (asset_type IN ('stock', 'crypto')),
        cik VARCHAR(20),
        url TEXT,
        content_hash VARCHAR(64) NOT NULL,
        title TEXT,
        content_summary TEXT,
        published_at TIMESTAMPTZ,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        raw_payload JSONB NOT NULL DEFAULT '{}',
        structured_fields JSONB NOT NULL DEFAULT '{}',
        UNIQUE(content_hash)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_research_artifacts_symbol_published
      ON research_artifacts(symbol, published_at DESC NULLS LAST);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_research_artifacts_fetched
      ON research_artifacts(fetched_at DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_research_artifacts_source
      ON research_artifacts(source);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(128) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const signupInvite = require('../services/signupInviteCodeService');
    await signupInvite.seedFromEnvIfUnset();

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