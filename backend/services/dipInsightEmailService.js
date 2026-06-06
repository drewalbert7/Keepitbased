const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const emailService = require('./emailService');
const { isOpportunityEmailUnlimited } = require('../utils/notificationPreferences');
const { persistDipInsightEmailRun } = require('./agentPersistence');
const { updateOpportunitySignalAiAssessment } = require('./opportunitySignalsPersistence');
const { computeDipConfluenceScore } = require('../utils/dipConfluenceScore');

/**
 * Whether to send the HTML dip email (assessment may still be persisted on the signal row).
 */
function shouldDispatchUltimateDipBuyerEmail(insight) {
  if (config.DIP_INSIGHT_EMAIL_REQUIRE_BUY_VERDICT) {
    const vRaw = String(insight.verdict || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    const ok =
      vRaw === 'strong_buy' ||
      vRaw === 'strongbuy' ||
      vRaw === 'buy';
    if (!ok) return false;
  }

  const minC = config.DIP_INSIGHT_MIN_CONFIDENCE_FOR_EMAIL;
  if (minC > 0) {
    const c = Number(insight.confidence);
    if (!Number.isFinite(c) || c < minC) return false;
  }
  return true;
}

/**
 * §11 speed path + UltimateDipBuyer AI: deterministic dip → Grok (x_search) structured verdict →
 * optional HTML email + `opportunity_signals.ai_assessment` + agent_runs audit.
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
    prefs,
    signalId,
    tech
  } = params;

  const baselinePrice = Number(row.baseline_price);
  const ruleConfluenceScore = computeDipConfluenceScore(evalResult, tech || {}, priceData.price);

  const dipContext = {
    symbol,
    assetType,
    flags: evalResult.flags,
    reasons: evalResult.reasons,
    vsBaselinePct: evalResult.vsBaselinePct,
    price: priceData.price,
    baselinePrice,
    dayChangePct: Number.isFinite(dayChangePct) ? dayChangePct : null,
    timestamp: new Date().toISOString(),
    technicalSnapshot: {
      atr14: tech?.atr14 ?? null,
      atr50: tech?.atr50 ?? null,
      week52High: tech?.week52High ?? null,
      week52Low: tech?.week52Low ?? null,
      athHigh: tech?.athHigh ?? null,
      smaTrend: tech?.smaTrend ?? null
    },
    ruleConfluenceScore
  };

  const maxAllocationPct = Math.min(50, Math.max(1, Number(prefs.agentMaxPositionSizePct) || 10));

  const quantContext = {
    project: 'KeepItBased-UltimateDipBuyer',
    ruleConfluenceScore,
    schemaVersion: 'ultimate_dip_buyer_v1'
  };

  const url = `${(config.PYTHON_SERVICE_URL || 'http://127.0.0.1:5001').replace(/\/$/, '')}/agent/dip-insight`;
  const { data } = await axios.post(
    url,
    { dipContext, quantContext, xSnippets: [], maxAllocationPct },
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

  const dispatchEmail = shouldDispatchUltimateDipBuyerEmail(insight);
  let emailSent = false;
  let suppressReason = null;
  if (!dispatchEmail) {
    if (config.DIP_INSIGHT_EMAIL_REQUIRE_BUY_VERDICT) {
      suppressReason = 'verdict_not_buy';
    } else if (config.DIP_INSIGHT_MIN_CONFIDENCE_FOR_EMAIL > 0) {
      suppressReason = 'confidence_below_min';
    } else {
      suppressReason = 'policy';
    }
  }

  if (dispatchEmail) {
    await emailService.sendDipInsightEmail(email, {
      symbol,
      assetType,
      dipContext,
      insight,
      maxAllocationPct,
      citationUrls,
      userId,
      budgetExempt: isOpportunityEmailUnlimited(prefs)
    });
    emailSent = true;
  } else {
    logger.info(
      `UltimateDipBuyer email suppressed (${suppressReason}) user=${userId} ${assetType}:${symbol} verdict=${insight.verdict ?? 'n/a'}`
    );
  }

  /** Rich HTML was skipped by policy — still send the same plain opportunity mail as the non–dip-insight path */
  let plainOpportunityEmailSent = false;
  if (!emailSent) {
    const oppPayload = {
      kind: 'opportunity_signal',
      symbol,
      assetType,
      flags: evalResult.flags,
      reasons: evalResult.reasons,
      vsBaselinePct: evalResult.vsBaselinePct,
      price: priceData.price,
      timestamp: dipContext.timestamp
    };
    await emailService.sendOpportunitySignalEmail(email, oppPayload, {
      userId,
      budgetExempt: isOpportunityEmailUnlimited(prefs)
    });
    plainOpportunityEmailSent = true;
    logger.info(
      `Plain opportunity email sent (dip insight rich email suppressed) user=${userId} ${assetType}:${symbol}`
    );
  }

  const assessment = {
    schemaVersion: 'ultimate_dip_buyer_v1',
    verdict: insight.verdict ?? null,
    confidence: insight.confidence ?? null,
    reasoning: insight.reasoning ?? null,
    situationSummary: insight.situationSummary ?? null,
    suggestedTranchePct: insight.suggestedTranchePct ?? null,
    riskNotes: insight.riskNotes ?? null,
    xSentiment: insight.xSentiment ?? null,
    fireSaleHypothesis: insight.fireSaleHypothesis ?? null,
    ruleConfluenceScore,
    runMetadata,
    citations: citationUrls,
    emailSent,
    plainOpportunityEmailSent,
    emailSuppressReason:
      emailSent || plainOpportunityEmailSent ? null : suppressReason
  };

  if (signalId) {
    await updateOpportunitySignalAiAssessment(userId, signalId, assessment);
  }

  const auditSummary =
    [insight.verdict ? `Verdict: ${insight.verdict}` : null, insight.reasoning || insight.situationSummary]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 8000);

  await persistDipInsightEmailRun({
    userId,
    dipFacts: dipContext,
    xSnippetCount: linkCount,
    situationSummary: auditSummary || insight.situationSummary,
    fullOutput: {
      insight,
      runMetadata,
      citations: citationUrls,
      emailSent,
      ultimateDipBuyer: true
    },
    runMetadata
  });

  return { emailSent, plainOpportunityEmailSent, suppressReason };
}

/** Try insight pipeline; on failure log and rethrow so caller can fall back to plain opportunity email. */
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
  tryDipInsightEmailOrThrow,
  shouldDispatchUltimateDipBuyerEmail
};
