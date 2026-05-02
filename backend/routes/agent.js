const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const auth = require('../middleware/auth');
const AlertService = require('../services/alertService');
const logger = require('../utils/logger');
const config = require('../config');
const {
  persistAgentChatRun,
  listRecentAgentRuns,
  listRecentAgentAudit,
  persistAgentAuditEvent
} = require('../services/agentPersistence');
const { validateAlertSymbol } = require('../utils/alertSymbolValidate');
const {
  buildAgentWatchlistContext,
  formatWatchlistDigestMarkdown
} = require('../services/agentWatchlistContext');

const router = express.Router();
const alertService = new AlertService();
const DEFAULT_PREFERENCES = {
  topN: 3,
  confidenceFloor: 0.55,
  maxPositionSizePct: 10,
  watchlistOnly: true,
  scoringWeights: {
    momentum: 0.35,
    trend: 0.3,
    liquidity: 0.2,
    eventRiskPenalty: 0.15
  }
};

const agentRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many AI agent requests, retry shortly' }
});

const agentApplyLimiter = rateLimit({
  windowMs: config.AGENT_APPLY_RATE_WINDOW_MS,
  max: config.AGENT_APPLY_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many alert apply attempts. Wait a moment before creating more alerts.'
  },
  keyGenerator: (req) => `agent-apply:${req.user?.id ?? req.ip}`
});

const agentAuditLimiter = rateLimit({
  windowMs: config.AGENT_AUDIT_RATE_WINDOW_MS,
  max: config.AGENT_AUDIT_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many audit requests. Retry shortly.' },
  keyGenerator: (req) => `agent-audit:${req.user?.id ?? req.ip}`
});

const extractSymbol = (text = '') => {
  const match = text.toUpperCase().match(/\b[A-Z]{1,5}\b/);
  return match ? match[0] : null;
};

const extractThreshold = (text, fallback) => {
  const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? Number(match[1]) : fallback;
};

const buildPlan = (prompt = '') => {
  const symbol = extractSymbol(prompt) || 'AAPL';
  const lower = prompt.toLowerCase();
  const assetType = lower.includes('crypto') ? 'crypto' : 'stock';
  const smallThreshold = extractThreshold(prompt, 5);
  const mediumThreshold = Math.max(smallThreshold + 2, 10);
  const largeThreshold = Math.max(mediumThreshold + 5, 15);

  return {
    summary: `Prepared a ${assetType} alert strategy for ${symbol} using staged dip thresholds (${smallThreshold}%/${mediumThreshold}%/${largeThreshold}%).`,
    riskNotes: [
      'Validate position size before enabling large-threshold alerts.',
      'Review liquidity and earnings/event calendar for this symbol.',
      'Use tighter thresholds when volatility is elevated intraday.'
    ],
    proposedAlert: {
      symbol,
      assetType,
      smallThreshold,
      mediumThreshold,
      largeThreshold
    }
  };
};

/** Major crypto tickers as traded in-app (Polygon-style symbols). */
const CRYPTO_SYMBOL_HINT = new Set([
  'BTC',
  'ETH',
  'SOL',
  'DOGE',
  'XRP',
  'ADA',
  'AVAX',
  'DOT',
  'LINK',
  'LTC'
]);

const inferAssetType = (symbol, prompt = '') => {
  const s = String(symbol || '').toUpperCase();
  if (CRYPTO_SYMBOL_HINT.has(s)) return 'crypto';
  const p = String(prompt || '').toLowerCase();
  if (p.includes('crypto') && !p.includes('stock')) return 'crypto';
  return 'stock';
};

/** When LangGraph returns ranked candidates, align the draft alert with #1. */
const buildPlanFromTopCandidate = (candidate, prompt = '') => {
  const symbol = String(candidate.symbol || 'AAPL').toUpperCase();
  const assetType = inferAssetType(symbol, prompt);
  const smallThreshold = 5;
  const mediumThreshold = 10;
  const largeThreshold = 15;
  const rf = Array.isArray(candidate.riskFlags) ? candidate.riskFlags : [];
  const riskNotes = rf.length
    ? [...rf, 'Review sizing against your max position % setting before applying.']
    : [
        'Validate position size before enabling large-threshold alerts.',
        'Review liquidity and earnings/event calendar for this symbol.'
      ];

  return {
    summary: `Draft alert for top-ranked candidate ${symbol} (score ${Number(candidate.score).toFixed(3)}, confidence ${Number(candidate.confidence).toFixed(3)}). Using standard 5% / 10% / 15% dip bands — adjust thresholds before apply if needed.`,
    riskNotes,
    proposedAlert: {
      symbol,
      assetType,
      smallThreshold,
      mediumThreshold,
      largeThreshold
    }
  };
};

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

