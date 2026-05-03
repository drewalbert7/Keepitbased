const express = require('express');
const router = express.Router();
const config = require('../config');
const db = require('../models/database');
const logger = require('../utils/logger');
const emailService = require('../services/emailService');

// Basic health check
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.NODE_ENV,
    version: require('../package.json').version || '1.0.0'
  });
});

// Detailed health check
router.get('/detailed', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.NODE_ENV,
    version: require('../package.json').version || '1.0.0',
    services: {}
  };

  // Check database
  try {
    const start = Date.now();
    await db.query('SELECT 1');
    health.services.database = {
      status: 'ok',
      responseTime: Date.now() - start + 'ms'
    };
  } catch (error) {
    health.services.database = {
      status: 'error',
      error: error.message
    };
    health.status = 'degraded';
  }

  // Check Python service
  try {
    const axios = require('axios');
    const start = Date.now();
    const response = await axios.get(`${config.PYTHON_SERVICE_URL}/health`, {
      timeout: 5000
    });
    health.services.pythonService = {
      status: 'ok',
      responseTime: Date.now() - start + 'ms',
      url: config.PYTHON_SERVICE_URL
    };
  } catch (error) {
    health.services.pythonService = {
      status: 'error',
      error: error.message,
      url: config.PYTHON_SERVICE_URL
    };
    health.status = 'degraded';
  }

  // Check Redis (if available)
  try {
    // This is a placeholder - implement Redis check if needed
    health.services.redis = {
      status: 'ok',
      note: 'Redis check not implemented'
    };
  } catch (error) {
    health.services.redis = {
      status: 'error',
      error: error.message
    };
  }

  // Check memory usage
  const memUsage = process.memoryUsage();
  health.memory = {
    used: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
    total: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
    external: Math.round(memUsage.external / 1024 / 1024) + 'MB'
  };

  // Set appropriate status code
  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Configuration check (non-sensitive info only)
router.get('/config', (req, res) => {
  const safeConfig = {
    NODE_ENV: config.NODE_ENV,
    PORT: config.PORT,
    ENABLE_TEST_USER: config.ENABLE_TEST_USER,
    GRACEFUL_DB_FAILURE: config.GRACEFUL_DB_FAILURE,
    JWT_EXPIRES_IN: config.JWT_EXPIRES_IN,
    RATE_LIMIT_WINDOW_MS: config.RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX_REQUESTS: config.RATE_LIMIT_MAX_REQUESTS,
    PYTHON_SERVICE_URL: config.PYTHON_SERVICE_URL,
    hasJwtSecret: !!config.JWT_SECRET,
    hasDatabaseUrl: !!config.DATABASE_URL,
    hasRedisUrl: !!config.REDIS_URL,
    smtpConfigured: emailService.isConfigured(),
    dipInsightGloballyEnabled:
      !!config.ENABLE_DIP_INSIGHT_EMAIL && !config.DISABLE_DIP_INSIGHT_EMAIL,
    researchIngestionEnabled: !!config.ENABLE_RESEARCH_INGESTION,
    researchNewsCron: config.RESEARCH_NEWS_CRON,
    marketDataKeyPresent: !!(config.POLYGON_API_KEY || config.MASSIVE_API_KEY),
    researchFusionLookbackHours: config.RESEARCH_FUSION_LOOKBACK_HOURS,
    opportunityTriggerMode: config.OPPORTUNITY_TRIGGER_MODE,
    opportunityOnSaleAtrMult: config.OPPORTUNITY_ON_SALE_ATR_MULT,
    opportunityOverreactionAtrMult: config.OPPORTUNITY_OVERREACTION_ATR_MULT,
    opportunityOnSaleDropPct: config.OPPORTUNITY_ON_SALE_DROP_PCT,
    opportunityOverreactionDropPct: config.OPPORTUNITY_OVERREACTION_DROP_PCT,
    opportunityVolSpikeMult: config.OPPORTUNITY_VOL_SPIKE_MULT,
    opportunityDedupeTtlSec: config.OPPORTUNITY_DEDUPE_TTL_SEC,
    opportunityCapitulationAtr14Mult: config.OPPORTUNITY_CAPITULATION_ATR14_MULT,
    opportunityCapitulationAtr50Mult: config.OPPORTUNITY_CAPITULATION_ATR50_MULT,
    opportunityCapitulationFrom52wPct: config.OPPORTUNITY_CAPITULATION_FROM_52W_PCT,
    opportunityCapitulationFallback52wPct: config.OPPORTUNITY_CAPITULATION_FALLBACK_52W_PCT,
    opportunityCapitulationMegaCapAthPct: config.OPPORTUNITY_CAPITULATION_MEGA_CAP_ATH_PCT,
    opportunityMegaCapSymbolCount: Array.isArray(config.OPPORTUNITY_MEGA_CAP_SYMBOLS)
      ? config.OPPORTUNITY_MEGA_CAP_SYMBOLS.length
      : 0,
    opportunityCapitulationDedupeTtlSec: config.OPPORTUNITY_CAPITULATION_DEDUPE_TTL_SEC,
    opportunityShortTrendFilterEnabled: !!config.OPPORTUNITY_SHORT_TREND_FILTER_ENABLED,
    opportunityShortTrendSmaDays: config.OPPORTUNITY_SHORT_TREND_SMA_DAYS,
    opportunityAtrMinPctOfPrice: config.OPPORTUNITY_ATR_MIN_PCT_OF_PRICE,
    dailyWatchlistDigestEnabled:
      !!config.ENABLE_DAILY_WATCHLIST_DIGEST_EMAIL && !config.DISABLE_DAILY_WATCHLIST_DIGEST_EMAIL,
    dailyWatchlistDigestCron: config.DAILY_WATCHLIST_DIGEST_CRON
  };

  res.json({
    status: 'ok',
    config: safeConfig
  });
});

module.exports = router;