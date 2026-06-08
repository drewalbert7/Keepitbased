const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const { resolveQuantAgiBaseUrl } = require('../utils/quantAgiBaseUrl');

/** Strategies included in daily digest Quant AGI section (order = email section order). */
const DAILY_DIGEST_QUANT_STRATEGIES = [
  'rule_breaker_gardner',
  'rule_breaker_gardner_early',
  'photonics_chokepoint'
];

const STRATEGY_META = {
  rule_breaker_gardner: {
    id: 'rule_breaker_gardner',
    label: 'David Gardner Rule Breaker',
    shortLabel: 'Rule Breaker',
    sectionTitle: 'David Gardner Rule Breaker (large-cap quality)'
  },
  rule_breaker_gardner_early: {
    id: 'rule_breaker_gardner_early',
    label: 'David Gardner Rule Breaker — Early / lower cap',
    shortLabel: 'Gardner Early',
    sectionTitle: 'David Gardner Early — lower market cap, massive upside'
  },
  photonics_chokepoint: {
    id: 'photonics_chokepoint',
    label: 'AI & photonics chokepoint',
    shortLabel: 'Chokepoint',
    sectionTitle: 'AI & photonics chokepoint'
  }
};

async function fetchMarketUniverseRank({ strategy, topN = 12, timeoutMs }) {
  const base = resolveQuantAgiBaseUrl();
  const n = Math.max(5, Math.min(50, Number(topN) || 12));
  const timeout = Number.isFinite(timeoutMs) ? timeoutMs : config.QUANT_AGI_RANK_TIMEOUT_MS;

  try {
    const { data } = await axios.get(`${base}/diag/market-universe-rank`, {
      params: { strategy, top_n: n },
      timeout,
      validateStatus: (s) => s >= 200 && s < 300
    });
    return data && typeof data === 'object' ? data : null;
  } catch (err) {
    logger.warn(
      `Quant AGI rank skipped (${strategy}): ${err.code || err.name || 'error'} ${err.message || ''}`.trim()
    );
    return null;
  }
}

function filterMomentumFromExplanations(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.filter((line) => {
    const s = String(line || '').trim();
    if (!s) return false;
    if (/^tape context:/i.test(s)) return false;
    if (/^tape:/i.test(s)) return false;
    if (/tier score.*context only/i.test(s)) return false;
    if (/momentum_liquidity/i.test(s)) return false;
    if (/legacy_momentum/i.test(s)) return false;
    if (/mom20|momentum_20d|vol20|dd60/i.test(s) && /tape|context only|cached\/synthetic history/i.test(s)) {
      return false;
    }
    return true;
  });
}

function normalizeRankRow(row, strategyId) {
  if (!row || typeof row !== 'object') return null;
  const sym = String(row.symbol || '')
    .trim()
    .toUpperCase();
  if (!sym) return null;

  const meta = STRATEGY_META[strategyId] || {
    id: strategyId,
    label: strategyId,
    shortLabel: strategyId,
    sectionTitle: strategyId
  };
  const why = filterMomentumFromExplanations(
    Array.isArray(row.why) ? row.why.map((w) => String(w).trim()).filter(Boolean) : []
  );
  const sf = row.strategy_factors && typeof row.strategy_factors === 'object' ? row.strategy_factors : {};

  let breakdownLines = [];
  if (
    (strategyId === 'rule_breaker_gardner' || strategyId === 'rule_breaker_gardner_early') &&
    Array.isArray(sf.breakdown)
  ) {
    breakdownLines = sf.breakdown
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const key = String(item.element_key || item.book_criterion || 'leg').trim();
        const score = Number(item.score_0_100);
        return Number.isFinite(score) ? `${key}: ${Math.round(score)}/100` : key;
      })
      .filter(Boolean);
  }

  const marketCapUsd =
    sf.market_cap_usd != null && Number.isFinite(Number(sf.market_cap_usd))
      ? Number(sf.market_cap_usd)
      : null;

  return {
    symbol: sym,
    strategy: strategyId,
    strategyLabel: meta.label,
    strategyShortLabel: meta.shortLabel,
    sectionTitle: meta.sectionTitle,
    score: Number.isFinite(Number(row.score)) ? Number(row.score) : null,
    positionHint: String(row.position_hint || '').trim() || null,
    companyName: String(sf.companyName || row.companyName || '').trim() || null,
    marketCapUsd,
    lastClose: Number.isFinite(Number(row.last_close)) ? Number(row.last_close) : null,
    dayChangePct: Number.isFinite(Number(row.day_change_pct)) ? Number(row.day_change_pct) : null,
    explanations: why,
    breakdownLines,
    themeHits:
      strategyId === 'photonics_chokepoint' && Array.isArray(sf.theme_hits)
        ? sf.theme_hits.map((t) => String(t).trim()).filter(Boolean)
        : []
  };
}

