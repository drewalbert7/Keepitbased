/**
 * Mirrors backend `agentWatchlistContext.js` sizing / gap math so WebSocket price
 * patches can refresh dip bands without waiting for the next HTTP poll.
 */
import type { QuoteData } from '../services/chartService';
import type { CryptoTicker } from '../services/cryptoService';
import type { WatchlistContextResponse, WatchlistSizing } from '../services/aiAgentService';

/** Shape a Chart service quote like a `priceUpdate` row for `mergeWatchlistPriceUpdates`. */
export function cryptoTickerToPriceUpdatePayload(
  ticker: CryptoTicker,
  alertBaseSymbol: string
): Record<string, unknown> {
  const ts = Date.parse(ticker.timestamp);
  return {
    type: 'crypto',
    symbol: String(alertBaseSymbol).toUpperCase(),
    price: ticker.price,
    timestamp: Number.isFinite(ts) ? ts : Date.now(),
    change24h: ticker.changePercent,
    changePercent: ticker.changePercent,
    dayHigh: ticker.high,
    dayLow: ticker.low,
    volume: ticker.volume,
    dayOpen: ticker.open,
    sessionVwap: ticker.vwap,
    bidPrice: ticker.bid,
    askPrice: ticker.ask
  };
}

export function chartQuoteToPriceUpdatePayload(q: QuoteData): Record<string, unknown> {
  const ts = Date.parse(q.timestamp);
  const base: Record<string, unknown> = {
    type: 'stock',
    symbol: String(q.symbol || '').toUpperCase(),
    price: q.price,
    changePercent: q.changePercent,
    /** Matches PriceMonitor stock payload: dollar change vs open for session snapshot */
    change24h: q.change,
    timestamp: Number.isFinite(ts) ? ts : Date.now(),
    dayHigh: q.high,
    dayLow: q.low,
    volume: q.volume,
    dayOpen: q.open
  };
  if (q.sourceUsed != null && String(q.sourceUsed).trim()) {
    base.sourceUsed = String(q.sourceUsed);
  }
  return base;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Prefer a positive finite 52w extreme from server snapshot, else from prior client row. */
export function coalesceWeek52Field(
  server: number | null | undefined,
  prev: number | null | undefined
): number | null | undefined {
  const pick = (v: number | null | undefined) =>
    v != null && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null;
  return pick(server) ?? pick(prev) ?? undefined;
}

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

      let dayChangePct: number | null = row.dayChangePct ?? null;
      let dayChangeAbs: number | null = row.dayChangeAbs ?? null;
      if (row.assetType === 'stock') {
        if (hit.changePercent != null && Number.isFinite(Number(hit.changePercent))) {
          dayChangePct = Number(hit.changePercent);
        }
        if (hit.change24h != null && Number.isFinite(Number(hit.change24h))) {
          dayChangeAbs = Number(hit.change24h);
        }
      } else {
        if (hit.changePercent != null && Number.isFinite(Number(hit.changePercent))) {
          dayChangePct = Number(hit.changePercent);
        } else if (hit.change24h != null && Number.isFinite(Number(hit.change24h))) {
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

      const dayHigh =
        hit.dayHigh != null && Number.isFinite(Number(hit.dayHigh))
          ? Number(hit.dayHigh)
          : row.dayHigh ?? null;
      const dayLow =
        hit.dayLow != null && Number.isFinite(Number(hit.dayLow))
          ? Number(hit.dayLow)
          : row.dayLow ?? null;
      const volume =
        hit.volume != null && Number.isFinite(Number(hit.volume))
          ? Number(hit.volume)
          : row.volume ?? null;
      const prevClose =
        hit.prevClose != null && Number.isFinite(Number(hit.prevClose))
          ? Number(hit.prevClose)
          : row.prevClose ?? null;

      const dayOpenField =
        hit.dayOpen != null && Number.isFinite(Number(hit.dayOpen)) ? Number(hit.dayOpen) : row.dayOpen ?? null;
      const sessionVwapField =
        hit.sessionVwap != null && Number.isFinite(Number(hit.sessionVwap))
          ? Number(hit.sessionVwap)
          : row.sessionVwap ?? null;
      const bidField =
        hit.bidPrice != null && Number.isFinite(Number(hit.bidPrice)) ? Number(hit.bidPrice) : row.bidPrice ?? null;
      const askField =
        hit.askPrice != null && Number.isFinite(Number(hit.askPrice)) ? Number(hit.askPrice) : row.askPrice ?? null;
      const hitSrc =
        (hit.sourceUsed != null && String(hit.sourceUsed).trim()
          ? String(hit.sourceUsed)
          : null) ||
        (hit.quoteSourceUsed != null && String(hit.quoteSourceUsed).trim()
          ? String(hit.quoteSourceUsed)
          : null);
      const srcField = hitSrc ?? row.quoteSourceUsed;

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
        week52High: row.week52High,
        week52Low: row.week52Low,
        ...(dayHigh != null ? { dayHigh } : {}),
        ...(dayLow != null ? { dayLow } : {}),
        ...(volume != null ? { volume } : {}),
        ...(prevClose != null ? { prevClose } : {}),
        ...(dayOpenField != null ? { dayOpen: dayOpenField } : {}),
        ...(sessionVwapField != null ? { sessionVwap: sessionVwapField } : {}),
        ...(bidField != null ? { bidPrice: bidField } : {}),
        ...(askField != null ? { askPrice: askField } : {}),
        ...(srcField ? { quoteSourceUsed: srcField } : {})
      };
    })
  };
}

