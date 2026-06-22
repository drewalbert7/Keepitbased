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

export interface AntiChaseFactors {
  chase_risk?: boolean;
  penalty_points?: number;
  week52_position?: number;
  momentum_20d_pct?: number | null;
  reasons?: string[];
}

export interface RankBacktestHorizon {
  ok?: boolean;
  trading_days?: number;
  basket_return_pct?: number | null;
  benchmark_return_pct?: number | null;
  excess_return_pct?: number | null;
  top_symbols?: string[];
  holdout_start?: string;
  holdout_end?: string;
}

export interface RankBacktestResult {
  ok?: boolean;
  strategy?: string;
  top_symbols_today?: string[];
  trailing?: {
    horizons?: Record<string, RankBacktestHorizon>;
  };
  holdout?: {
    horizons?: Record<string, RankBacktestHorizon>;
    disclaimer?: string;
  };
  universe_meta?: {
    mode?: string;
    dynamic_added?: number;
    universe_size?: number;
  };
}

export interface SuggestionOutcomeItem {
  symbol: string;
  strategy: string;
  returnPct: number | null;
  spyReturnPct: number | null;
  excessReturnPct: number | null;
  ageDays: number;
  entryPrice: number | null;
  currentPrice: number | null;
}

export interface SuggestionOutcomesSummary {
  ok: boolean;
  totalLogged: number;
  withReturns: number;
  avgReturnPct: number | null;
  avgSpyReturnPct: number | null;
  avgExcessReturnPct: number | null;
  items: SuggestionOutcomeItem[];
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
  universeMeta?: {
    mode?: string;
    dynamic_added?: number;
    universe_size?: number;
  };
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
    },
    universeMeta:
      payload.universe_meta && typeof payload.universe_meta === 'object'
        ? (payload.universe_meta as MarketUniverseRankResult['universeMeta'])
        : undefined
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

export async function fetchRankBacktest(
  strategy: RankStrategyId,
  topK = 5,
  signal?: AbortSignal
): Promise<RankBacktestResult> {
  const { data } = await axios.get<RankBacktestResult>('/quant-agi/market-universe-rank-backtest', {
    params: { strategy, top_k: topK },
    signal,
    timeout: 120000
  });
  if (!data || data.ok === false) {
    throw new Error('Backtest unavailable');
  }
  return data;
}

export async function logQuantSuggestionAdd(payload: {
  symbol: string;
  strategy: RankStrategyId;
  rankScore?: number;
  rankPosition?: number;
  entryPrice?: number | null;
}): Promise<void> {
  await axios.post('/quant-agi/suggestion-log', {
    symbol: payload.symbol,
    strategy: payload.strategy,
    rankScore: payload.rankScore,
    rankPosition: payload.rankPosition,
    entryPrice: payload.entryPrice ?? undefined,
    source: 'dashboard_add'
  });
}

export async function fetchSuggestionOutcomes(limit = 20): Promise<SuggestionOutcomesSummary> {
  const { data } = await axios.get<SuggestionOutcomesSummary>('/quant-agi/suggestion-outcomes', {
    params: { limit }
  });
  return data;
}

export function antiChaseFromFactors(
  factors: Record<string, unknown> | undefined
): AntiChaseFactors | null {
  const raw = factors?.anti_chase;
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  return {
    chase_risk: Boolean(o.chase_risk),
    penalty_points: typeof o.penalty_points === 'number' ? o.penalty_points : undefined,
    week52_position: typeof o.week52_position === 'number' ? o.week52_position : undefined,
    momentum_20d_pct: typeof o.momentum_20d_pct === 'number' ? o.momentum_20d_pct : null,
    reasons: Array.isArray(o.reasons) ? o.reasons.map((x) => String(x)) : undefined
  };
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