function preferOffWatchlist(rows, watchlistSymbols) {
  const watch = new Set(
    watchlistSymbols.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean)
  );
  const off = rows.filter((r) => !watch.has(r.symbol));
  const on = rows.filter((r) => watch.has(r.symbol));
  return [...off, ...on];
}

/**
 * Top N picks per strategy (prefer off-watchlist within each strategy).
 */
function pickTopPerStrategy({ rankPayloadsByStrategy, watchlistSymbols = [], perStrategy = 3 }) {
  const per = Math.max(1, Math.min(8, Number(perStrategy) || 3));
  const sections = [];

  for (const strategyId of DAILY_DIGEST_QUANT_STRATEGIES) {
    const rows = Array.isArray(rankPayloadsByStrategy[strategyId]?.positions)
      ? rankPayloadsByStrategy[strategyId].positions
      : [];
    const normalized = rows
      .map((r) => normalizeRankRow(r, strategyId))
      .filter(Boolean);
    const queue = preferOffWatchlist(normalized, watchlistSymbols);
    const picks = [];
    const localSeen = new Set();

    for (const row of queue) {
      if (picks.length >= per) break;
      if (localSeen.has(row.symbol)) continue;
      localSeen.add(row.symbol);
      picks.push(row);
    }

    sections.push({
      strategy: strategyId,
      sectionTitle: STRATEGY_META[strategyId]?.sectionTitle || strategyId,
      picks
    });
  }

  const suggestions = sections.flatMap((s) => s.picks);
  return { sections, suggestions, perStrategy: per };
}

async function fetchDailyQuantAgiSuggestions(opts = {}) {
  if (config.DAILY_DIGEST_QUANT_AGI_SUGGESTIONS === false) {
    return { suggestions: [], sections: [], meta: { skipped: true, reason: 'disabled' } };
  }

  const perStrategy =
    opts.perStrategy ??
    config.DAILY_DIGEST_QUANT_AGI_PER_STRATEGY ??
    config.DAILY_DIGEST_QUANT_AGI_MIN_SUGGESTIONS;
  const topN = config.DAILY_DIGEST_QUANT_AGI_RANK_TOP_N;
  const timeoutMs = config.QUANT_AGI_RANK_TIMEOUT_MS;

  const payloads = await Promise.all(
    DAILY_DIGEST_QUANT_STRATEGIES.map((strategy) =>
      fetchMarketUniverseRank({ strategy, topN, timeoutMs }).then((payload) => ({ strategy, payload }))
    )
  );

  const rankPayloadsByStrategy = {};
  const counts = {};
  for (const { strategy, payload } of payloads) {
    rankPayloadsByStrategy[strategy] = payload;
    counts[strategy] = Array.isArray(payload?.positions) ? payload.positions.length : 0;
  }

  if (DAILY_DIGEST_QUANT_STRATEGIES.every((s) => !counts[s])) {
    return {
      suggestions: [],
      sections: [],
      meta: {
        skipped: true,
        reason: 'rank_unavailable',
        baseUrl: resolveQuantAgiBaseUrl(),
        counts
      }
    };
  }

  const merged = pickTopPerStrategy({
    rankPayloadsByStrategy,
    watchlistSymbols: opts.watchlistSymbols || [],
    perStrategy
  });

  return {
    suggestions: merged.suggestions,
    sections: merged.sections,
    meta: {
      generatedAt: new Date().toISOString(),
      baseUrl: resolveQuantAgiBaseUrl(),
      perStrategy: merged.perStrategy,
      strategies: DAILY_DIGEST_QUANT_STRATEGIES,
      counts,
      returned: merged.suggestions.length,
      returnedBySection: merged.sections.map((s) => ({
        strategy: s.strategy,
        count: s.picks.length
      }))
    }
  };
}

module.exports = {
  DAILY_DIGEST_QUANT_STRATEGIES,
  STRATEGY_META,
  resolveQuantAgiBaseUrl,
  fetchMarketUniverseRank,
  filterMomentumFromExplanations,
  pickTopPerStrategy,
  fetchDailyQuantAgiSuggestions
};
