/**
 * Merge stored JSONB with defaults so older rows stay valid as we add keys.
 *
 * §11 research+dip prefs:
 * - researchDigestEmail: when true with dipInsightEmail, Grok dip email requires ≥1 `research_artifacts` row (lookback RESEARCH_FUSION_LOOKBACK_HOURS); else plain opportunity email
 * - researchMaxEmailsPerDay: cap for fused digests
 * - researchQuietHoursLocal: { startHour, endHour } local clock 0–23, overnight supported (start > end)
 * - timezone: IANA tz for quiet hours (fallback UTC)
 */
function mergeNotificationPreferences(raw) {
  const p =
    raw != null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

  const researchQuietHoursLocal =
    p.researchQuietHoursLocal &&
    typeof p.researchQuietHoursLocal === 'object' &&
    !Array.isArray(p.researchQuietHoursLocal)
      ? {
          startHour: clampHour(p.researchQuietHoursLocal.startHour),
          endHour: clampHour(p.researchQuietHoursLocal.endHour)
        }
      : { startHour: 22, endHour: 7 };

  const enableDipInsight = process.env.ENABLE_DIP_INSIGHT_EMAIL === 'true';

  return {
    email: p.email !== false,
    push: p.push !== false,
    opportunityToasts: p.opportunityToasts !== false,
    researchDigestEmail: p.researchDigestEmail === true,
    researchMaxEmailsPerDay: clampInt(p.researchMaxEmailsPerDay, 1, 20, 5),
    researchQuietHoursLocal,
    timezone:
      typeof p.timezone === 'string' && p.timezone.trim().length > 0
        ? p.timezone.trim()
        : 'UTC',
    /** Grok dip briefing email when ENABLE_DIP_INSIGHT_EMAIL=true; default on under flag. */
    dipInsightEmail: enableDipInsight ? p.dipInsightEmail !== false : false,
    /** Matches dashboard agent slider default; used to cap suggestedTranchePct server-side. */
    agentMaxPositionSizePct: clampInt(p.agentMaxPositionSizePct, 1, 50, 10),

    /** Opportunity signal emails (dip notifications); independent gate from generic marketing email. Default on. */
    opportunityEmail: p.opportunityEmail !== false,

    /**
     * In-app toasts (Socket `opportunitySignal`). When `overreaction_only`, skips `on_sale`-only bursts
     * (still recorded in DB/Signals). Independent from `opportunityEmailNotifyLevel`.
     */
    opportunityNotifyLevel: ['all', 'overreaction_only'].includes(p.opportunityNotifyLevel)
      ? p.opportunityNotifyLevel
      : 'all',

    /**
     * Opportunity **email** tier (plain + dip-insight). Default `overreaction_only` = no inbox mail for
     * small `on_sale`-only signals. `capitulation_only` = major long-term tier only.
     */
    opportunityEmailNotifyLevel: ['all', 'overreaction_only', 'capitulation_only'].includes(
      p.opportunityEmailNotifyLevel
    )
      ? p.opportunityEmailNotifyLevel
      : 'overreaction_only',

    /** When true (default), skip opportunity emails during researchQuietHoursLocal in prefs.timezone. */
    opportunityRespectQuietHours: p.opportunityRespectQuietHours !== false,

    /**
     * When true (default), stock opportunity toasts/emails only during US regular session (not crypto).
     * Set false to allow stock notifications 24/7 (still subject to quiet hours for email).
     */
    opportunityStockMarketHoursOnly: p.opportunityStockMarketHoursOnly !== false,

    /**
     * Daily batched email: Grok overview of Main watchlist + suggested names (requires server ENABLE_*).
     */
    dailyWatchlistDigestEmail: p.dailyWatchlistDigestEmail === true
  };
}

function clampHour(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(23, Math.max(0, Math.round(n)));
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
