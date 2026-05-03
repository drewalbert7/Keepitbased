const { getRedisClient } = require('../utils/redis');
const logger = require('../utils/logger');
const { watchlistService } = require('./watchlistService');
const PriceMonitor = require('./priceMonitor');
const { getOpportunityTechnicalBundle } = require('./dailyAtrService');

/**
 * Enrich user alerts with cached prices and staged buy-sizing hints vs dip thresholds.
 * Not investment advice — educational sizing tied to user max position %.
 */

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function computeSizingPhase({
  dropPct,
  smallTh,
  mediumTh,
  largeTh,
  maxPositionPct,
  active
}) {
  if (!active) {
    return {
      phase: 'paused',
      suggestedPortfolioPct: 0,
      tierLabel: 'Paused',
      rationale:
        'This symbol is paused — re-enable monitoring in your watchlist or settings when ready.'
    };
  }

  if (dropPct == null || Number.isNaN(dropPct)) {
    return {
      phase: 'unknown',
      suggestedPortfolioPct: 0,
      tierLabel: 'No quote',
      rationale: 'Waiting for a live price in cache.'
    };
  }

  // Above baseline = not "on sale" vs baseline
  if (dropPct < 0) {
    return {
      phase: 'above_baseline',
      suggestedPortfolioPct: 0,
      tierLabel: 'Above baseline',
      rationale: `Price is ${Math.abs(dropPct).toFixed(2)}% above your baseline — no dip-buy band active vs baseline.`
    };
  }

  if (dropPct < smallTh) {
    const gap = smallTh - dropPct;
    return {
      phase: 'watch',
      suggestedPortfolioPct: 0,
      tierLabel: 'Watching',
      rationale: `Not yet at your smallest dip band (${smallTh}%). Need ~${gap.toFixed(2)}% more dip from baseline before scaling in.`
    };
  }

  const base = clamp(Number(maxPositionPct) || 10, 1, 50);

  if (dropPct >= largeTh) {
    return {
      phase: 'full_band',
      suggestedPortfolioPct: base,
      tierLabel: 'Large dip band',
      rationale: `At or past your large threshold (${largeTh}%): sizing uses your full max position (${base}% of portfolio).`
    };
  }

  if (dropPct >= mediumTh) {
    return {
      phase: 'accumulate_medium',
      suggestedPortfolioPct: Number((base * 0.66).toFixed(2)),
      tierLabel: 'Medium dip band',
      rationale: `Between medium (${mediumTh}%) and large (${largeTh}%): consider scaling in — suggested up to ~66% of your max (${base}%) ≈ ${(base * 0.66).toFixed(2)}% of portfolio.`
    };
  }

  return {
    phase: 'accumulate_small',
    suggestedPortfolioPct: Number((base * 0.33).toFixed(2)),
    tierLabel: 'Small dip band',
    rationale: `Past small (${smallTh}%) but below medium (${mediumTh}%): starter scale — suggested ~33% of max (${base}%) ≈ ${(base * 0.33).toFixed(2)}% of portfolio.`
  };
}

function nextThresholdGap(dropPct, smallTh, mediumTh, largeTh) {
  if (dropPct == null || Number.isNaN(dropPct)) return null;
  if (dropPct < 0) return null;
  if (dropPct < smallTh) return { next: 'small', pctRemaining: smallTh - dropPct };
  if (dropPct < mediumTh) return { next: 'medium', pctRemaining: mediumTh - dropPct };
  if (dropPct < largeTh) return { next: 'large', pctRemaining: largeTh - dropPct };
  return null;
}

/** Match keys used by PriceMonitor / watchlist warm (lowercase asset, uppercase symbol). */
function redisPriceKey(assetType, symbol) {
  return `price:${String(assetType).toLowerCase()}:${String(symbol || '').toUpperCase()}`;
}

/**
 * Read Redis cache; on miss, pull a snapshot from Massive/Polygon (same as charts) and cache.
 * Avoids empty dashboard rows when cron has not run yet or cache expired.
 */
