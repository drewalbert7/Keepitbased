const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const auth = require('../middleware/auth');
const AlertService = require('../services/alertService');
const logger = require('../utils/logger');
const config = require('../config');

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

const proxyOpportunityScan = async ({ prompt, mode, preferences, userId }) => {
  const serviceUrl = config.PYTHON_SERVICE_URL || 'http://127.0.0.1:5001';
  const response = await axios.post(
    `${serviceUrl}/agent/opportunities`,
    {
      prompt,
      mode,
      preferences,
      userId
    },
    { timeout: 12000 }
  );
  return response.data;
};

const buildAgentOutput = (prompt, preferences, primarySymbol) => {
  const universe = [primarySymbol, 'MSFT', 'NVDA', 'AMZN', 'TSLA'];
  const pool = Array.from(new Set(universe)).slice(0, 10);
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

    if (useLangGraph) {
      try {
        const langGraphResult = await proxyOpportunityScan({
          prompt,
          mode,
          preferences: preferencesUsed,
          userId: req.user.id
        });
        output = langGraphResult.output || { schemaVersion: 'v1', topCandidates: [] };
        reply = langGraphResult.reply || 'Opportunity scan complete.';
        runMetadata = langGraphResult.runMetadata || null;
      } catch (proxyError) {
        logger.warn(`LangGraph proxy unavailable, using local fallback: ${proxyError.message}`);
      }
    }

    if (!output) {
      plan = buildPlan(prompt);
      output = buildAgentOutput(prompt, preferencesUsed, plan.proposedAlert.symbol);
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
    if (!plan) {
      plan = buildPlan(prompt);
    }

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

router.post('/apply', auth, agentRateLimiter, [
  body('proposedAlert.symbol').isString().trim().isLength({ min: 1, max: 10 }),
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

    if (
      proposedAlert.smallThreshold >= proposedAlert.mediumThreshold ||
      proposedAlert.mediumThreshold >= proposedAlert.largeThreshold
    ) {
      return res.status(400).json({
        message: 'Thresholds must be in ascending order: small < medium < large'
      });
    }

    const created = await alertService.createAlert(
      req.user.id,
      proposedAlert.symbol.toUpperCase(),
      proposedAlert.assetType,
      {
        small_threshold: proposedAlert.smallThreshold,
        medium_threshold: proposedAlert.mediumThreshold,
        large_threshold: proposedAlert.largeThreshold
      }
    );

    return res.status(201).json({
      message: `Applied alert for ${proposedAlert.symbol.toUpperCase()}`,
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
