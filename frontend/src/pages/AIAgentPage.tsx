import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  AgentCandidate,
  AgentMessage,
  AgentPlan,
  AgentOutputV1,
  AgentPreferences,
  applyAgentPlan,
  chatWithAgent,
  fetchAgentWatchlistContext,
  inferAlertAssetType,
  type WatchlistContextItem,
  type WatchlistContextResponse
} from '../services/aiAgentService';
import { removeWatchlistSymbol } from '../services/watchlistApi';
import { useSocket } from '../contexts/SocketContext';
import { chartQuoteToPriceUpdatePayload, mergeWatchlistPriceUpdates } from '../utils/watchlistDerived';
import { getStockQuote, type QuoteData } from '../services/chartService';
import { OpportunityPolicyPanel } from '../components/OpportunityPolicyPanel';
import { ResizablePair } from '../components/ResizablePair';
import { WatchlistStockSearchInput } from '../components/WatchlistStockSearchInput';
import { Watchlist52WeekRange } from '../components/Watchlist52WeekRange';

const seedMessages: AgentMessage[] = [
  {
    id: 'm-1',
    role: 'system',
    content:
      'Welcome to your dashboard. Ask for strategies, watchlist ideas, position sizing, or risk guardrails. If you want dollar-sized allocation ideas, share your total deployable capital and which symbols or signal tiers you mean — answers are educational only.',
    timestamp: new Date().toISOString()
  }
];