async function getPricePayloadForRow(redis, assetType, symbol) {
  const key = redisPriceKey(assetType, symbol);
  try {
    const raw = await redis.get(key);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    logger.warn(`watchlist-context redis get ${key}`, e.message);
  }

  const typ = String(assetType).toLowerCase();
  const sym = String(symbol || '').toUpperCase();
  if (!sym) return null;

  const pm = new PriceMonitor(null);
  try {
    let pd = null;
    if (typ === 'stock') {
      pd = await pm.getStockPrice(sym);
    } else if (typ === 'crypto') {
      pd = await pm.getCryptoPrice(sym);
    } else {
      return null;
    }
    if (pd && pd.price != null && Number.isFinite(Number(pd.price))) {
      const cacheKey = redisPriceKey(pd.type || typ, pd.symbol || sym);
      try {
        await redis.setEx(cacheKey, 300, JSON.stringify(pd));
      } catch (redisErr) {
        logger.warn(`watchlist-context cache set failed ${cacheKey}: ${redisErr.message}`);
      }
      return pd;
    }
  } catch (e) {
    logger.warn(`watchlist-context on-demand quote failed ${typ}:${sym}`, e.message);
  }
  return null;
}

/**
 * @param {object} params
 * @param {import('../services/alertService')} params.alertService
 * @param {number} params.userId
 * @param {number} params.maxPositionPct
 */
