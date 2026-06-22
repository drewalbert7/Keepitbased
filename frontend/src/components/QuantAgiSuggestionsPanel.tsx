import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { addWatchlistSymbol } from '../services/watchlistApi';
import {
  antiChaseFromFactors,
  fetchMarketUniverseRank,
  fetchRankBacktest,
  fetchSuggestionOutcomes,
  logQuantSuggestionAdd,
  QUANT_RANK_POLL_MS,
  ruleBreakerBreakdown,
  type RankBacktestResult,
  type RankStrategyId,
  type SuggestionOutcomesSummary
} from '../services/quantAgiRankService';

const STRATEGY_STORAGE_KEY = 'kib-dashboard-quant-rank-strategy';

const STRATEGY_TABS: { id: RankStrategyId; label: string }[] = [
  { id: 'momentum_liquidity', label: 'Momentum / liquidity' },
  { id: 'photonics_chokepoint', label: 'AI photonics chokepoint' },
  { id: 'rule_breaker_gardner_early', label: 'Gardner Early (lower cap)' },
  { id: 'rule_breaker_gardner', label: 'Rule Breaker (Gardner)' }
];

const HORIZON_LABELS: { key: string; label: string }[] = [
  { key: '3m', label: '3 mo' },
  { key: '6m', label: '6 mo' },
  { key: '12m', label: '12 mo' }
];

