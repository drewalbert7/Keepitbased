/**
 * Merge stored JSONB with defaults so older rows stay valid as we add keys.
 *
 * §11 research+dip prefs:
 * - researchDigestEmail: when true with dipInsightEmail, Grok dip email requires ≥1 `research_artifacts` row (lookback RESEARCH_FUSION_LOOKBACK_HOURS); else plain opportunity email
 * - researchMaxEmailsPerDay: cap for fused digests
 *
 * Opportunity email: quiet hours + daily cap (see opportunityEmailPolicy.js).
 * Legacy `researchQuietHoursLocal` is stripped if present.
 */
function mergeNotificationPreferences(raw) {
  const p =
    raw != null && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  delete p.researchQuietHoursLocal;

  const enableDipInsight = process.env.ENABLE_DIP_INSIGHT_EMAIL === 'true';

  return {
    email: p.email !== false,
    push: p.push !== false,
    opportunityToasts: p.opportunityToasts !== false,
    /** Opt-out: unset defaults to on (fusion gate applies when enabled). */
    researchDigestEmail: p.researchDigestEmail !== false,
    researchMaxEmailsPerDay: clampInt(p.researchMaxEmailsPerDay, 1, 20, 5),
    /** Max Grok dip-insight emails per UTC day (rich briefing); plain opportunity mail uses opportunityMaxEmailsPerDay. */
    dipInsightMaxEmailsPerDay: clampInt(p.dipInsightMaxEmailsPerDay, 1, 20, 3),
    /** Grok dip briefing email when ENABLE_DIP_INSIGHT_EMAIL=true; opt-in (plain opportunity email is default). */
    dipInsightEmail: enableDipInsight ? p.dipInsightEmail === true : false,
    /** Matches dashboard agent slider default; used to cap suggestedTranchePct server-side. */
    agentMaxPositionSizePct: clampInt(p.agentMaxPositionSizePct, 1, 50, 10),

    /**
     * Legacy 5/10/15% threshold emails (small/medium/large). Opt-in only; opportunity emails are the default path.
     */
    thresholdAlertEmail: p.thresholdAlertEmail === true,

    /** Critical watchlist dip emails (overreaction/capitulation per tier). Default on. */
    opportunityEmail: p.opportunityEmail !== false,

    /**
     * In-app toasts (Socket `opportunitySignal`). When `overreaction_only`, skips `on_sale`-only bursts
     * (still recorded in DB/Signals). Independent from `opportunityEmailNotifyLevel`.
     */
    opportunityNotifyLevel: ['all', 'overreaction_only'].includes(p.opportunityNotifyLevel)
      ? p.opportunityNotifyLevel
      : 'overreaction_only',

    /**
     * Opportunity **email** tier (plain + dip-insight). Default `overreaction_only` for new/unspecified rows.
     * `capitulation_only` = major long-term tier only.
     */
    opportunityEmailNotifyLevel: ['all', 'overreaction_only', 'capitulation_only'].includes(
      p.opportunityEmailNotifyLevel
    )
      ? p.opportunityEmailNotifyLevel
      : 'overreaction_only',

    /** Max opportunity (plain + dip-insight) emails per user per UTC day. */
    opportunityMaxEmailsPerDay: clampInt(p.opportunityMaxEmailsPerDay, 1, 50, 5),

    /** IANA timezone for quiet hours (e.g. America/New_York). */
    timezone:
      typeof p.timezone === 'string' && p.timezone.trim().length > 0
        ? p.timezone.trim()
        : 'America/New_York',

    quietHoursStart:
      typeof p.quietHoursStart === 'string' && /^\d{1,2}:\d{2}$/.test(p.quietHoursStart.trim())
        ? p.quietHoursStart.trim()
        : '22:00',

    quietHoursEnd:
      typeof p.quietHoursEnd === 'string' && /^\d{1,2}:\d{2}$/.test(p.quietHoursEnd.trim())
        ? p.quietHoursEnd.trim()
        : '08:00',

    /** When true (default), defer opportunity emails during quiet hours in `timezone`. */
    opportunityRespectQuietHours: p.opportunityRespectQuietHours !== false,

    /**
     * Opportunity email delivery: `instant` (outbox worker, ~1 min) or `hourly_digest` (batched table email).
     */
    opportunityEmailDeliveryMode:
      p.opportunityEmailDeliveryMode === 'hourly_digest' ? 'hourly_digest' : 'instant',

    /**
     * When true (default), stock opportunity toasts/emails only during US regular session (not crypto).
     * Set false to allow stock notifications 24/7.
     */
    opportunityStockMarketHoursOnly: p.opportunityStockMarketHoursOnly !== false,

    /** Daily Grok watchlist briefing — opt-in (host ENABLE_DAILY_WATCHLIST_DIGEST_EMAIL + cron required). */
    dailyWatchlistDigestEmail: p.dailyWatchlistDigestEmail === true
  };
}

function clampInt(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/**
 * @param {string[]} flags
 * @param {'all' | 'overreaction_only' | 'capitulation_only'} level
 */
function passesOpportunityEmailTierFilter(flags, level) {
  if (level === 'all') return true;
  if (!Array.isArray(flags) || !flags.length) return false;
  if (level === 'capitulation_only') return flags.includes('capitulation');
  if (level === 'overreaction_only') {
    return flags.includes('overreaction') || flags.includes('capitulation');
  }
  return true;
}

module.exports = {
  mergeNotificationPreferences,
  passesOpportunityEmailTierFilter
};