const normalizePreferences = (preferences = {}) => {
  const merged = {
    ...DEFAULT_PREFERENCES,
    ...preferences,
    scoringWeights: {
      ...DEFAULT_PREFERENCES.scoringWeights,
      ...(preferences.scoringWeights || {})
    }
  };

  const normalized = {
    topN: clamp(Number(merged.topN) || DEFAULT_PREFERENCES.topN, 1, 10),
    confidenceFloor: clamp(Number(merged.confidenceFloor) || DEFAULT_PREFERENCES.confidenceFloor, 0.1, 0.95),
    maxPositionSizePct: clamp(Number(merged.maxPositionSizePct) || DEFAULT_PREFERENCES.maxPositionSizePct, 1, 50),
    watchlistOnly: Boolean(merged.watchlistOnly),
    scoringWeights: {
      momentum: clamp(Number(merged.scoringWeights.momentum) || DEFAULT_PREFERENCES.scoringWeights.momentum, 0, 1),
      trend: clamp(Number(merged.scoringWeights.trend) || DEFAULT_PREFERENCES.scoringWeights.trend, 0, 1),
      liquidity: clamp(Number(merged.scoringWeights.liquidity) || DEFAULT_PREFERENCES.scoringWeights.liquidity, 0, 1),
      eventRiskPenalty: clamp(Number(merged.scoringWeights.eventRiskPenalty) || DEFAULT_PREFERENCES.scoringWeights.eventRiskPenalty, 0, 1)
    }
  };

  const total = normalized.scoringWeights.momentum
    + normalized.scoringWeights.trend
    + normalized.scoringWeights.liquidity
    + normalized.scoringWeights.eventRiskPenalty;

  if (total > 0) {
    normalized.scoringWeights.momentum /= total;
    normalized.scoringWeights.trend /= total;
    normalized.scoringWeights.liquidity /= total;
    normalized.scoringWeights.eventRiskPenalty /= total;
  }

  return normalized;
};

const proxyOpportunityScan = async ({ prompt, mode, preferences, userId, watchlistContext }) => {
  const serviceUrl = config.PYTHON_SERVICE_URL || 'http://127.0.0.1:5001';
  const response = await axios.post(
    `${serviceUrl}/agent/opportunities`,
    {
      prompt,
      mode,
      preferences,
      userId,
      watchlistContext: watchlistContext || null
    },
    { timeout: 12000 }
  );
  return response.data;
};

const buildAgentOutput = (prompt, preferences, primarySymbol, watchlistSymbols = null) => {
  let pool;
  if (watchlistSymbols && Array.isArray(watchlistSymbols) && watchlistSymbols.length) {
    pool = Array.from(new Set(watchlistSymbols.map((s) => String(s).toUpperCase()).filter(Boolean))).slice(
      0,
      10
    );
  } else {
    const universe = [primarySymbol, 'MSFT', 'NVDA', 'AMZN', 'TSLA'];
    pool = Array.from(new Set(universe)).slice(0, 10);
  }
  const p = prompt.toLowerCase();

  const topCandidates = pool.map((symbol, index) => {
    const momentumSignal = symbol === primarySymbol ? 0.72 : 0.58 - index * 0.03;
    const trendSignal = symbol === primarySymbol ? 0.68 : 0.62 - index * 0.02;
    const liquiditySignal = symbol === 'NVDA' || symbol === 'MSFT' ? 0.78 : 0.64;
    const eventRisk = p.includes('war') || p.includes('news') ? 0.35 : 0.15 + index * 0.02;

    const rawScore = (momentumSignal * preferences.scoringWeights.momentum)
      + (trendSignal * preferences.scoringWeights.trend)
      + (liquiditySignal * preferences.scoringWeights.liquidity)
      - (eventRisk * preferences.scoringWeights.eventRiskPenalty);
    const score = clamp(rawScore, 0, 1);
    const confidence = clamp(score - eventRisk * 0.1, 0, 1);

    return {
      symbol,
      score: Number(score.toFixed(3)),
      confidence: Number(confidence.toFixed(3)),
      whyNow: `${symbol} shows favorable trend/momentum alignment with liquidity support under current settings.`,
      riskFlags: eventRisk > 0.25 ? ['news_shock_risk', 'volatility_elevated'] : ['normal_volatility'],
      suggestedLimitBand: {
        min: Number((100 * (1 - 0.03 - index * 0.002)).toFixed(2)),
        max: Number((100 * (1 - 0.015 - index * 0.002)).toFixed(2))
      }
    };
  }).filter((c) => c.confidence >= preferences.confidenceFloor)
    .sort((a, b) => b.score - a.score)
    .slice(0, preferences.topN);

  return {
    schemaVersion: 'v1',
    topCandidates
  };
};