function pctClass(v: number | null | undefined): string {
  if (v == null) return 'text-kib-muted';
  if (v > 0) return 'text-emerald-400';
  if (v < 0) return 'text-red-400';
  return 'text-kib-muted';
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

const tabBtn = (active: boolean) =>
  `rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors sm:text-xs ${
    active
      ? 'bg-white/[0.14] text-kib-fg ring-1 ring-white/[0.12]'
      : 'text-kib-muted hover:bg-white/[0.06] hover:text-kib-fg'
  }`;

function BacktestHorizonTable({
  title,
  horizons,
  note
}: {
  title: string;
  horizons: RankBacktestResult['holdout'] | RankBacktestResult['trailing'];
  note?: string;
}) {
  if (!horizons?.horizons) return null;
  return (
    <div className="rounded-md border border-white/[0.06] bg-black/20 px-3 py-2">
      <p className="text-[11px] font-semibold text-kib-fg">{title}</p>
      {note ? <p className="mt-1 text-[10px] leading-snug text-kib-muted">{note}</p> : null}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[280px] text-[10px]">
          <thead>
            <tr className="text-left text-kib-muted">
              <th className="pb-1 pr-2 font-medium">Window</th>
              <th className="pb-1 pr-2 font-medium">Top 5 basket</th>
              <th className="pb-1 pr-2 font-medium">SPY</th>
              <th className="pb-1 font-medium">Excess</th>
            </tr>
          </thead>
          <tbody>
            {HORIZON_LABELS.map(({ key, label }) => {
              const row = horizons.horizons?.[key];
              if (!row?.ok) {
                return (
                  <tr key={key} className="border-t border-white/[0.04] text-kib-muted">
                    <td className="py-1 pr-2">{label}</td>
                    <td colSpan={3} className="py-1">
                      —
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={key} className="border-t border-white/[0.04]">
                  <td className="py-1 pr-2 text-kib-muted">{label}</td>
                  <td className={`py-1 pr-2 tabular-nums ${pctClass(row.basket_return_pct)}`}>
                    {fmtPct(row.basket_return_pct)}
                  </td>
                  <td className={`py-1 pr-2 tabular-nums ${pctClass(row.benchmark_return_pct)}`}>
                    {fmtPct(row.benchmark_return_pct)}
                  </td>
                  <td className={`py-1 tabular-nums ${pctClass(row.excess_return_pct)}`}>
                    {fmtPct(row.excess_return_pct)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const QuantAgiSuggestionsPanel: React.FC<{
  onSymbolAdded?: () => void;
}> = ({ onSymbolAdded }) => {
  const [strategyId, setStrategyId] = useState<RankStrategyId>(() => {
    if (typeof window === 'undefined') return 'momentum_liquidity';
    const saved = window.localStorage.getItem(STRATEGY_STORAGE_KEY) as RankStrategyId | null;
    return STRATEGY_TABS.some((t) => t.id === saved) ? saved! : 'momentum_liquidity';
  });
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [strategyLabel, setStrategyLabel] = useState('');
  const [disclaimer, setDisclaimer] = useState('');
  const [universeMeta, setUniverseMeta] = useState<{
    mode?: string;
    dynamic_added?: number;
    universe_size?: number;
  } | null>(null);
  const [meta, setMeta] = useState<{
    accepted_count: number;
    excluded_count: number;
    min_price: number;
    min_avg_dollar_vol_20d: number;
  } | null>(null);
  const [positions, setPositions] = useState<
    Awaited<ReturnType<typeof fetchMarketUniverseRank>>['positions']
  >([]);
  const [adding, setAdding] = useState<Record<string, boolean>>({});
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const [backtest, setBacktest] = useState<RankBacktestResult | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<SuggestionOutcomesSummary | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const backtestAbortRef = useRef<AbortController | null>(null);

  const loadRank = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const result = await fetchMarketUniverseRank(strategyId, 25, controller.signal);
      if (controller.signal.aborted) return;
      setPositions(result.positions);
      setMeta(result.meta);
      setUniverseMeta(result.universeMeta ?? null);
      setStrategyLabel(result.strategyMeta.label);
      setDisclaimer(result.strategyMeta.disclaimer);
      setConnected(true);
      setLastFetchedAt(new Date().toISOString());
    } catch (e) {
      if (controller.signal.aborted || axios.isCancel(e)) return;
      setConnected(false);
      const msg = axios.isAxiosError(e)
        ? String(e.response?.data?.message || e.message)
        : e instanceof Error
          ? e.message
          : 'Could not load Quant AGI ranks';
      setError(msg);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [strategyId]);

  const loadBacktest = useCallback(async () => {
    backtestAbortRef.current?.abort();
    const controller = new AbortController();
    backtestAbortRef.current = controller;
    setBacktestLoading(true);
    setBacktestError(null);
    try {
      const data = await fetchRankBacktest(strategyId, 5, controller.signal);
      if (controller.signal.aborted) return;
      setBacktest(data);
    } catch (e) {
      if (controller.signal.aborted || axios.isCancel(e)) return;
      setBacktest(null);
      setBacktestError(e instanceof Error ? e.message : 'Backtest unavailable');
    } finally {
      if (!controller.signal.aborted) setBacktestLoading(false);
    }
  }, [strategyId]);

  const loadOutcomes = useCallback(async () => {
    try {
      const data = await fetchSuggestionOutcomes(12);
      setOutcomes(data);
    } catch {
      setOutcomes(null);
    }
  }, []);

  useEffect(() => {
    void loadRank();
    const id = setInterval(() => void loadRank(), QUANT_RANK_POLL_MS);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [loadRank]);

  useEffect(() => {
    void loadBacktest();
    return () => backtestAbortRef.current?.abort();
  }, [loadBacktest]);

  useEffect(() => {
    void loadOutcomes();
  }, [loadOutcomes]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STRATEGY_STORAGE_KEY, strategyId);
    } catch {
      /* ignore */
    }
  }, [strategyId]);

  const onAdd = async (symbol: string, rankScore: number, rankPosition: number, entryPrice: number | null) => {
    setAdding((s) => ({ ...s, [symbol]: true }));
    try {
      await addWatchlistSymbol(symbol, 'stock');
      try {
        await logQuantSuggestionAdd({
          symbol,
          strategy: strategyId,
          rankScore,
          rankPosition,
          entryPrice
        });
        void loadOutcomes();
      } catch {
        /* non-blocking */
      }
      setAdded((s) => ({ ...s, [symbol]: true }));
      toast.success(`${symbol} added to watchlist`);
      onSymbolAdded?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : `Failed to add ${symbol}`;
      toast.error(msg);
    } finally {
      setAdding((s) => ({ ...s, [symbol]: false }));
    }
  };

  const showEmptyLoading = loading && positions.length === 0;

  return (
    <section
      id="quant-agi-suggestions"
      className="scroll-mt-20 rounded-lg border border-white/[0.08] bg-kib-card p-4 sm:p-5"
    >
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-kib-fg sm:text-xl">
              Quant AGI stock suggestions
            </h2>
            <span
              className={`rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                connected
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : error
                    ? 'bg-amber-500/15 text-amber-200'
                    : 'bg-white/[0.06] text-kib-muted'
              }`}
            >
              {loading && !connected ? 'Loading' : connected ? 'Live' : 'Offline'}
            </span>
          </div>
          <p className="mt-1 text-sm text-kib-muted">
            {strategyLabel || 'Preset strategy rank — educational tooling only'}
          </p>
          <p className="mt-1 text-[11px] text-kib-muted">
            {lastFetchedAt ? (
              <>
                Updated {new Date(lastFetchedAt).toLocaleTimeString()} · refreshes every{' '}
                {QUANT_RANK_POLL_MS / 1000}s
              </>
            ) : (
              'Fetching ranks from Quant AGI…'
            )}
          </p>
          {universeMeta?.mode === 'static_plus_dynamic' ? (
            <p className="mt-1 text-[11px] text-kib-muted">
              Universe: {universeMeta.universe_size ?? '—'} symbols ({universeMeta.dynamic_added ?? 0} from Massive
              screener + static list). Anti-chase guard penalizes extended names.
            </p>
          ) : null}
          <p className="mt-1 text-[11px] text-kib-muted">
            <Link to="/quant-agi" className="text-kib-cyber underline-offset-2 hover:underline">
              Open Quant terminal
            </Link>{' '}
            for autoresearch, coding advisor, and ops cockpit.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadRank()}
          disabled={loading}
          className="btn-secondary shrink-0 px-3 py-1.5 text-xs disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div
        className="mb-3 inline-flex w-full max-w-3xl flex-wrap gap-1 rounded-lg border border-white/[0.08] bg-black/25 p-1"
        role="tablist"
        aria-label="Quant rank strategy"
      >
        {STRATEGY_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={strategyId === tab.id}
            onClick={() => setStrategyId(tab.id)}
            className={tabBtn(strategyId === tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mb-3 space-y-2 rounded-lg border border-white/[0.08] bg-kib-surface px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-kib-fg">Backtest panel — top 5 vs SPY</p>
          <button
            type="button"
            onClick={() => void loadBacktest()}
            disabled={backtestLoading}
            className="text-[11px] text-kib-cyber hover:underline disabled:opacity-50"
          >
            {backtestLoading ? 'Computing…' : 'Refresh backtest'}
          </button>
        </div>
        {backtest?.top_symbols_today?.length ? (
          <p className="text-[10px] text-kib-muted">
            Today&apos;s top 5: {backtest.top_symbols_today.join(', ')}
          </p>
        ) : null}
        {backtestError ? <p className="text-[11px] text-amber-200">{backtestError}</p> : null}
        {backtestLoading && !backtest ? (
          <p className="text-[11px] text-kib-muted">Loading holdout backtest (cached ~6h)…</p>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            <BacktestHorizonTable
              title="Trailing — today's top 5"
              horizons={backtest?.trailing}
              note="Equal-weight return of current top picks over the lookback window."
            />
            <BacktestHorizonTable
              title="Holdout — re-ranked at window start"
              horizons={backtest?.holdout}
              note={backtest?.holdout?.disclaimer || 'Tape-only historical re-rank; educational research.'}
            />
          </div>
        )}
      </div>

      {outcomes && outcomes.totalLogged > 0 ? (
        <div className="mb-3 rounded-lg border border-white/[0.06] bg-kib-surface px-3 py-2 text-[11px] text-kib-muted">
          <p className="font-semibold text-kib-fg">Your suggestion adds ({outcomes.totalLogged})</p>
          <p className="mt-1">
            Avg return since add:{' '}
            <span className={pctClass(outcomes.avgReturnPct)}>{fmtPct(outcomes.avgReturnPct)}</span>
            {' · '}
            SPY over same periods:{' '}
            <span className={pctClass(outcomes.avgSpyReturnPct)}>{fmtPct(outcomes.avgSpyReturnPct)}</span>
            {' · '}
            Excess:{' '}
            <span className={pctClass(outcomes.avgExcessReturnPct)}>{fmtPct(outcomes.avgExcessReturnPct)}</span>
          </p>
        </div>
      ) : null}

      {disclaimer ? (
        <p className="mb-3 rounded-md border border-white/[0.08] bg-kib-surface px-3 py-2 text-[11px] leading-relaxed text-kib-muted whitespace-pre-wrap">
          {disclaimer.replace(/\*\*/g, '')}
        </p>
      ) : null}

      {meta ? (
        <div className="mb-3 grid gap-2 rounded-lg border border-white/[0.06] bg-kib-surface px-3 py-2 text-xs text-kib-muted sm:grid-cols-2 lg:grid-cols-4">
          <p>
            Accepted: <span className="font-medium text-emerald-400">{meta.accepted_count}</span>
          </p>
          <p>
            Excluded: <span className="font-medium text-amber-300">{meta.excluded_count}</span>
          </p>
          <p>
            Min price: <span className="font-medium text-kib-fg">${meta.min_price.toFixed(2)}</span>
          </p>
          <p>
            Min ADV20:{' '}
            <span className="font-medium text-kib-fg">
              ${Math.round(meta.min_avg_dollar_vol_20d).toLocaleString()}
            </span>
          </p>
        </div>
      ) : null}

      {error ? <p className="mb-3 text-sm text-amber-200">{error}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {showEmptyLoading ? (
          <p className="text-sm text-kib-muted">Scanning broad stock universe and ranking candidates…</p>
        ) : positions.length === 0 ? (
          <p className="text-sm text-kib-muted">No ranked candidates for this strategy right now.</p>
        ) : (
          positions.slice(0, 9).map((row, idx) => {
            const rbLegs = ruleBreakerBreakdown(row.strategy_factors);
            const antiChase = antiChaseFromFactors(row.strategy_factors);
            return (
              <article
                key={row.symbol}
                className="rounded-lg border border-white/[0.08] bg-kib-surface/80 px-3 py-3"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-sm font-semibold text-kib-fg">{row.symbol}</p>
                    {antiChase?.chase_risk ? (
                      <span
                        className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-200"
                        title={(antiChase.reasons || []).join('; ')}
                      >
                        Extended
                      </span>
                    ) : null}
                  </div>
                  <span className="text-[11px] text-kib-cyber">Score {row.score.toFixed(2)}</span>
                </div>
                <p className="text-sm tabular-nums text-kib-fg">
                  {row.last_close == null ? '—' : row.last_close.toFixed(2)}
                </p>
                <p className={`text-xs tabular-nums ${pctClass(row.day_change_pct)}`}>
                  {row.day_change_pct == null
                    ? '—'
                    : `${row.day_change_pct >= 0 ? '+' : ''}${row.day_change_pct.toFixed(2)}%`}
                </p>
                <ul className="mt-2 space-y-1">
                  {row.why.slice(0, 4).map((reason) => (
                    <li key={reason} className="text-[11px] leading-relaxed text-kib-muted">
                      {reason}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-kib-muted">
                  ADV20 ${Math.round(row.avg_dollar_vol_20d ?? 0).toLocaleString()}
                </p>
                {rbLegs.length > 0 ? (
                  <ul className="mt-2 space-y-1.5 border-t border-white/[0.06] pt-2">
                    <li className="text-[10px] font-semibold uppercase tracking-wide text-amber-200/90">
                      Gardner checklist — leg scores (0–100) × weight
                    </li>
                    {rbLegs.map((leg) => (
                      <li key={leg.element_key} className="text-[10px] leading-snug text-kib-muted">
                        <span className="font-medium text-kib-fg/90">
                          {leg.element_key.replace(/_/g, ' ')}
                        </span>{' '}
                        <span className="text-kib-cyber/90">{leg.score_0_100.toFixed(0)}</span>
                        <span className="text-kib-muted/70">
                          {' '}
                          ×{(leg.weight * 100).toFixed(0)}% →{' '}
                        </span>
                        <span className="text-emerald-400/90">{leg.weighted_contribution.toFixed(2)}</span>
                        {leg.book_criterion ? (
                          <span className="mt-0.5 block text-[9px] text-kib-muted/80">{leg.book_criterion}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-kib-muted">{row.position_hint}</span>
                  <button
                    type="button"
                    onClick={() =>
                      void onAdd(row.symbol, row.score, idx + 1, row.last_close)
                    }
                    disabled={Boolean(adding[row.symbol] || added[row.symbol])}
                    className="rounded-md border border-kib-cyber/40 bg-kib-cyber/10 px-2.5 py-1 text-[11px] font-medium text-kib-cyber transition hover:bg-kib-cyber/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {added[row.symbol] ? 'Added' : adding[row.symbol] ? 'Adding…' : 'Add to watchlist'}
                  </button>
                </div>
                <div className="mt-2 border-t border-white/[0.06] pt-2 text-[11px] leading-relaxed text-kib-muted">
                  Why Quant suggests this:{' '}
                  {row.why[0] || 'Composite rank from momentum, volatility, and drawdown.'}
                </div>
              </article>
            );
          })
        )}
      </div>

      <p className="mt-3 border-t border-white/[0.06] pt-3 text-[11px] leading-relaxed text-kib-muted">
        Educational only — not investment advice. Ranks come from Quant AGI sidecar rules, not Grok recall.
        {loading && positions.length > 0 ? ' Updating ranks…' : null}
      </p>
    </section>
  );
};