/**
 * After a full HTTP refresh, keep client-side quote fields when they are strictly fresher than the
 * server snapshot (avoids flicker when a slow `watchlist-context` response returns after socket/poll updates).
 */
export function overlayFresherWatchlistQuotes(
  server: WatchlistContextResponse,
  prev: WatchlistContextResponse | null
): WatchlistContextResponse {
  if (!prev?.items?.length) return server;

  const maxPct = server.maxPositionPct;
  const prevById = new Map(prev.items.map((r) => [r.alertId, r]));

  return {
    ...server,
    items: server.items.map((row) => {
      const p = prevById.get(row.alertId);
      if (!p) return row;

      const serverAge = row.quoteAgeSec;
      const prevAge = p.quoteAgeSec;
      const prevHasPrice = p.currentPrice != null && Number.isFinite(Number(p.currentPrice));

      const usePrevQuote =
        prevHasPrice &&
        (row.currentPrice == null ||
          !Number.isFinite(Number(row.currentPrice)) ||
          (prevAge != null && serverAge != null && prevAge < serverAge) ||
          (prevAge != null && serverAge == null));

      if (!usePrevQuote) return row;

      const price = Number(p.currentPrice);
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
        maxPositionPct: maxPct,
        active: row.active
      });

      const gap = nextThresholdGap(
        dropPctFromBaseline,
        row.thresholds.small,
        row.thresholds.medium,
        row.thresholds.large
      );

      return {
        ...row,
        currentPrice: price,
        dayChangePct: p.dayChangePct ?? row.dayChangePct,
        dayChangeAbs: p.dayChangeAbs ?? row.dayChangeAbs,
        quoteAgeSec: p.quoteAgeSec ?? row.quoteAgeSec,
        dayHigh: p.dayHigh ?? row.dayHigh,
        dayLow: p.dayLow ?? row.dayLow,
        volume: p.volume ?? row.volume,
        prevClose: p.prevClose ?? row.prevClose,
        dayOpen: p.dayOpen ?? row.dayOpen,
        sessionVwap: p.sessionVwap ?? row.sessionVwap,
        bidPrice: p.bidPrice ?? row.bidPrice,
        askPrice: p.askPrice ?? row.askPrice,
        quoteSourceUsed: p.quoteSourceUsed ?? row.quoteSourceUsed,
        priceUnavailableReason: usePrevQuote ? null : row.priceUnavailableReason,
        dropPctFromBaseline,
        nextThresholdGap: gap,
        sizing,
        week52High: coalesceWeek52Field(row.week52High, p.week52High),
        week52Low: coalesceWeek52Field(row.week52Low, p.week52Low)
      };
    })
  };
}