router.get('/runs', auth, async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const rows = await listRecentAgentRuns(req.user.id, limit);
    return res.json({ runs: rows });
  } catch (error) {
    logger.error('Agent runs list failed:', error);
    return res.status(500).json({ message: 'Failed to list agent runs' });
  }
});

router.get('/audit', auth, agentAuditLimiter, async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const beforeId =
      req.query.beforeId != null && req.query.beforeId !== ''
        ? parseInt(String(req.query.beforeId), 10)
        : undefined;
    let actionPrefix = req.query.action;
    if (typeof actionPrefix === 'string') {
      actionPrefix = actionPrefix.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 80);
      if (actionPrefix.length === 0) actionPrefix = undefined;
    } else {
      actionPrefix = undefined;
    }

    const { rows: events, limit: cap } = await listRecentAgentAudit(req.user.id, {
      limit,
      beforeId: Number.isFinite(beforeId) && beforeId > 0 ? beforeId : undefined,
      actionPrefix
    });

    const hasMore = events.length === cap && events.length > 0;
    const nextBeforeId = hasMore ? events[events.length - 1].id : null;

    return res.json({ events, nextBeforeId, hasMore });
  } catch (error) {
    logger.error('Agent audit list failed:', error);
    return res.status(500).json({ message: 'Failed to list audit events' });
  }
});

/** Live watchlist (user alerts) + dip-band sizing hints vs max position %. */
router.get('/watchlist-context', auth, agentRateLimiter, async (req, res) => {
  try {
    const raw = req.query.maxPositionPct;
    const maxPositionPct =
      raw !== undefined && raw !== '' ? Number(raw) : DEFAULT_PREFERENCES.maxPositionSizePct;
    const payload = await buildAgentWatchlistContext({
      alertService,
      userId: req.user.id,
      maxPositionPct: Number.isFinite(maxPositionPct) ? maxPositionPct : DEFAULT_PREFERENCES.maxPositionSizePct
    });
    return res.json(payload);
  } catch (error) {
    logger.error('Agent watchlist-context failed:', error);
    return res.status(500).json({ message: 'Failed to load watchlist context' });
  }
});

