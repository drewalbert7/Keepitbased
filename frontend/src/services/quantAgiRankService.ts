import axios from 'axios';

export type RankStrategyId =
  | 'momentum_liquidity'
  | 'photonics_chokepoint'
  | 'rule_breaker_gardner'
  | 'rule_breaker_gardner_early';

export interface RuleBreakerBreakdownRow {
  element_key: string;
  book_criterion: string;
  score_0_100: number;
  weight: number;
  weighted_contribution: number;
}

export interface QuantSuggestedPosition {
  symbol: string;
  score: number;
  last_close: number | null;
  day_change_pct: number | null;
  avg_dollar_vol_20d: number | null;
  why: string[];
  position_hint: string;
  strategy_factors?: Record<string, unknown>;
}

export interface RankMeta {
  accepted_count: number;
  excluded_count: number;
  min_price: number;
  min_avg_dollar_vol_20d: number;
}

export interface RankStrategyMeta {
  id: RankStrategyId;
  label: string;
  disclaimer: string;
}

export interface MarketUniverseRankResult {
  positions: QuantSuggestedPosition[];
  meta: RankMeta;
  strategyMeta: RankStrategyMeta;
}

const RANK_POLL_MS = 8000;

export const QUANT_RANK_POLL_MS = RANK_POLL_MS;

function parseStrategyId(raw: string, fallback: RankStrategyId): RankStrategyId {
  if (
    raw === 'photonics_chokepoint' ||
    raw === 'rule_breaker_gardner' ||
    raw === 'rule_breaker_gardner_early' ||
    raw === 'momentum_liquidity'
  ) {
    return raw;
  }
  return fallback;
}

function mapPositions(payload: Record<string, unknown>): QuantSuggestedPosition[] {
  if (!Array.isArray(payload.positions)) return [];
  const positions = payload.positions.map((row: Record<string, unknown>) => ({
    symbol: String(row.symbol || ''),
    score: typeof row.score === 'number' ? row.score : Number(row.score) || 0,
    last_close: typeof row.last_close === 'number' ? row.last_close : null,
    day_change_pct: typeof row.day_change_pct === 'number' ? row.day_change_pct : null,
    avg_dollar_vol_20d: typeof row.avg_dollar_vol_20d === 'number' ? row.avg_dollar_vol_20d : null,
    why: Array.isArray(row.why) ? row.why.map((x) => String(x)) : [],
    position_hint: String(row.position_hint || 'watch candidate'),
    strategy_factors:
      row.strategy_factors && typeof row.strategy_factors === 'object'
        ? (row.strategy_factors as Record<string, unknown>)
        : undefined
  }));
  positions.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  return positions;
}

function mapPayload(payload: Record<string, unknown>, strategy: RankStrategyId): MarketUniverseRankResult {
  const sid = parseStrategyId(String(payload.strategy || ''), strategy);
  return {
    positions: mapPositions(payload),
    meta: {
      accepted_count: typeof payload.accepted_count === 'number' ? payload.accepted_count : 0,
      excluded_count: typeof payload.excluded_count === 'number' ? payload.excluded_count : 0,
      min_price:
        typeof (payload.liquidity_gate as Record<string, unknown> | undefined)?.min_price === 'number'
          ? (payload.liquidity_gate as { min_price: number }).min_price
          : 0,
      min_avg_dollar_vol_20d:
        typeof (payload.liquidity_gate as Record<string, unknown> | undefined)?.min_avg_dollar_vol_20d ===
        'number'
          ? (payload.liquidity_gate as { min_avg_dollar_vol_20d: number }).min_avg_dollar_vol_20d
          : 0
    },
    strategyMeta: {
      id: sid,
      label: String(payload.strategy_label || sid),
      disclaimer: String(payload.strategy_disclaimer || '')
    }
  };
}

/** Server-proxied rank (same data path as digest worker + Quant terminal sidecar). */
export async function fetchMarketUniverseRank(
  strategy: RankStrategyId,
  topN = 25,
  signal?: AbortSignal
): Promise<MarketUniverseRankResult> {
  const { data } = await axios.get<Record<string, unknown>>('/quant-agi/market-universe-rank', {
    params: { strategy, top_n: topN },
    signal
  });
  if (!data) {
    throw new Error('Quant rank returned empty response');
  }
  if (data.ok === false) {
    throw new Error(String(data.message || data.detail || 'Quant rank failed'));
  }
  const result = mapPayload(data, strategy);
  if (!result.positions.length && data.ok !== true) {
    throw new Error(String(data.message || data.detail || 'Quant rank unavailable'));
  }
  return result;
}

export function ruleBreakerBreakdown(
  factors: Record<string, unknown> | undefined
): RuleBreakerBreakdownRow[] {
  if (!factors || (factors.kind !== 'rule_breaker_gardner' && factors.kind !== 'rule_breaker_gardner_early')) {
    return [];
  }
  const raw = factors.breakdown;
  if (!Array.isArray(raw)) return [];
  const out: RuleBreakerBreakdownRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const element_key = String(o.element_key ?? '');
    const score_0_100 = typeof o.score_0_100 === 'number' ? o.score_0_100 : Number(o.score_0_100);
    if (!element_key || !Number.isFinite(score_0_100)) continue;
    out.push({
      element_key,
      book_criterion: String(o.book_criterion ?? ''),
      score_0_100,
      weight: Number.isFinite(Number(o.weight)) ? Number(o.weight) : 0,
      weighted_contribution: Number.isFinite(Number(o.weighted_contribution))
        ? Number(o.weighted_contribution)
        : 0
    });
  }
  return out;
}
