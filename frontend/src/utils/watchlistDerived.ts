/**
 * Mirrors backend `agentWatchlistContext.js` sizing / gap math so WebSocket price
 * patches can refresh dip bands without waiting for the next HTTP poll.
 */
import type { QuoteData } from '../services/chartService';
import type { WatchlistContextResponse, WatchlistSizing } from '../services/aiAgentService';

/** Shape a Chart service quote like a `priceUpdate` row for `mergeWatchlistPriceUpdates`. */
export function chartQuoteToPriceUpdatePayload(q: QuoteData): Record<string, unknown> {
  const ts = Date.parse(q.timestamp);
  return {
    type: 'stock',
    symbol: String(q.symbol || '').toUpperCase(),
    price: q.price,
    changePercent: q.changePercent,
    timestamp: Number.isFinite(ts) ? ts : Date.now(),
    dayHigh: q.high,
    dayLow: q.low,
    volume: q.volume
  };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function computeSizingPhase(params: {
  dropPct: number | null;
  smallTh: number;
  mediumTh: number;
  largeTh: number;
  maxPositionPct: number;
  active: boolean;
}): WatchlistSizing {
  const { dropPct, smallTh, mediumTh, largeTh, maxPositionPct, active } = params;
  if (!active) {
    return {
      phase: 'paused',
      tierLabel: 'Paused',
      suggestedPortfolioPct: 0,
      rationale:
        'This symbol is paused — re-enable monitoring in your watchlist or settings when ready.'
    };
  }
  if (dropPct == null || Number.isNaN(dropPct)) {
    return {
      phase: 'unknown',
      tierLabel: 'No quote',
      suggestedPortfolioPct: 0,
      rationale: 'Waiting for a live price in cache.'
    };
  }
  if (dropPct < 0) {
    return {
      phase: 'above_baseline',
      tierLabel: 'Above baseline',
      suggestedPortfolioPct: 0,
      rationale: `Price is ${Math.abs(dropPct).toFixed(2)}% above your baseline — no dip-buy band active vs baseline.`
    };
  }
  if (dropPct < smallTh) {
    const gap = smallTh - dropPct;
    return {
      phase: 'watch',
      tierLabel: 'Watching',
      suggestedPortfolioPct: 0,
      rationale: `Not yet at your smallest dip band (${smallTh}%). Need ~${gap.toFixed(2)}% more dip from baseline before scaling in.`
    };
  }
  const base = clamp(Number(maxPositionPct) || 10, 1, 50);
  if (dropPct >= largeTh) {
    return {
      phase: 'full_band',
      tierLabel: 'Large dip band',
      suggestedPortfolioPct: base,
      rationale: `At or past your large threshold (${largeTh}%): sizing uses your full max position (${base}% of portfolio).`
    };
  }
  if (dropPct >= mediumTh) {
    return {
      phase: 'accumulate_medium',
      tierLabel: 'Medium dip band',
      suggestedPortfolioPct: Number((base * 0.66).toFixed(2)),
      rationale: `Between medium (${mediumTh}%) and large (${largeTh}%): consider scaling in — suggested up to ~66% of your max (${base}%) ≈ ${(base * 0.66).toFixed(2)}% of portfolio.`
    };
  }
  return {
    phase: 'accumulate_small',
    tierLabel: 'Small dip band',
    suggestedPortfolioPct: Number((base * 0.33).toFixed(2)),
    rationale: `Past small (${smallTh}%) but below medium (${mediumTh}%): starter scale — suggested ~33% of max (${base}%) ≈ ${(base * 0.33).toFixed(2)}% of portfolio.`
  };
}

export function nextThresholdGap(
  dropPct: number | null,
  smallTh: number,
  mediumTh: number,
  largeTh: number
): { next: string; pctRemaining: number } | null {
  if (dropPct == null || Number.isNaN(dropPct)) return null;
  if (dropPct < 0) return null;
  if (dropPct < smallTh) return { next: 'small', pctRemaining: smallTh - dropPct };
  if (dropPct < mediumTh) return { next: 'medium', pctRemaining: mediumTh - dropPct };
  if (dropPct < largeTh) return { next: 'large', pctRemaining: largeTh - dropPct };
  return null;
}

/** Apply a batch of server `priceUpdate` payloads to watchlist rows. */
export function mergeWatchlistPriceUpdates(
  prev: WatchlistContextResponse | null,
  prices: Array<Record<string, unknown>>,
  nowMs: number = Date.now()
): WatchlistContextResponse | null {
  if (!prev?.items?.length || !prices?.length) return prev;

  const key = (t: string, s: string) => `${String(t).toLowerCase()}:${String(s).toUpperCase()}`;
  const map = new Map<string, Record<string, unknown>>();
  for (const p of prices) {
    const typ = String(p.type || '').toLowerCase();
    const sym = String(p.symbol || '').toUpperCase();
    if (typ && sym) map.set(key(typ, sym), p);
  }

  return {
    ...prev,
    generatedAt: new Date(nowMs).toISOString(),
    items: prev.items.map((row) => {
      const hit = map.get(key(row.assetType, row.symbol));
      if (!hit) return row;

      const price = Number(hit.price);
      if (!Number.isFinite(price)) return row;

      const ts = hit.timestamp != null ? Number(hit.timestamp) : nowMs;
      const quoteAgeSec = Math.max(0, Math.round((nowMs - ts) / 1000));

      let dayChangePct: number | null = null;
      let dayChangeAbs: number | null = null;
      if (row.assetType === 'stock') {
        if (hit.changePercent != null && Number.isFinite(Number(hit.changePercent))) {
          dayChangePct = Number(hit.changePercent);
        }
        if (hit.change24h != null && Number.isFinite(Number(hit.change24h))) {
          dayChangeAbs = Number(hit.change24h);
        }
      } else {
        if (hit.change24h != null && Number.isFinite(Number(hit.change24h))) {
          dayChangePct = Number(hit.change24h);
        }
      }

      const baseline = row.baselinePrice;
      let dropPctFromBaseline: number | null = null;
      if (baseline != null && baseline > 0 && Number.isFinite(price)) {
        dropPctFromBaseline = Number((((baseline - price) / baseline) * 100).toFixed(4));
      }

      const sizing = computeSizingPhase({
        dropPct: dropPctFromBaseline,
        smallTh: row.thresholds.small,
        mediumTh: row.thresholds.medium,
        largeTh: row.thresholds.large,
        maxPositionPct: prev.maxPositionPct,
        active: row.active
      });

      const gap = nextThresholdGap(
        dropPctFromBaseline,
        row.thresholds.small,
        row.thresholds.medium,
        row.thresholds.large
      );

      const dayHigh = hit.dayHigh != null && Number.isFinite(Number(hit.dayHigh)) ? Number(hit.dayHigh) : null;
      const dayLow = hit.dayLow != null && Number.isFinite(Number(hit.dayLow)) ? Number(hit.dayLow) : null;
      const volume =
        hit.volume != null && Number.isFinite(Number(hit.volume)) ? Number(hit.volume) : null;
      const prevClose =
        hit.prevClose != null && Number.isFinite(Number(hit.prevClose)) ? Number(hit.prevClose) : null;

      return {
        ...row,
        currentPrice: price,
        dayChangePct,
        dayChangeAbs,
        quoteAgeSec,
        priceUnavailableReason: null,
        dropPctFromBaseline,
        nextThresholdGap: gap,
        sizing,
        ...(dayHigh != null ? { dayHigh } : {}),
        ...(dayLow != null ? { dayLow } : {}),
        ...(volume != null ? { volume } : {}),
        ...(prevClose != null ? { prevClose } : {})
      };
    })
  };
}
