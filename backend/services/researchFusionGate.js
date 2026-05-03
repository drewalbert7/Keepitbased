const config = require('../config');
const logger = require('../utils/logger');
const { correlationRuleV1 } = require('../utils/researchAlertGates');
const { countArtifactsForSymbol } = require('./researchArtifactsService');

/**
 * §11 Phase D — deterministic fusion gate before Grok dip-insight email.
 * When the user enables **`researchDigestEmail`**, we require **dip flags ∧ ≥1 `research_artifact`**
 * in the lookback window (`correlationRuleV1`). Otherwise we fall back to plain opportunity email.
 *
 * When **`researchDigestEmail`** is off, Grok dip-insight behavior is unchanged (speed path).
 *
 * @param {object} prefs - merged notification prefs (see `mergeNotificationPreferences`)
 * @param {{ flags: string[], reasons?: string[], vsBaselinePct?: number }} evalResult - from evaluateWatchlistOpportunity
 * @param {string} symbol - bare ticker (watchlist / alert symbol)
 * @returns {Promise<{ allowDipInsight: boolean, artifactCount: number | null, fusedEligible: boolean, fusionReasons: string[] }>}
 */
async function evaluateDipInsightFusionGate(prefs, evalResult, symbol) {
  if (!prefs.researchDigestEmail) {
    return {
      allowDipInsight: true,
      artifactCount: null,
      fusedEligible: true,
      fusionReasons: []
    };
  }

  try {
    const hours = config.RESEARCH_FUSION_LOOKBACK_HOURS;
    const artifactCount = await countArtifactsForSymbol(symbol, hours);
    const { fusedEligible, reasons } = correlationRuleV1({
      dipFlags: evalResult.flags,
      researchArtifactCount: artifactCount
    });
    return {
      allowDipInsight: fusedEligible,
      artifactCount,
      fusedEligible,
      fusionReasons: reasons
    };
  } catch (e) {
    logger.warn(
      `evaluateDipInsightFusionGate: DB error for ${symbol} — fail-open (allow dip insight): ${e.message}`
    );
    return {
      allowDipInsight: true,
      artifactCount: null,
      fusedEligible: true,
      fusionReasons: ['fusion_gate_error_fail_open']
    };
  }
}

module.exports = {
  evaluateDipInsightFusionGate
};
