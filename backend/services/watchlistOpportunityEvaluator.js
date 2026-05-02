/**
 * Deterministic watchlist opportunity signals. Inputs must be tool-backed (quotes, baselines),
 * not LLM-inferred prices.
 */

const DEFAULTS = {
  /** Price vs user baseline: at or beyond this drop ⇒ "on_sale" */
  onSaleDropPct: 5,
  /** Larger dislocation vs baseline ⇒ "overreaction" (combined with vol check below) */
  overreactionDropPct: 12,
  /** Flag overreaction if |dayChangePct| ≥ this × recentAbsAvgMovePct */
  overreactionVolMultiplier: 2
};

/**
 * Stable key for deduping notifications (caller chooses bucket size, e.g. hourly).
 */
function notificationDedupeKey(userId, symbol, triggerType, timeBucketUtc) {
  return `opp:${userId}:${String(symbol).toUpperCase()}:${triggerType}:${timeBucketUtc}`;
}

function floorTimeBucketUtc(date, bucketMinutes) {
  const d = date instanceof Date ? date : new Date(date);
  const ms = bucketMinutes * 60 * 1000;
  return Math.floor(d.getTime() / ms) * ms;
}

/**
 * @param {object} input
 * @param {string} input.symbol
 * @param {number} input.price - last trade / snapshot price
 * @param {number} input.baselinePrice - user's reference (e.g. alert baseline or fair-value midpoint)
 * @param {number} [input.dayChangePct] - session or 24h change %
 * @param {number} [input.recentAbsAvgMovePct] - e.g. avg absolute daily move over N sessions (same symbol)
 * @param {object} [config] - overrides DEFAULTS
 */
function evaluateWatchlistOpportunity(input, config = {}) {
  const c = { ...DEFAULTS, ...config };
  const symbol = String(input.symbol || '').toUpperCase();
  const price = Number(input.price);
  const baselinePrice = Number(input.baselinePrice);

  const flags = [];
  const reasons = [];

  if (!(baselinePrice > 0) || !(price > 0)) {
    return { symbol, flags: [], reasons: [], evaluated: false };
  }

  const vsBaselinePct = ((price - baselinePrice) / baselinePrice) * 100;

  if (vsBaselinePct <= -c.onSaleDropPct) {
    flags.push('on_sale');
    reasons.push(`Price ${vsBaselinePct.toFixed(2)}% vs baseline (on_sale threshold −${c.onSaleDropPct}%)`);
  }

  const dayCh = input.dayChangePct != null ? Number(input.dayChangePct) : null;
  const avgMove = input.recentAbsAvgMovePct != null ? Number(input.recentAbsAvgMovePct) : null;
  const volSpike =
    dayCh != null &&
    !Number.isNaN(dayCh) &&
    avgMove != null &&
    avgMove > 0 &&
    Math.abs(dayCh) >= avgMove * c.overreactionVolMultiplier;

  if (vsBaselinePct <= -c.overreactionDropPct) {
    flags.push('overreaction');
    reasons.push(`Vs baseline ${vsBaselinePct.toFixed(2)}% (overreaction threshold −${c.overreactionDropPct}%)`);
  } else if (volSpike) {
    flags.push('overreaction');
    reasons.push(
      `Intraday move ${Math.abs(dayCh).toFixed(2)}% vs typical ~${avgMove.toFixed(2)}% (vol spike)`
    );
  }

  const uniqueFlags = [...new Set(flags)];
  return {
    symbol,
    flags: uniqueFlags,
    reasons,
    evaluated: true,
    vsBaselinePct: Number(vsBaselinePct.toFixed(4))
  };
}

module.exports = {
  DEFAULTS,
  evaluateWatchlistOpportunity,
  notificationDedupeKey,
  floorTimeBucketUtc
};