export const AIAgentPage: React.FC = () => {
  const [messages, setMessages] = useState<AgentMessage[]>(seedMessages);
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<AgentPlan | null>(null);
  const [currentOutput, setCurrentOutput] = useState<AgentOutputV1 | null>(null);
  const [currentRunMetadata, setCurrentRunMetadata] = useState<{
    runId: string;
    nodeTimings: { langgraphInvokeMs: number; totalMs: number };
    providerUsed: string;
    fallbackUsed: boolean;
  } | null>(null);
  const [lastAgentReply, setLastAgentReply] = useState('');

  const [watchlistCtx, setWatchlistCtx] = useState<WatchlistContextResponse | null>(null);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const { socket } = useSocket();

  type WlSortKey = 'symbol' | 'dayPct' | 'vsBase';
  const [wlSort, setWlSort] = useState<{ key: WlSortKey; dir: 1 | -1 }>({ key: 'symbol', dir: 1 });

  const [agentPreferences, setAgentPreferences] = useState<AgentPreferences>({
    topN: 3,
    confidenceFloor: 0.55,
    maxPositionSizePct: 10,
    watchlistOnly: true,
    scoringWeights: {
      momentum: 0.35,
      trend: 0.3,
      liquidity: 0.2,
      eventRiskPenalty: 0.15
    }
  });

  const latestPlan = useMemo(() => {
    return currentPlan;
  }, [currentPlan]);

  const watchlistRef = useRef(watchlistCtx);
  watchlistRef.current = watchlistCtx;

  const watchlistStockSignature = useMemo(() => {
    if (!watchlistCtx?.items?.length) return '';
    const syms = new Set<string>();
    for (const i of watchlistCtx.items) {
      if (i.assetType === 'stock') syms.add(i.symbol.toUpperCase());
    }
    return Array.from(syms).sort().join(',');
  }, [watchlistCtx?.items]);

  const loadWatchlist = useCallback(async () => {
    setWatchlistLoading(true);
    setWatchlistError(null);
    try {
      const data = await fetchAgentWatchlistContext(agentPreferences.maxPositionSizePct);
      const stockSymbols = Array.from(
        new Set(data.items.filter((i) => i.assetType === 'stock').map((i) => i.symbol.toUpperCase()))
      );
      let merged = data;
      if (stockSymbols.length) {
        const results = await Promise.all(stockSymbols.map((s) => getStockQuote(s).catch(() => null)));
        const payloads = results
          .filter((q): q is QuoteData => q !== null)
          .map(chartQuoteToPriceUpdatePayload);
        if (payloads.length) {
          merged = mergeWatchlistPriceUpdates(data, payloads, Date.now()) ?? data;
        }
      }
      setWatchlistCtx(merged);
    } catch {
      setWatchlistError('Could not load watchlist prices.');
    } finally {
      setWatchlistLoading(false);
    }
  }, [agentPreferences.maxPositionSizePct]);

  useEffect(() => {
    if (!watchlistStockSignature) return;
    let cancelled = false;

    const runBatch = async () => {
      const ctx = watchlistRef.current;
      const symbols =
        ctx?.items?.filter((i) => i.assetType === 'stock').map((i) => i.symbol.toUpperCase()) ?? [];
      const unique = Array.from(new Set(symbols));
      if (!unique.length) return;
      const results = await Promise.all(unique.map((s) => getStockQuote(s).catch(() => null)));
      if (cancelled) return;
      const payloads = results
        .filter((q): q is QuoteData => q !== null)
        .map(chartQuoteToPriceUpdatePayload);
      if (!payloads.length) return;
      setWatchlistCtx((prev) => mergeWatchlistPriceUpdates(prev, payloads, Date.now()));
    };

    void runBatch();
    const handle = window.setInterval(() => void runBatch(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [watchlistStockSignature]);

  useEffect(() => {
    void loadWatchlist();
    /** Reconcile with server (baselines, new rows); live quotes also merge via Socket `priceUpdate`. */
    const id = window.setInterval(() => void loadWatchlist(), 90_000);
    return () => window.clearInterval(id);
  }, [loadWatchlist]);

  useEffect(() => {
    if (!socket) return;
    const onPrices = (payload: unknown) => {
      const prices = Array.isArray(payload) ? payload : [];
      if (!prices.length) return;
      setWatchlistCtx((prev) =>
        mergeWatchlistPriceUpdates(prev, prices as Array<Record<string, unknown>>, Date.now())
      );
    };
    socket.on('priceUpdate', onPrices);
    return () => {
      socket.off('priceUpdate', onPrices);
    };
  }, [socket]);

  const formatQuote = (price: number | null, assetType: string) => {
    if (price == null || Number.isNaN(price)) return '—';
    const digits = assetType === 'crypto' && price < 10 ? 4 : 2;
    return `$${price.toFixed(digits)}`;
  };

  const formatDayChangePct = (row: WatchlistContextItem) => {
    const v = row.dayChangePct;
    if (v != null && Number.isFinite(v)) return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
    return '—';
  };

  const changeColorClass = (v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) return 'text-slate-300';
    if (v > 0.01) return 'text-emerald-400 font-medium';
    if (v < -0.01) return 'text-red-400 font-medium';
    return 'text-slate-300';
  };

  const formatVolume = (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(n)) return '—';
    return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  };

  const sortedWatchlistItems = useMemo(() => {
    const items = watchlistCtx?.items ? [...watchlistCtx.items] : [];
    const { key, dir } = wlSort;
    items.sort((a, b) => {
      let cmp = 0;
      if (key === 'symbol') {
        cmp = a.symbol.localeCompare(b.symbol);
      } else if (key === 'dayPct') {
        const va = a.dayChangePct ?? -Infinity;
        const vb = b.dayChangePct ?? -Infinity;
        cmp = va - vb;
      } else {
        const va = a.dropPctFromBaseline ?? -Infinity;
        const vb = b.dropPctFromBaseline ?? -Infinity;
        cmp = va - vb;
      }
      return cmp * dir;
    });
    return items;
  }, [watchlistCtx?.items, wlSort]);

  const toggleWlSort = (key: WlSortKey) => {
    setWlSort((prev) =>
      prev.key === key ? { key, dir: (prev.dir === 1 ? -1 : 1) as 1 | -1 } : { key, dir: 1 }
    );
  };

  const quoteStatusLabel = (ageSec: number | null | undefined) => {
    if (ageSec == null) return { text: '…', cls: 'text-slate-500' };
    if (ageSec <= 90) return { text: 'Live', cls: 'text-emerald-400' };
    if (ageSec <= 300) return { text: 'Delayed', cls: 'text-amber-400' };
    return { text: 'Stale', cls: 'text-amber-500' };
  };

  const vsBaselineDisplay = (row: WatchlistContextItem) => {
    const d = row.dropPctFromBaseline;
    if (d == null || !Number.isFinite(d)) return '—';
    const label = d >= 0 ? `−${Math.abs(d).toFixed(2)}%` : `+${Math.abs(d).toFixed(2)}%`;
    return label;
  };

  const vsBaselineColor = (row: WatchlistContextItem) => {
    const d = row.dropPctFromBaseline;
    if (d == null || !Number.isFinite(d)) return 'text-slate-300';
    if (d > 0.5) return 'text-emerald-400 font-medium';
    if (d < -0.5) return 'text-red-400 font-medium';
    return 'text-slate-300';
  };

  const handleRemoveTicker = async (symbol: string) => {
    try {
      await removeWatchlistSymbol(symbol);
      toast.success(`${symbol} removed from watchlist`);
      await loadWatchlist();
    } catch (error: unknown) {
      const msg = axios.isAxiosError(error)
        ? String(error.response?.data?.message || '') || error.message
        : 'Could not remove symbol';
      toast.error(msg);
    }
  };

  const addMessage = (role: AgentMessage['role'], content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role,
        content,
        timestamp: new Date().toISOString()
      }
    ]);
  };

  const handleSend = async () => {
    if (!input.trim() || isBusy) return;
    const prompt = input.trim();
    setInput('');
    setIsBusy(true);
    addMessage('user', prompt);

    try {
      const response = await chatWithAgent(prompt, 'recommend_only', agentPreferences);
      setCurrentPlan(response.plan);
      setCurrentOutput(response.output);
      setCurrentRunMetadata(response.runMetadata || null);
      setAgentPreferences(response.preferencesUsed);
      setLastAgentReply(response.reply);
      addMessage('agent', response.reply);
    } catch (error: any) {
      const msg = error?.response?.data?.message || 'Agent request failed';
      addMessage('system', `Agent failed: ${msg}`);
      toast.error(msg);
    } finally {
      setIsBusy(false);
    }
  };

  const applyCandidateAsAlert = async (candidate: AgentCandidate) => {
    const assetType = inferAlertAssetType(candidate.symbol, lastAgentReply);
    const plan: AgentPlan = {
      summary: `Apply ranked candidate ${candidate.symbol}`,
      riskNotes: candidate.riskFlags?.length ? [...candidate.riskFlags] : ['Review thresholds before enabling.'],
      proposedAlert: {
        symbol: candidate.symbol.toUpperCase(),
        assetType,
        smallThreshold: 5,
        mediumThreshold: 10,
        largeThreshold: 15
      }
    };
    try {
      setIsBusy(true);
      const response = await applyAgentPlan(plan);
      toast.success(response.message);
      addMessage('system', response.message);
    } catch (error: any) {
      const msg = error?.response?.data?.message || 'Failed to create alert';
      toast.error(msg);
      addMessage('system', `Apply failed: ${msg}`);
    } finally {
      setIsBusy(false);
    }
  };

  const showWatchlistSetupHint =
    lastAgentReply.includes('AGENT_INTERNAL_SECRET') || lastAgentReply.includes('Watchlist-only mode');

  return (
    <div className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8 py-6 sm:py-8 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-kib-fg sm:text-3xl">Dashboard</h1>
        <p className="mt-2 max-w-2xl text-sm text-kib-muted sm:text-base">
          Watchlist and alert policy first — then chat with the assistant and review ranked opportunities.
        </p>
      </div>

      {showWatchlistSetupHint && (
        <div className="mb-6 rounded-lg border border-amber-500/25 bg-amber-950/20 px-4 py-3 text-sm text-amber-100/95">
          <p className="font-medium">Watchlist grounding needs configuration</p>
          <p className="mt-1 text-amber-200/85">
            Set <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[13px]">AGENT_INTERNAL_SECRET</code> on Node
            and Python for full internal alerting. Verify{' '}
            <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[13px]">NODE_BACKEND_URL</code> reaches the API
            and you have active symbols.
          </p>
          <p className="mt-2">
            <Link to="/opportunity-signals" className="font-medium text-kib-cyber underline-offset-2 hover:underline">
              Open signals inbox
            </Link>
          </p>
        </div>
      )}

      <div className="flex flex-col gap-8">
          <section id="watchlist" className="scroll-mt-20">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight text-kib-fg sm:text-xl">Watchlist</h2>
                <p className="mt-1 max-w-2xl text-sm text-kib-muted">
                  Live quotes, baselines, and dip-band sizing (%). Ask the assistant for dollar allocations using your
                  deployable capital when needed.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadWatchlist()}
                disabled={watchlistLoading}
                className="btn-secondary whitespace-nowrap px-3 py-1.5 text-xs disabled:opacity-50"
              >
                {watchlistLoading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            <div className="flex flex-col gap-6">
            <ResizablePair
              storageKey="kib-dashboard-watch-policy-split"
              defaultPct={56}
              minLeftPx={300}
              minRightPx={260}
              breakpoint="lg"
              left={
            <div className="min-w-0 space-y-5 rounded-lg border border-white/[0.08] bg-kib-card p-4 sm:p-5">
            <div className="mb-5 flex flex-col gap-3 border-b border-white/[0.06] pb-5 sm:flex-row sm:items-end">
              <label className="flex-1 block text-sm font-medium text-slate-300" htmlFor="watchlist-stock-search-input">
                Add US stock
                <WatchlistStockSearchInput
                  onSymbolAdded={() => void loadWatchlist()}
                  disabled={watchlistLoading}
                />
              </label>
              <p className="text-xs text-slate-500 sm:max-w-xs sm:pb-1">
                Search by company name or ticker; only verified listings can be added. Quotes match the{' '}
                <strong>Charts</strong> API (polled ~10s here). Redis/socket snapshots merge when available — snapshot
                data only, not broker depth.
              </p>
            </div>

            {watchlistError && <p className="text-xs text-red-600 mb-2">{watchlistError}</p>}
            {!watchlistCtx?.items.length && !watchlistLoading && (
              <p className="text-sm text-kib-muted">
                Add a ticker above — we&apos;ll fetch a live quote, set a baseline, and show dip-band sizing hints here.
              </p>
            )}
            {watchlistCtx && watchlistCtx.items.length > 0 && (
              <>
                <p className="text-[11px] text-slate-500 mb-3">{watchlistCtx.policyNote}</p>
                <div className="overflow-x-auto rounded-lg border border-white/[0.06] bg-kib-surface">
                  <div className="max-h-[min(520px,65vh)] overflow-y-auto overscroll-x-contain">
                    <table className="w-full min-w-[1240px] text-sm">
                      <thead className="sticky top-0 z-10 border-b border-white/[0.06] bg-kib-surface/95 backdrop-blur-sm">
                        <tr className="text-left text-[11px] font-medium uppercase tracking-wide text-kib-muted">
                          <th className="px-3 py-3 pl-4">
                            <button
                              type="button"
                              onClick={() => toggleWlSort('symbol')}
                              className="font-semibold uppercase tracking-wide hover:text-kib-cyber"
                            >
                              Symbol{wlSort.key === 'symbol' ? (wlSort.dir === 1 ? ' ↑' : ' ↓') : ''}
                            </button>
                          </th>
                          <th className="px-3 py-3 text-right tabular-nums">Last</th>
                          <th className="px-3 py-3 text-right tabular-nums">
                            <button
                              type="button"
                              onClick={() => toggleWlSort('dayPct')}
                              className="font-semibold uppercase tracking-wide hover:text-kib-cyber ml-auto block"
                            >
                              Day %{wlSort.key === 'dayPct' ? (wlSort.dir === 1 ? ' ↑' : ' ↓') : ''}
                            </button>
                          </th>
                          <th className="px-3 py-3 text-right tabular-nums hidden lg:table-cell">Volume</th>
                          <th className="px-3 py-3 text-right tabular-nums hidden xl:table-cell">Day range</th>
                          <th className="px-3 py-3 hidden lg:table-cell min-w-[140px]">52W range</th>
                          <th className="px-3 py-3 text-right tabular-nums hidden sm:table-cell">Baseline</th>
                          <th className="px-3 py-3 text-right tabular-nums">
                            <button
                              type="button"
                              onClick={() => toggleWlSort('vsBase')}
                              className="font-semibold uppercase tracking-wide hover:text-kib-cyber ml-auto block"
                            >
                              vs baseline{wlSort.key === 'vsBase' ? (wlSort.dir === 1 ? ' ↑' : ' ↓') : ''}
                            </button>
                          </th>
                          <th className="px-3 py-3 hidden md:table-cell max-w-[140px]">Next dip</th>
                          <th className="px-3 py-3 hidden lg:table-cell max-w-[160px]">Signal</th>
                          <th className="px-3 py-3 text-right tabular-nums">Size %</th>
                          <th className="px-3 py-3 w-14 pr-4" aria-label="Remove" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.06]">
                        {sortedWatchlistItems.map((row) => {
                          const pct = row.sizing.suggestedPortfolioPct;
                          return (
                            <tr
                              key={row.alertId}
                              className={`transition-colors hover:bg-white/[0.03] ${
                                row.active ? '' : 'opacity-80'
                              }`}
                            >
                              <td className="px-3 py-2.5 pl-4 align-top">
                                <div className="flex flex-col gap-0.5">
                                  {row.assetType === 'stock' ? (
                                    <Link
                                      to={`/charts?symbol=${encodeURIComponent(row.symbol)}`}
                                      className="font-semibold font-mono text-kib-fg hover:text-kib-cyber w-fit"
                                      title={`Open chart for ${row.symbol}`}
                                    >
                                      {row.symbol}
                                    </Link>
                                  ) : (
                                    <Link
                                      to={`/crypto?symbol=${encodeURIComponent(row.symbol)}`}
                                      className="font-semibold font-mono text-kib-fg hover:text-kib-cyber w-fit"
                                      title={`Open crypto chart for ${row.symbol}`}
                                    >
                                      {row.symbol}
                                    </Link>
                                  )}
                                  {!row.active && (
                                    <span className="text-[10px] uppercase tracking-wide text-amber-500">paused</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums align-top">
                                <div className="font-semibold text-kib-fg tabular-nums">
                                  {formatQuote(row.currentPrice, row.assetType)}
                                </div>
                                <div
                                  className={`text-[10px] tabular-nums ${quoteStatusLabel(row.quoteAgeSec).cls}`}
                                >
                                  {quoteStatusLabel(row.quoteAgeSec).text}
                                  {row.quoteAgeSec != null ? ` · ${row.quoteAgeSec}s` : ''}
                                </div>
                              </td>
                              <td
                                className={`px-3 py-2.5 text-right tabular-nums align-top ${changeColorClass(
                                  row.dayChangePct ?? undefined
                                )}`}
                              >
                                {formatDayChangePct(row)}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-slate-300 hidden lg:table-cell align-top">
                                {formatVolume(row.volume ?? undefined)}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-slate-400 text-xs hidden xl:table-cell align-top">
                                {row.dayHigh != null && row.dayLow != null ? (
                                  <>
                                    {formatQuote(row.dayHigh, row.assetType)} /{' '}
                                    {formatQuote(row.dayLow, row.assetType)}
                                  </>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="px-3 py-2.5 hidden lg:table-cell align-top">
                                <Watchlist52WeekRange
                                  assetType={row.assetType}
                                  currentPrice={row.currentPrice}
                                  week52High={row.week52High}
                                  week52Low={row.week52Low}
                                />
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-slate-300 hidden sm:table-cell align-top">
                                {formatQuote(row.baselinePrice, row.assetType)}
                              </td>
                              <td
                                className={`px-3 py-2.5 text-right tabular-nums align-top ${vsBaselineColor(row)}`}
                              >
                                {vsBaselineDisplay(row)}
                              </td>
                              <td className="px-3 py-2.5 text-xs text-slate-300 hidden md:table-cell align-top max-w-[140px]">
                                {row.nextThresholdGap ? (
                                  <span>
                                    {row.nextThresholdGap.next}: ~{row.nextThresholdGap.pctRemaining.toFixed(2)}% to go
                                  </span>
                                ) : (
                                  <span className="text-slate-500">—</span>
                                )}
                              </td>
                              <td
                                className="px-3 py-2.5 text-xs text-slate-300 hidden lg:table-cell align-top max-w-[180px]"
                                title={row.sizing.rationale}
                              >
                                <span className="font-medium text-kib-cyber/90">{row.sizing.tierLabel}</span>
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums align-top">
                                <div className="font-medium text-kib-fg">{pct}%</div>
                              </td>
                              <td className="px-3 py-2.5 pr-4 text-right align-top">
                                <button
                                  type="button"
                                  onClick={() => void handleRemoveTicker(row.symbol)}
                                  className="text-xs font-medium text-red-600 hover:text-red-700 hover:underline"
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-slate-500 lg:hidden">
                  Tip: widen the window or scroll horizontally to see Next dip and Signal columns.
                </p>
              </>
            )}
              <p className="mt-3 border-t border-white/[0.06] pt-3 text-[11px] leading-relaxed text-kib-muted">
                Educational only — not investment advice.
              </p>
            </div>
              }
              right={
            <div className="flex max-h-none flex-col overflow-hidden rounded-lg border border-white/[0.08] bg-kib-card shadow-soft lg:sticky lg:top-20 lg:max-h-[min(92vh,900px)] lg:overflow-y-auto">
              <div className="shrink-0 border-b border-white/[0.06] bg-kib-surface/90 px-4 py-3">
                <h3 className="text-sm font-semibold text-kib-fg">Alert policy &amp; customization</h3>
                <p className="mt-1 text-[11px] leading-snug text-kib-muted">
                  How opportunity signals fire and how thresholds are tuned globally (<code className="rounded bg-black/25 px-1 font-mono text-[10px]">OPPORTUNITY_*</code> on the API host).
                </p>
              </div>
              <OpportunityPolicyPanel embedInPanel />
            </div>
              }
            />

            <div className="rounded-lg border border-white/[0.08] bg-kib-card">
              <div className="border-b border-white/[0.06] bg-kib-surface/90 px-4 py-3 sm:px-5">
                <h3 className="text-sm font-semibold text-kib-fg sm:text-base">Latest plan</h3>
                <p className="mt-1 text-[11px] text-kib-muted">
                  From your last assistant reply that proposed alert thresholds.
                </p>
              </div>
              <div className="p-4 sm:p-5">
                {latestPlan?.proposedAlert ? (
                  <div className="space-y-2 text-sm text-slate-300">
                    <p>
                      <span className="font-medium">Symbol:</span> {latestPlan.proposedAlert.symbol}
                    </p>
                    <p>
                      <span className="font-medium">Asset:</span> {latestPlan.proposedAlert.assetType}
                    </p>
                    <p>
                      <span className="font-medium">Thresholds:</span>{' '}
                      {latestPlan.proposedAlert.smallThreshold}% / {latestPlan.proposedAlert.mediumThreshold}% /{' '}
                      {latestPlan.proposedAlert.largeThreshold}%
                    </p>
                    <p className="text-kib-muted">{latestPlan.summary}</p>
                    <ul className="list-disc pl-4 text-kib-muted">
                      {latestPlan.riskNotes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-sm text-kib-muted">No plan yet. Send a prompt to generate one.</p>
                )}
              </div>
            </div>
            </div>
          </section>

          <div className="overflow-hidden rounded-lg border border-white/[0.08] bg-kib-card">
          <div className="flex items-center justify-between border-b border-white/[0.06] bg-kib-surface px-4 py-3">
            <h2 className="text-sm font-semibold text-kib-fg">Assistant</h2>
            <span
              className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                isBusy
                  ? 'bg-amber-500/15 text-amber-200'
                  : 'bg-white/[0.06] text-kib-muted'
              }`}
            >
              {isBusy ? 'Working…' : 'Ready'}
            </span>
          </div>

          <div className="min-h-[min(45vh,320px)] h-[min(45vh,380px)] overflow-y-auto bg-kib-card p-3 sm:min-h-[380px] sm:h-[440px] sm:p-4">
            <div className="space-y-3">
            {messages.map((message) => (
              <div key={message.id} className={`max-w-[min(100%,520px)] ${message.role === 'user' ? 'ml-auto' : ''}`}>
                <div
                  className={`rounded-lg px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap sm:px-4 sm:py-3 ${
                    message.role === 'user'
                      ? 'bg-[#388bfd] text-white'
                      : message.role === 'agent'
                        ? 'border border-white/[0.06] bg-kib-raise text-kib-fg'
                        : 'border border-amber-500/20 bg-amber-950/25 text-amber-100/95'
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}
            </div>
          </div>

          <div className="border-t border-white/[0.06] bg-kib-bg p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setInput('Create a stock alert strategy for AAPL with 4% and 9% dip thresholds')}
                className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-kib-fg hover:bg-white/[0.07]"
              >
                AAPL strategy
              </button>
              <button
                type="button"
                onClick={() => setInput('Monitor TSLA volatility and suggest safer thresholds')}
                className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-kib-fg hover:bg-white/[0.07]"
              >
                TSLA volatility
              </button>
              <button
                type="button"
                onClick={() =>
                  setInput(
                    'Analyze my active dashboard watchlist: rank symbols with your scoring weights, use live quotes, and summarize the strongest dip-band opportunities vs baselines.'
                  )
                }
                className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-kib-fg hover:bg-white/[0.07]"
              >
                Analyze watchlist
              </button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSend();
                }}
                placeholder="e.g. How much should I allocate to AAPL with $50k deployable given today’s signal tier?"
                className="input-field min-h-[44px] flex-1 sm:min-h-0"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={isBusy || !input.trim()}
                className="btn-primary shrink-0 disabled:opacity-50 sm:min-w-[88px]"
              >
                Send
              </button>
            </div>
          </div>
        </div>

          <ResizablePair
            storageKey="kib-dashboard-opps-meta-split"
            defaultPct={52}
            minLeftPx={280}
            minRightPx={220}
            breakpoint="md"
            left={
          <div className="card">
            <h3 className="mb-3 text-base font-semibold text-kib-fg sm:text-lg">Top opportunities</h3>
            {currentOutput?.topCandidates?.length ? (
              <div className="space-y-3 text-sm text-slate-300">
                {currentOutput.topCandidates.map((candidate) => (
                  <div key={candidate.symbol} className="space-y-2 rounded-lg border border-white/[0.06] bg-kib-surface p-3">
                    <p><span className="font-medium">Symbol:</span> {candidate.symbol}</p>
                    {candidate.liveQuote && (
                      <p className="text-kib-muted">
                        <span className="font-medium text-slate-300">Live:</span> $
                        {candidate.liveQuote.price.toFixed(candidate.liveQuote.price >= 100 ? 2 : 4)}
                        {candidate.liveQuote.changePercent != null && (
                          <span>
                            {' '}
                            ({Number(candidate.liveQuote.changePercent) >= 0 ? '+' : ''}
                            {Number(candidate.liveQuote.changePercent).toFixed(2)}%)
                          </span>
                        )}
                      </p>
                    )}
                    <p><span className="font-medium">Score:</span> {candidate.score}</p>
                    <p><span className="font-medium">Confidence:</span> {candidate.confidence}</p>
                    <p><span className="font-medium">Why now:</span> {candidate.whyNow}</p>
                    <p>
                      <span className="font-medium">Limit band:</span> {candidate.suggestedLimitBand.min} -{' '}
                      {candidate.suggestedLimitBand.max}
                    </p>
                    <p>
                      <span className="font-medium">Risk flags:</span>{' '}
                      {(candidate.riskFlags || []).join(', ') || '—'}
                    </p>
                    <button
                      type="button"
                      onClick={() => applyCandidateAsAlert(candidate)}
                      disabled={isBusy}
                      className="mt-1 w-full btn-primary py-2 text-xs disabled:opacity-50"
                    >
                      Apply 5% / 10% / 15% alert for {candidate.symbol}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-kib-muted">No opportunities yet. Send a prompt to generate ranked candidates.</p>
            )}
          </div>
            }
            right={
          <div className="card">
            <h3 className="mb-3 text-base font-semibold text-kib-fg sm:text-lg">Run metadata</h3>
            {currentRunMetadata ? (
              <div className="space-y-1 text-sm text-slate-300">
                <p><span className="font-medium">Run ID:</span> {currentRunMetadata.runId}</p>
                <p><span className="font-medium">Provider:</span> {currentRunMetadata.providerUsed}</p>
                <p><span className="font-medium">Fallback Used:</span> {currentRunMetadata.fallbackUsed ? 'Yes' : 'No'}</p>
                <p><span className="font-medium">LangGraph ms:</span> {currentRunMetadata.nodeTimings.langgraphInvokeMs}</p>
                <p><span className="font-medium">Total ms:</span> {currentRunMetadata.nodeTimings.totalMs}</p>
              </div>
            ) : (
              <p className="text-sm text-kib-muted">No run metadata yet.</p>
            )}
          </div>
            }
          />

      </div>
    </div>
  );
};

export default AIAgentPage;