router.post('/chat', auth, agentRateLimiter, [
  body('prompt').isString().trim().isLength({ min: 3, max: 2000 }),
  body('mode').optional().isIn(['recommend_only', 'auto_apply_low_risk']),
  body('preferences').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const prompt = req.body.prompt.trim();
    const mode = req.body.mode || 'recommend_only';
    const preferencesUsed = normalizePreferences(req.body.preferences);
    const useLangGraph = String(process.env.ENABLE_LANGGRAPH_AGENT || '').toLowerCase() === 'true';
    let output;
    let reply;
    let plan;
    let runMetadata;

    let watchlistContext = null;
    try {
      watchlistContext = await buildAgentWatchlistContext({
        alertService,
        userId: req.user.id,
        maxPositionPct: preferencesUsed.maxPositionSizePct
      });
    } catch (wlErr) {
      logger.warn(`Agent chat: watchlist context unavailable (${wlErr.message})`);
    }

    let langGraphOk = false;
    if (useLangGraph) {
      try {
        const langGraphResult = await proxyOpportunityScan({
          prompt,
          mode,
          preferences: preferencesUsed,
          userId: req.user.id,
          watchlistContext
        });
        output = langGraphResult.output || { schemaVersion: 'v1', topCandidates: [] };
        reply = langGraphResult.reply || 'Opportunity scan complete.';
        runMetadata = langGraphResult.runMetadata || null;
        langGraphOk = true;
      } catch (proxyError) {
        logger.warn(`LangGraph proxy unavailable, using local fallback: ${proxyError.message}`);
      }
    }

    if (!output) {
      plan = buildPlan(prompt);
      let watchlistSymbols = null;
      if (preferencesUsed.watchlistOnly && watchlistContext?.items?.length) {
        watchlistSymbols = watchlistContext.items
          .filter((row) => Boolean(row.active))
          .map((row) => String(row.symbol || '').trim())
          .filter(Boolean);
      }
      output = buildAgentOutput(prompt, preferencesUsed, plan.proposedAlert.symbol, watchlistSymbols);
      reply = `${plan.summary}\n\nDraft alert: ${plan.proposedAlert.symbol} (${plan.proposedAlert.assetType}) with ${plan.proposedAlert.smallThreshold}% / ${plan.proposedAlert.mediumThreshold}% / ${plan.proposedAlert.largeThreshold}% thresholds.\n\nNext step: review and apply this plan to your live alerts.`;
      runMetadata = {
        runId: `local-${Date.now()}`,
        nodeTimings: {
          langgraphInvokeMs: 0,
          totalMs: 0
        },
        providerUsed: 'local-template',
        fallbackUsed: true
      };
    }

    if (!langGraphOk && watchlistContext?.items?.length) {
      const digest = formatWatchlistDigestMarkdown(watchlistContext);
      if (digest) {
        reply = `${digest}\n\n---\n\n${reply}`;
      }
    }
    if (!plan) {
      if (output?.topCandidates?.length) {
        plan = buildPlanFromTopCandidate(output.topCandidates[0], prompt);
      } else {
        plan = buildPlan(prompt);
      }
    }

    void persistAgentChatRun({
      userId: req.user.id,
      prompt,
      mode,
      preferences: preferencesUsed,
      reply,
      output,
      runMetadata
    });

    return res.json({
      mode,
      reply,
      plan,
      output,
      runMetadata,
      preferencesUsed,
      policy: {
        decision: 'proposed',
        autoApplied: false
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Agent chat failed:', error);
    return res.status(500).json({ message: 'Failed to process agent request' });
  }
});

router.post('/apply', auth, agentApplyLimiter, [
  body('proposedAlert.symbol').isString().trim().isLength({ min: 1, max: 16 }),
  body('proposedAlert.assetType').isIn(['crypto', 'stock']),
  body('proposedAlert.smallThreshold').isFloat({ min: 0.1, max: 50 }),
  body('proposedAlert.mediumThreshold').isFloat({ min: 0.1, max: 50 }),
  body('proposedAlert.largeThreshold').isFloat({ min: 0.1, max: 50 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { proposedAlert } = req.body;

    const symCheck = validateAlertSymbol(proposedAlert.symbol);
    if (!symCheck.ok) {
      return res.status(400).json({ message: symCheck.message });
    }

    if (
      proposedAlert.smallThreshold >= proposedAlert.mediumThreshold ||
      proposedAlert.mediumThreshold >= proposedAlert.largeThreshold
    ) {
      return res.status(400).json({
        message: 'Thresholds must be in ascending order: small < medium < large'
      });
    }

    const gapSmallMedium = proposedAlert.mediumThreshold - proposedAlert.smallThreshold;
    const gapMediumLarge = proposedAlert.largeThreshold - proposedAlert.mediumThreshold;
    if (gapSmallMedium < 0.5 || gapMediumLarge < 0.5) {
      return res.status(400).json({
        message: 'Leave at least 0.5% between small/medium and medium/large tiers'
      });
    }

    const existingCount = await alertService.countUserAlerts(req.user.id);
    if (existingCount >= config.MAX_ALERTS_PER_USER) {
      void persistAgentAuditEvent({
        userId: req.user.id,
        action: 'agent_apply_quota_blocked',
        detail: { symbol: symCheck.symbol, count: existingCount }
      });
      return res.status(403).json({
        message: `Maximum ${config.MAX_ALERTS_PER_USER} alerts per account. Remove an alert before adding another.`
      });
    }

    const created = await alertService.createAlert(
      req.user.id,
      symCheck.symbol,
      proposedAlert.assetType,
      {
        small_threshold: proposedAlert.smallThreshold,
        medium_threshold: proposedAlert.mediumThreshold,
        large_threshold: proposedAlert.largeThreshold
      }
    );

    void persistAgentAuditEvent({
      userId: req.user.id,
      action: 'agent_apply_alert_created',
      detail: {
        symbol: symCheck.symbol,
        assetType: proposedAlert.assetType,
        alertId: created.id,
        thresholds: {
          small: proposedAlert.smallThreshold,
          medium: proposedAlert.mediumThreshold,
          large: proposedAlert.largeThreshold
        }
      }
    });

    return res.status(201).json({
      message: `Applied alert for ${symCheck.symbol}`,
      alert: created,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Alert already exists for this symbol' });
    }
    logger.error('Agent apply failed:', error);
    return res.status(500).json({ message: 'Failed to apply agent plan' });
  }
});

module.exports = router;
