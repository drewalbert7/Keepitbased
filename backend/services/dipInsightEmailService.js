const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const emailService = require('./emailService');
const { persistDipInsightEmailRun } = require('./agentPersistence');

/**
 * §11 speed path: deterministic dip already fired → Grok (x_search) narrative + X links → HTML email + audit row.
 * No X/Twitter API key required; uses xAI x_search on the Responses API.
 */
async function sendDipInsightForOpportunity(params) {
  const {
    userId,
    email,
    row,
    priceData,
    evalResult,
    dayChangePct,
    assetType,
    symbol,
    prefs
  } = params;

  const baselinePrice = Number(row.baseline_price);
  const dipContext = {
    symbol,
    assetType,
    flags: evalResult.flags,
    reasons: evalResult.reasons,
    vsBaselinePct: evalResult.vsBaselinePct,
    price: priceData.price,
    baselinePrice,
    dayChangePct: Number.isFinite(dayChangePct) ? dayChangePct : null,
    timestamp: new Date().toISOString()
  };

  const maxAllocationPct = Math.min(
    50,
    Math.max(1, Number(prefs.agentMaxPositionSizePct) || 10)
  );

  const url = `${(config.PYTHON_SERVICE_URL || 'http://127.0.0.1:5001').replace(/\/$/, '')}/agent/dip-insight`;
  const { data } = await axios.post(
    url,
    { dipContext, xSnippets: [], maxAllocationPct },
    { timeout: 95000 }
  );

  if (!data || data.error) {
    throw new Error(data?.error || 'dip-insight failed');
  }

  const insight = data.insight;
  const runMetadata = data.runMetadata || {};
  const citationUrls = Array.isArray(data.citations) ? data.citations : [];
  const linkCount =
    (Array.isArray(insight.xPostLinks) && insight.xPostLinks.length) || citationUrls.length;

  await emailService.sendDipInsightEmail(email, {
    symbol,
    assetType,
    dipContext,
    insight,
    maxAllocationPct,
    citationUrls
  });

  await persistDipInsightEmailRun({
    userId,
    dipFacts: dipContext,
    xSnippetCount: linkCount,
    situationSummary: insight.situationSummary,
    fullOutput: { insight, runMetadata, citations: citationUrls },
    runMetadata
  });
}

/** Try insight email; on failure log and rethrow so caller can fall back to plain opportunity email. */
async function tryDipInsightEmailOrThrow(ctx) {
  try {
    await sendDipInsightForOpportunity(ctx);
  } catch (err) {
    logger.warn(`Dip insight pipeline failed: ${err.message}`);
    throw err;
  }
}

module.exports = {
  sendDipInsightForOpportunity,
  tryDipInsightEmailOrThrow
};
