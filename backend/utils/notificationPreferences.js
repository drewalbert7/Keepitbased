/**
 * Merge stored JSONB with defaults so older rows stay valid as we add keys.
 *
 * §11 research+dip prefs:
 * - researchDigestEmail: when true with dipInsightEmail, Grok dip email requires ≥1 `research_artifacts` row (lookback RESEARCH_FUSION_LOOKBACK_HOURS); else plain opportunity email
 * - researchMaxEmailsPerDay: cap for fused digests
 *
 * Legacy keys `researchQuietHoursLocal`, `timezone`, `opportunityRespectQuietHours` are stripped — we no longer gate sends on quiet hours.
 */
function mergeNotificationPreferences(raw) {
  const p =
    raw != null && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  delete p.opportunityRespectQuietHours;
  delete p.researchQuietHoursLocal;
  delete p.timezone;

  const enableDipInsight = process.env.ENABLE_DIP_INSIGHT_EMAIL === 'true';

  return {
    email: p.email !== false,
    push: p.push !== false,
    opportunityToasts: p.opportunityToasts !== false,
    /** Opt-out: unset defaults to on (fusion gate applies when enabled). */
    researchDigestEmail: p.researchDigestEmail !== false,
    researchMaxEmailsPerDay: clampInt(p.researchMaxEmailsPerDay, 1, 20, 5),
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
     * Opportunity **email** tier (plain + dip-insight). Default `all` = mail for every qualifying tier.
     * `capitulation_only` = major long-term tier only.
     */
    opportunityEmailNotifyLevel: ['all', 'overreaction_only', 'capitulation_only'].includes(
      p.opportunityEmailNotifyLevel
    )
      ? p.opportunityEmailNotifyLevel
      : 'all',

    /**
     * When true (default), stock opportunity toasts/emails only during US regular session (not crypto).
     * Set false to allow stock notifications 24/7.
     */
    opportunityStockMarketHoursOnly: p.opportunityStockMarketHoursOnly !== false,

    /** Daily summary email — opt-out; unset defaults to on (host ENABLE_* + cron still required to send). */
    dailyWatchlistDigestEmail: p.dailyWatchlistDigestEmail !== false
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
