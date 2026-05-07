/**
 * Deterministic gates for §11 research+dip fusion (Phase A contracts).
 * LLM does not participate in these booleans.
 */

/** @typedef {object} MergedNotificationPreferences merged shape from mergeNotificationPreferences() */

/**
 * v1 correlation: need dip flags AND at least one research artifact for fused send.
 *
 * @param {object} input
 * @param {string[]} input.dipFlags - from evaluateWatchlistOpportunity
 * @param {number} input.researchArtifactCount - rows in window for symbol
 * @param {number} [input.minArtifacts=1]
 * @returns {{ fusedEligible: boolean, reasons: string[] }}
 */
function correlationRuleV1(input) {
  const dipFlags = Array.isArray(input.dipFlags) ? input.dipFlags : [];
  const count = Math.max(0, Number(input.researchArtifactCount) || 0);
  const minArtifacts = input.minArtifacts != null ? Number(input.minArtifacts) : 1;
  const reasons = [];

  const hasDip = dipFlags.length > 0;
  const hasResearch = count >= minArtifacts;

  if (!hasDip) reasons.push('no_dip_signal');
  if (!hasResearch) reasons.push('no_research_artifacts');

  return {
    fusedEligible: hasDip && hasResearch,
    reasons
  };
}

/**
 * User prefs gate for fused digest emails (Phase D will call this before enqueue).
 *
 * @param {MergedNotificationPreferences} prefs
 * @param {{ emailsSentToday?: number }} usage
 */
function allowsResearchDigestEmail(prefs, usage = {}) {
  if (!prefs.researchDigestEmail) {
    return { allowed: false, reason: 'research_digest_disabled' };
  }
  const max = prefs.researchMaxEmailsPerDay;
  const sent = Math.max(0, Number(usage.emailsSentToday) || 0);
  if (sent >= max) {
    return { allowed: false, reason: 'daily_cap' };
  }
  return { allowed: true, reason: null };
}

/**
 * US equities regular session Mon–Fri 09:30–16:00 America/New_York (exchange holidays not modeled).
 * @param {Date} [utcDate]
 * @returns {boolean}
 */
function isUsStockRegularTradingHours(utcDate = new Date()) {
  const d = utcDate instanceof Date ? utcDate : new Date(utcDate);
  const tz = 'America/New_York';
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d);
  if (wd === 'Sat' || wd === 'Sun') return false;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  }).formatToParts(d);
  const hour = Number(parts.find((x) => x.type === 'hour')?.value);
  const minute = Number(parts.find((x) => x.type === 'minute')?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  const mins = hour * 60 + minute;
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  return mins >= open && mins < close;
}

module.exports = {
  correlationRuleV1,
  allowsResearchDigestEmail,
  isUsStockRegularTradingHours
};
