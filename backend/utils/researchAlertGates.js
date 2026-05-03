/**
 * Deterministic gates for §11 research+dip fusion (Phase A contracts).
 * LLM does not participate in these booleans.
 */

/** @typedef {object} MergedNotificationPreferences merged shape from mergeNotificationPreferences() */

/**
 * Local hour (0–23) in IANA timeZone for the given instant.
 * @param {Date} utcDate
 * @param {string} timeZone - IANA, e.g. "America/New_York"
 * @returns {number | null}
 */
function getLocalHour(utcDate, timeZone) {
  if (!timeZone || typeof timeZone !== 'string') return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      hour12: false
    }).formatToParts(utcDate);
    const hourPart = parts.find((x) => x.type === 'hour');
    if (!hourPart) return null;
    return parseInt(hourPart.value, 10);
  } catch {
    return null;
  }
}

/**
 * Quiet hours use local clock: startHour inclusive, endHour exclusive, supports overnight (e.g. 22 → 7).
 * If hour cannot be resolved, returns false (do not block send solely on TZ typo).
 *
 * @param {Date} nowUtc
 * @param {{ startHour?: number, endHour?: number }} [quiet]
 * @param {string} [timeZone]
 * @returns {boolean} true if inside quiet hours
 */
function isQuietHour(nowUtc, quiet, timeZone) {
  if (!quiet || quiet.startHour == null || quiet.endHour == null) return false;
  const start = Number(quiet.startHour);
  const end = Number(quiet.endHour);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;

  const h = getLocalHour(nowUtc, timeZone || 'UTC');
  if (h === null) return false;

  if (start === end) return false;

  if (start < end) {
    return h >= start && h < end;
  }
  // overnight e.g. 22–07
  return h >= start || h < end;
}

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
 * @param {MergedNotificationPreferences} prefs
 * @param {Date} [now]
 */
function allowsSendDuringQuietHours(prefs, now = new Date()) {
  const q = prefs.researchQuietHoursLocal;
  if (!q) return { allowed: true, reason: null };
  const tz = prefs.timezone || 'UTC';
  if (isQuietHour(now, q, tz)) {
    return { allowed: false, reason: 'quiet_hours' };
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
  getLocalHour,
  isQuietHour,
  correlationRuleV1,
  allowsResearchDigestEmail,
  allowsSendDuringQuietHours,
  isUsStockRegularTradingHours
};
