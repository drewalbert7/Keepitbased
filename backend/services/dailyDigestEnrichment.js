/**
 * Deterministic watchlist + headline enrichment when Grok daily digest falls back to template.
 */

function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function isGrokFallbackDigest(digest, runMetadata) {
  if (runMetadata?.fallbackUsed === true) return true;
  const disclaimer = String(digest?.disclaimer || '').toLowerCase();
  return disclaimer.includes('llm unavailable') || disclaimer.includes('template digest');
}

/**
 * @param {Record<string, unknown>} digest
 * @param {Record<string, unknown>} watchlistContext
 * @param {Array<object>} [researchArtifacts]
 * @param {Record<string, unknown>} [runMetadata]
 */
function enrichDigestFromWatchlist(digest, watchlistContext, researchArtifacts = [], runMetadata = {}) {
  const items = Array.isArray(watchlistContext?.items) ? watchlistContext.items : [];
  if (!items.length) return digest;

  const fallback = isGrokFallbackDigest(digest, runMetadata);

  const dayChanges = items
    .map((it) => it.dayChangePct)
    .filter((v) => v != null && Number.isFinite(Number(v)));
  const avgDay =
    dayChanges.length > 0 ? dayChanges.reduce((a, b) => a + Number(b), 0) / dayChanges.length : null;

  const dipNames = items
    .filter((it) => Number(it.dropPctFromBaseline) >= Number(it.thresholds?.small || 0))
    .map((it) => String(it.symbol || '').toUpperCase())
    .filter(Boolean);

  const upNames = items
    .filter((it) => Number(it.dayChangePct) > 0.5)
    .map((it) => String(it.symbol || '').toUpperCase())
    .filter(Boolean)
    .slice(0, 6);

  const downNames = items
    .filter((it) => Number(it.dayChangePct) < -0.5)
    .map((it) => String(it.symbol || '').toUpperCase())
    .filter(Boolean)
    .slice(0, 6);

  let macro = String(digest.macroAnalysis || '').trim();
  if (fallback || !macro || macro.length < 80) {
    const tone =
      avgDay == null
        ? 'Mixed session — reconcile each name against index trend and your baseline.'
        : avgDay >= 0.75
          ? `Your tracked names averaged ${fmtPct(avgDay)} today — risk-on tone among holdings.`
          : avgDay <= -0.75
            ? `Your tracked names averaged ${fmtPct(avgDay)} today — defensive positioning may dominate.`
            : `Your tracked names averaged ${fmtPct(avgDay)} today — a balanced session without extreme breadth.`;
    macro = `${tone} Macro backdrop still hinges on rates, liquidity, and headline risk — verify catalysts independently.`;
  }

  let overview = String(digest.marketOverview || '').trim();
  if (fallback || !overview || overview.length < 60) {
    const parts = [];
    if (upNames.length) parts.push(`Leaders today: ${upNames.join(', ')}.`);
    if (downNames.length) parts.push(`Laggards today: ${downNames.join(', ')}.`);
    if (dipNames.length) parts.push(`At or past dip bands vs baseline: ${dipNames.join(', ')}.`);
    overview =
      parts.join(' ') ||
      'Session tone inferred from your watchlist quotes — open charts for full tape context.';
  }

  const holdingLines = items.slice(0, 14).map((it) => {
    const sym = String(it.symbol || '').toUpperCase();
    const px = it.currentPrice != null ? `$${Number(it.currentPrice).toFixed(2)}` : 'n/a';
    const day = fmtPct(it.dayChangePct);
    const vsBase = fmtPct(it.dropPctFromBaseline);
    const tier = it.sizing?.tierLabel || it.sizing?.phase || 'watching';
    const bits = [`${sym} ${px}`];
    if (day) bits.push(`${day} today`);
    if (vsBase != null) bits.push(`${vsBase} vs baseline`);
    bits.push(`band: ${tier}`);
    return bits.join(' · ');
  });

  let holdings = String(digest.holdingsAnalysis || '').trim();
  if (fallback || !holdings || holdings.length < 80 || holdings.includes('Tracked alerts:')) {
    holdings = `Snapshot for ${items.length} monitored name(s):\n${holdingLines.join('\n')}\n\nSizing bands use your configured dip thresholds and max position % — educational only.`;
  }

  let newsHighlights = Array.isArray(digest.newsHighlights) ? [...digest.newsHighlights] : [];
  if (newsHighlights.length < 2 && Array.isArray(researchArtifacts)) {
    for (const art of researchArtifacts.slice(0, 6)) {
      if (!art || typeof art !== 'object') continue;
      const title = String(art.title || art.Title || '').trim();
      if (!title) continue;
      if (newsHighlights.some((n) => n.title === title)) continue;
      newsHighlights.push({
        title: title.slice(0, 280),
        symbol: String(art.symbol || '').toUpperCase().slice(0, 10),
        takeaway: String(art.contentSummary || art.content_summary || art.summary || '').slice(0, 220)
      });
      if (newsHighlights.length >= 6) break;
    }
  }

  return {
    ...digest,
    macroAnalysis: macro,
    marketOverview: overview,
    holdingsAnalysis: holdings,
    newsHighlights: newsHighlights.slice(0, 8),
    enrichedFromWatchlist: true
  };
}

module.exports = {
  enrichDigestFromWatchlist,
  isGrokFallbackDigest
};
