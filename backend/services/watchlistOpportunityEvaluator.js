/**
 * Deterministic watchlist opportunity signals. Inputs must be tool-backed (quotes, baselines, ATR),
 * not LLM-inferred prices.
 *
 * **ATR mode (default):** “Dip” depth vs user baseline is measured in units of **14-day Wilder ATR**
 * (from daily bars). Same multiple means a more comparable move for low-vol vs high-vol names.
 * If `atr14` is missing, falls back to **percentage** rules for that evaluation.
 *
 * **Capitulation tier** (parallel): long-horizon structural signals using 14d/50d ATR vs a **cap reference**
 * (max of user baseline and trailing 52-week high when available), drawdown from ~52-week high,
 * optional mega-cap ATH drawdown, and a softer 52w fallback. Ignores the short-term trend filter.
 *
 * **Short-tier trend filter (optional):** `on_sale` / `overreaction` may require price &gt; N-day SMA;
 * capitulation does not. ATR “floor” can null out tiny ATR vs price (pennies / bad prints).
 */

const appConfig = require('../config');

/** Legacy snapshot for tests / callers importing DEFAULTS */
const DEFAULTS = {
  onSaleDropPct: 5,
  overreactionDropPct: 12,
  overreactionVolMultiplier: 2,
  triggerMode: 'atr'
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

function mergedConfig(overrides = {}) {
  const fromEnv = {
    onSaleDropPct: appConfig.OPPORTUNITY_ON_SALE_DROP_PCT,
    overreactionDropPct: appConfig.OPPORTUNITY_OVERREACTION_DROP_PCT,
    overreactionVolMultiplier: appConfig.OPPORTUNITY_VOL_SPIKE_MULT,
    onSaleAtrMult: appConfig.OPPORTUNITY_ON_SALE_ATR_MULT,
    overreactionAtrMult: appConfig.OPPORTUNITY_OVERREACTION_ATR_MULT,
    triggerMode: appConfig.OPPORTUNITY_TRIGGER_MODE || 'atr',
    capitulationAtr14Mult: appConfig.OPPORTUNITY_CAPITULATION_ATR14_MULT,
    capitulationAtr50Mult: appConfig.OPPORTUNITY_CAPITULATION_ATR50_MULT,
    capitulationFrom52wPct: appConfig.OPPORTUNITY_CAPITULATION_FROM_52W_PCT,
    capitulationFallback52wPct: appConfig.OPPORTUNITY_CAPITULATION_FALLBACK_52W_PCT,
    capitulationMegaCapAthPct: appConfig.OPPORTUNITY_CAPITULATION_MEGA_CAP_ATH_PCT,
    megaCapSymbols: appConfig.OPPORTUNITY_MEGA_CAP_SYMBOLS,
    shortTrendFilterEnabled: appConfig.OPPORTUNITY_SHORT_TREND_FILTER_ENABLED,
    shortTrendSmaDays: appConfig.OPPORTUNITY_SHORT_TREND_SMA_DAYS,
    atrMinPctOfPrice: appConfig.OPPORTUNITY_ATR_MIN_PCT_OF_PRICE
  };
  return {
    ...fromEnv,
    ...overrides,
    onSaleDropPct: overrides.onSaleDropPct ?? fromEnv.onSaleDropPct,
    overreactionDropPct: overrides.overreactionDropPct ?? fromEnv.overreactionDropPct,
    overreactionVolMultiplier: overrides.overreactionVolMultiplier ?? fromEnv.overreactionVolMultiplier,
    onSaleAtrMult: overrides.onSaleAtrMult ?? fromEnv.onSaleAtrMult,
    overreactionAtrMult: overrides.overreactionAtrMult ?? fromEnv.overreactionAtrMult,
    triggerMode: overrides.triggerMode || fromEnv.triggerMode || 'atr',
    capitulationAtr14Mult: overrides.capitulationAtr14Mult ?? fromEnv.capitulationAtr14Mult,
    capitulationAtr50Mult: overrides.capitulationAtr50Mult ?? fromEnv.capitulationAtr50Mult,
    capitulationFrom52wPct: overrides.capitulationFrom52wPct ?? fromEnv.capitulationFrom52wPct,
    capitulationFallback52wPct: overrides.capitulationFallback52wPct ?? fromEnv.capitulationFallback52wPct,
    capitulationMegaCapAthPct: overrides.capitulationMegaCapAthPct ?? fromEnv.capitulationMegaCapAthPct,
    megaCapSymbols: overrides.megaCapSymbols ?? fromEnv.megaCapSymbols,
    shortTrendFilterEnabled:
      overrides.shortTrendFilterEnabled ?? fromEnv.shortTrendFilterEnabled,
    shortTrendSmaDays: overrides.shortTrendSmaDays ?? fromEnv.shortTrendSmaDays,
    atrMinPctOfPrice: overrides.atrMinPctOfPrice ?? fromEnv.atrMinPctOfPrice
  };
}

/**
 * @param {number|null} atr
 * @param {number} price
 * @param {number} minPctOfPrice - ATR as % of price (e.g. 0.05 = 0.05%); 0 = off
 */
function effectiveAtrForRules(atr, price, minPctOfPrice) {
  if (atr == null || !Number.isFinite(Number(atr)) || !(Number(atr) > 0)) return null;
  if (!(price > 0)) return null;
  const mp = Number(minPctOfPrice);
  if (!Number.isFinite(mp) || mp <= 0) return Number(atr);
  const pct = (Number(atr) / price) * 100;
  return pct >= mp ? Number(atr) : null;
}

/**
 * @param {object} input
 * @param {string} input.symbol
 * @param {number} input.price - last trade / snapshot price
 * @param {number} input.baselinePrice - user's reference (e.g. alert baseline or fair-value midpoint)
 * @param {'stock'|'crypto'} [input.assetType]
 * @param {number} [input.dayChangePct] - session or 24h change %
 * @param {number} [input.recentAbsAvgMovePct] - e.g. avg absolute daily move over N sessions (same symbol)
 * @param {number|null} [input.atr14] - 14-day Wilder ATR (daily), same units as price
 * @param {number|null} [input.atr50] - 50-day Wilder ATR (daily)
 * @param {number|null} [input.week52High] - trailing ~52-week daily high
 * @param {number|null} [input.athHigh] - session ATH proxy (max daily high over long window)
 * @param {number|null} [input.smaTrend] - SMA of closes over OPPORTUNITY_SHORT_TREND_SMA_DAYS sessions
 * @param {object} [overrides] - optional evaluator tuning (tests) or skipCapitulation / skipShortTiers for dedupe splits
 */
function evaluateWatchlistOpportunity(input, overrides = {}) {
  const c = mergedConfig(overrides);
  const skipShortTiers = overrides.skipShortTiers === true;
  const skipCapitulation = overrides.skipCapitulation === true;

  const symbol = String(input.symbol || '').toUpperCase();
  const assetType = input.assetType === 'crypto' ? 'crypto' : 'stock';
  const price = Number(input.price);
  const baselinePrice = Number(input.baselinePrice);

  const flags = [];
  const reasons = [];

  if (!(baselinePrice > 0) || !(price > 0)) {
    return { symbol, flags: [], reasons: [], evaluated: false };
  }

  const vsBaselinePct = ((price - baselinePrice) / baselinePrice) * 100;

  const mode = String(c.triggerMode || 'atr').toLowerCase() === 'pct' ? 'pct' : 'atr';
  const atrRaw =
    input.atr14 != null && Number.isFinite(Number(input.atr14)) ? Number(input.atr14) : null;
  const atr50Raw =
    input.atr50 != null && Number.isFinite(Number(input.atr50)) ? Number(input.atr50) : null;
  const atr = effectiveAtrForRules(atrRaw, price, c.atrMinPctOfPrice);
  const atr50 = effectiveAtrForRules(atr50Raw, price, c.atrMinPctOfPrice);
  const smaTrend =
    input.smaTrend != null && Number.isFinite(Number(input.smaTrend))
      ? Number(input.smaTrend)
      : null;
  const trendDays = Number(c.shortTrendSmaDays) || 200;
  const shortTrendOk =
    !c.shortTrendFilterEnabled || smaTrend == null || price > smaTrend;
  const week52High =
    input.week52High != null && Number.isFinite(Number(input.week52High))
      ? Number(input.week52High)
      : null;
  const athHigh =
    input.athHigh != null && Number.isFinite(Number(input.athHigh)) ? Number(input.athHigh) : null;

  const useAtr =
    !skipShortTiers && mode === 'atr' && atr != null && atr > 0 && price < baselinePrice;

  const dayCh = input.dayChangePct != null ? Number(input.dayChangePct) : null;
  const avgMove = input.recentAbsAvgMovePct != null ? Number(input.recentAbsAvgMovePct) : null;
  const volSpike =
    !skipShortTiers &&
    dayCh != null &&
    !Number.isNaN(dayCh) &&
    avgMove != null &&
    avgMove > 0 &&
    Math.abs(dayCh) >= avgMove * c.overreactionVolMultiplier;

  if (!skipShortTiers) {
    if (useAtr) {
      const dipDollars = baselinePrice - price;
      const atrMult = dipDollars / atr;

      if (shortTrendOk) {
        if (atrMult >= c.onSaleAtrMult) {
          flags.push('on_sale');
          reasons.push(
            `~${atrMult.toFixed(2)}× daily ATR below your alert baseline (on_sale ≥ ${c.onSaleAtrMult}× ATR)`
          );
        }
        if (atrMult >= c.overreactionAtrMult) {
          flags.push('overreaction');
          reasons.push(
            `~${atrMult.toFixed(2)}× daily ATR below your alert baseline (overreaction ≥ ${c.overreactionAtrMult}× ATR)`
          );
        }
        if (!flags.includes('overreaction') && volSpike) {
          flags.push('overreaction');
          reasons.push(
            `Intraday move ${Math.abs(dayCh).toFixed(2)}% vs typical ~${avgMove.toFixed(2)}% (vol spike)`
          );
        }
      }
    } else {
      if (shortTrendOk) {
        if (vsBaselinePct <= -c.onSaleDropPct) {
          flags.push('on_sale');
          reasons.push(
            mode === 'pct'
              ? `Price ${vsBaselinePct.toFixed(2)}% vs baseline (on_sale threshold −${c.onSaleDropPct}%)`
              : `Price ${vsBaselinePct.toFixed(2)}% vs baseline (on_sale −${c.onSaleDropPct}% — ATR unavailable, pct fallback)`
          );
        }

        if (vsBaselinePct <= -c.overreactionDropPct) {
          flags.push('overreaction');
          reasons.push(
            `Vs baseline ${vsBaselinePct.toFixed(2)}% (overreaction threshold −${c.overreactionDropPct}%)`
          );
        } else if (volSpike) {
          flags.push('overreaction');
          reasons.push(
            `Intraday move ${Math.abs(dayCh).toFixed(2)}% vs typical ~${avgMove.toFixed(2)}% (vol spike)`
          );
        }
      }
    }
  }

  /** Capitulation uses structural + ATR legs even when short tiers are in pct mode, if numbers exist. */
  if (!skipCapitulation) {
    const megaList = Array.isArray(c.megaCapSymbols) ? c.megaCapSymbols : [];
    const isMega = assetType === 'stock' && megaList.includes(symbol);

    const capRefPrice =
      week52High != null && week52High > 0
        ? Math.max(baselinePrice, week52High)
        : baselinePrice;

    let dipAtr14Mult = null;
    if (atr != null && atr > 0 && price < capRefPrice) {
      dipAtr14Mult = (capRefPrice - price) / atr;
    }

    let dipAtr50Mult = null;
    if (atr50 != null && atr50 > 0 && price < capRefPrice) {
      dipAtr50Mult = (capRefPrice - price) / atr50;
    }

    let dd52wPct = null;
    if (week52High != null && week52High > 0 && price <= week52High) {
      dd52wPct = ((week52High - price) / week52High) * 100;
    }

    let ddAthPct = null;
    if (isMega && athHigh != null && athHigh > 0 && price <= athHigh) {
      ddAthPct = ((athHigh - price) / athHigh) * 100;
    }

    const hitAtr14 =
      dipAtr14Mult != null && dipAtr14Mult >= c.capitulationAtr14Mult;
    const hitAtr50 =
      dipAtr50Mult != null && dipAtr50Mult >= c.capitulationAtr50Mult;
    const hit52wPrimary = dd52wPct != null && dd52wPct >= c.capitulationFrom52wPct;
    const hitMegaAth =
      isMega && ddAthPct != null && ddAthPct >= c.capitulationMegaCapAthPct;

    const hitAtrLegs = hitAtr14 || hitAtr50;

    const hit52wFallback =
      dd52wPct != null &&
      dd52wPct >= c.capitulationFallback52wPct &&
      !hit52wPrimary &&
      !hitAtrLegs;

    const capitulation =
      hitAtr14 ||
      hitAtr50 ||
      hit52wPrimary ||
      hitMegaAth ||
      hit52wFallback;

    if (capitulation) {
      flags.push('capitulation');
      const capAtrRefLabel =
        week52High != null && week52High > 0
          ? 'max(your baseline, trailing 52-week high)'
          : 'your alert baseline';
      if (hitAtr14) {
        reasons.push(
          `Major capitulation: ~${dipAtr14Mult.toFixed(2)}× 14-day ATR below ${capAtrRefLabel} (≥ ${c.capitulationAtr14Mult}×)`
        );
      }
      if (hitAtr50) {
        reasons.push(
          `Major capitulation: ~${dipAtr50Mult.toFixed(2)}× 50-day ATR below ${capAtrRefLabel} (≥ ${c.capitulationAtr50Mult}×)`
        );
      }
      if (hit52wPrimary) {
        reasons.push(
          `Major capitulation: ~${dd52wPct.toFixed(2)}% below trailing 52-week high (≥ ${c.capitulationFrom52wPct}%)`
        );
      }
      if (hitMegaAth) {
        reasons.push(
          `Major capitulation (mega-cap): ~${ddAthPct.toFixed(2)}% below session high proxy (≥ ${c.capitulationMegaCapAthPct}% ATH)`
        );
      }
      if (hit52wFallback) {
        reasons.push(
          `Major capitulation: ~${dd52wPct.toFixed(2)}% below 52-week high (fallback ≥ ${c.capitulationFallback52wPct}%)`
        );
      }
    }
  }

  const uniqueFlags = [...new Set(flags)];
  return {
    symbol,
    flags: uniqueFlags,
    reasons,
    evaluated: true,
    vsBaselinePct: Number(vsBaselinePct.toFixed(4)),
    atrUsed: useAtr,
    atrMult:
      useAtr && atr > 0 && price < baselinePrice
        ? Number(((baselinePrice - price) / atr).toFixed(4))
        : null
  };
}

module.exports = {
  DEFAULTS,
  evaluateWatchlistOpportunity,
  notificationDedupeKey,
  floorTimeBucketUtc,
  effectiveAtrForRules
};