async function buildAgentWatchlistContext({ alertService, userId, maxPositionPct }) {
  const redis = getRedisClient();
  const alerts = await alertService.getUserAlerts(userId);
  const allowedKeys = await watchlistService.getAllowedAlertKeys(userId);

  const items = [];

  for (const row of alerts) {
    const key = `${String(row.asset_type).toLowerCase()}:${String(row.symbol || '').toUpperCase()}`;
    if (!allowedKeys.has(key)) continue;
    const assetType = row.asset_type;
    const symbol = String(row.symbol || '').toUpperCase();
    const baseline = row.baseline_price != null ? Number(row.baseline_price) : null;
    const smallTh = Number(row.small_threshold);
    const mediumTh = Number(row.medium_threshold);
    const largeTh = Number(row.large_threshold);
    const active = Boolean(row.active);

    let currentPrice = null;
    let quoteAgeSec = null;
    let priceUnavailableReason = null;
    let dayChangePct = null;
    let dayChangeAbs = null;
    let dayHigh = null;
    let dayLow = null;
    let volume = null;
    let prevClose = null;

    try {
      const priceData = await getPricePayloadForRow(redis, assetType, symbol);
      if (priceData) {
        currentPrice = Number(priceData.price);
        const ts = priceData.timestamp || priceData.ts;
        if (ts) {
          quoteAgeSec = Math.max(0, Math.round((Date.now() - Number(ts)) / 1000));
        }
        if (priceData.changePercent != null && Number.isFinite(Number(priceData.changePercent))) {
          dayChangePct = Number(priceData.changePercent);
        }
        if (priceData.change24h != null && Number.isFinite(Number(priceData.change24h))) {
          dayChangeAbs = Number(priceData.change24h);
        }
        const at = String(assetType).toLowerCase();
        if (at === 'crypto' && dayChangePct == null && priceData.change24h != null) {
          dayChangePct = Number(priceData.change24h);
        }
        if (priceData.dayHigh != null && Number.isFinite(Number(priceData.dayHigh))) {
          dayHigh = Number(priceData.dayHigh);
        }
        if (priceData.dayLow != null && Number.isFinite(Number(priceData.dayLow))) {
          dayLow = Number(priceData.dayLow);
        }
        if (priceData.volume != null && Number.isFinite(Number(priceData.volume))) {
          volume = Number(priceData.volume);
        }
        if (priceData.prevClose != null && Number.isFinite(Number(priceData.prevClose))) {
          prevClose = Number(priceData.prevClose);
        }
      } else {
        priceUnavailableReason = 'quote_unavailable';
      }
    } catch (e) {
      logger.warn(`watchlist-context price read failed for ${assetType}:${symbol}`, e.message);
      priceUnavailableReason = 'redis_error';
    }

    let dropPctFromBaseline = null;
    if (baseline != null && baseline > 0 && currentPrice != null && Number.isFinite(currentPrice)) {
      dropPctFromBaseline = ((baseline - currentPrice) / baseline) * 100;
    }

    const sizing = computeSizingPhase({
      dropPct: dropPctFromBaseline,
      smallTh,
      mediumTh,
      largeTh,
      maxPositionPct,
      active
    });

    const gap = nextThresholdGap(dropPctFromBaseline, smallTh, mediumTh, largeTh);

    const itemPayload = {
      alertId: row.id,
      symbol,
      assetType,
      active,
      thresholds: {
        small: smallTh,
        medium: mediumTh,
        large: largeTh
      },
      baselinePrice: baseline,
      currentPrice,
      dayChangePct,
      dayChangeAbs,
      quoteAgeSec,
      priceUnavailableReason,
      dropPctFromBaseline:
        dropPctFromBaseline != null && Number.isFinite(dropPctFromBaseline)
          ? Number(dropPctFromBaseline.toFixed(4))
          : null,
      nextThresholdGap: gap,
      sizing: {
        phase: sizing.phase,
        tierLabel: sizing.tierLabel,
        suggestedPortfolioPct: sizing.suggestedPortfolioPct,
        rationale: sizing.rationale
      }
    };
    if (dayHigh != null) itemPayload.dayHigh = dayHigh;
    if (dayLow != null) itemPayload.dayLow = dayLow;
    if (volume != null) itemPayload.volume = volume;
    if (prevClose != null) itemPayload.prevClose = prevClose;
    items.push(itemPayload);
  }

  const policyNote =
    'Sizing hints scale off your Max position size % in Agent Controls. For dollar amounts, ask the assistant in chat with your total deployable capital — it can relate Size % and signal tier to illustrative allocations. Not investment advice.';

  /** Small batches reduce upstream 429s when many symbols each pull a daily bundle. */
  const itemsWithRange = [];
  const batchSize = 3;
  for (let i = 0; i < items.length; i += batchSize) {
    const slice = items.slice(i, i + batchSize);
    const chunk = await Promise.all(
      slice.map(async (it) => {
        const at = String(it.assetType || '').toLowerCase();
        if (at !== 'stock' && at !== 'crypto') {
          return it;
        }
        try {
          const b = await getOpportunityTechnicalBundle(it.symbol, at === 'crypto' ? 'crypto' : 'stock', redis);
          const out = { ...it };
          if (b.week52High != null && Number.isFinite(b.week52High)) out.week52High = b.week52High;
          if (b.week52Low != null && Number.isFinite(b.week52Low)) out.week52Low = b.week52Low;
          return out;
        } catch (e) {
          logger.warn(`watchlist-context 52w bundle failed ${at}:${it.symbol}`, e.message);
          return it;
        }
      })
    );
    itemsWithRange.push(...chunk);
    if (i + batchSize < items.length) {
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    maxPositionPct: clamp(Number(maxPositionPct) || 10, 1, 50),
    policyNote,
    items: itemsWithRange
  };
}

/**
 * Plain-markdown digest for agent chat when LangGraph is off or unreachable (mirrors Python formatter).
 */
function formatWatchlistDigestMarkdown(payload) {
  if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
    return '';
  }
  const lines = ['**Your watchlist & sizing (dashboard)**', ''];
  for (const it of payload.items.slice(0, 25)) {
    const sym = String(it.symbol || '').toUpperCase();
    const at = it.assetType || 'stock';
    const sz = it.sizing || {};
    const tier = sz.tierLabel || '';
    const sug = sz.suggestedPortfolioPct;
    const live = it.currentPrice;
    const drop = it.dropPctFromBaseline;
    const bits = [`- **${sym}** (${at})`];
    if (live != null && Number.isFinite(Number(live))) {
      bits.push(`live ~$${Number(live).toFixed(Number(live) >= 100 ? 2 : 4)}`);
    }
    if (drop != null && Number.isFinite(Number(drop))) {
      bits.push(`vs baseline ${Number(drop) >= 0 ? '' : '+'}${Math.abs(Number(drop)).toFixed(2)}%`);
    }
    if (tier) bits.push(tier);
    if (sug != null && Number.isFinite(Number(sug))) bits.push(`suggested up to **${Number(sug)}%** of portfolio`);
    lines.push(bits.join(' · '));
    if (sz.rationale) lines.push(`  _${sz.rationale}_`);
  }
  if (payload.policyNote) lines.push('', String(payload.policyNote));
  if (payload.maxPositionPct != null) {
    lines.push(`\n_Max position sizing reference: **${payload.maxPositionPct}%** (educational)._`);
  }
  lines.push(
    '',
    '_**Allocation:** State **total deployable capital** (USD) in your next message if you want dollar-sized suggestions; the assistant uses Size % and alert tier together with that figure — not a trade instruction._'
  );
  return lines.join('\n');
}

module.exports = {
  buildAgentWatchlistContext,
  computeSizingPhase,
  formatWatchlistDigestMarkdown
};
