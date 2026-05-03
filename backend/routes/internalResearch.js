/**
 * Server-to-server research artifact stats (optional).
 * Same secret as internal agent — no browser exposure.
 */
const express = require('express');
const db = require('../models/database');
const config = require('../config');
const logger = require('../utils/logger');
const { timingSafeStringEqual } = require('../utils/timingSafeEqual');
const { getLastIngestionSummary } = require('../services/researchIngestionWorker');
const { getResearchArtifactsForUser } = require('../services/researchArtifactsReader');

const router = express.Router();

function internalSecretOnly(req, res, next) {
  const expected = process.env.AGENT_INTERNAL_SECRET;
  if (!expected || typeof expected !== 'string') {
    return res.status(503).json({ message: 'AGENT_INTERNAL_SECRET not configured' });
  }
  const provided = req.headers['x-agent-internal-secret'];
  if (typeof provided !== 'string' || !timingSafeStringEqual(provided, expected)) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  next();
}

router.get('/summary', internalSecretOnly, async (req, res) => {
  try {
    const total = await db.query(`SELECT COUNT(*)::bigint AS n FROM research_artifacts`);
    const last24h = await db.query(
      `SELECT COUNT(*)::bigint AS n FROM research_artifacts
       WHERE fetched_at >= NOW() - INTERVAL '24 hours'`
    );
    const bySource = await db.query(
      `SELECT source, COUNT(*)::bigint AS n
       FROM research_artifacts
       GROUP BY source
       ORDER BY n DESC`
    );
    res.json({
      enabled: config.ENABLE_RESEARCH_INGESTION,
      cron: config.RESEARCH_NEWS_CRON,
      totalRows: Number(total.rows[0]?.n || 0),
      fetchedLast24h: Number(last24h.rows[0]?.n || 0),
      bySource: bySource.rows.map((r) => ({ source: r.source, count: Number(r.n) })),
      lastTick: getLastIngestionSummary()
    });
  } catch (error) {
    logger.error('internal research summary failed:', error);
    res.status(500).json({ message: 'Failed to load research summary' });
  }
});

/**
 * LangGraph / tools: recent headlines for **this user’s** watchlist symbols only.
 * Query: `symbols` = comma-separated tickers (optional — defaults to Main watchlist).
 * `hours`, `limit` optional. Requires **X-User-Id** (same as `/api/internal/agent/*`).
 */
router.get('/artifacts', internalSecretOnly, async (req, res) => {
  const uid = parseInt(req.headers['x-user-id'], 10);
  if (!Number.isFinite(uid) || uid < 1) {
    return res.status(400).json({ message: 'X-User-Id header required' });
  }
  const symParam = req.query.symbols;
  const symbols = typeof symParam === 'string' && symParam.trim()
    ? symParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const hours = parseInt(req.query.hours, 10);
  const limit = parseInt(req.query.limit, 10);
  try {
    const payload = await getResearchArtifactsForUser(uid, {
      symbols,
      hours: Number.isFinite(hours) ? hours : undefined,
      limit: Number.isFinite(limit) ? limit : undefined
    });
    res.json(payload);
  } catch (error) {
    logger.error('internal research artifacts failed:', error);
    res.status(500).json({ message: 'Failed to load research artifacts' });
  }
});

module.exports = router;
