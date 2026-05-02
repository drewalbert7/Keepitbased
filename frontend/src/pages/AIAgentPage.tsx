import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  AgentAuditEvent,
  AgentCandidate,
  AgentMessage,
  AgentPlan,
  AgentOutputV1,
  AgentPreferences,
  applyAgentPlan,
  chatWithAgent,
  fetchAgentAudit,
  fetchAgentWatchlistContext,
  fetchXPulse,
  inferAlertAssetType,
  type WatchlistContextItem,
  type WatchlistContextResponse,
  type XPulseResponse
} from '../services/aiAgentService';
import { addWatchlistSymbol, removeWatchlistSymbol } from '../services/watchlistApi';
import { useSocket } from '../contexts/SocketContext';
import { mergeWatchlistPriceUpdates } from '../utils/watchlistDerived';

const seedMessages: AgentMessage[] = [
  {
    id: 'm-1',
    role: 'system',
    content: 'Welcome to your dashboard. Ask the assistant for strategies, watchlist ideas, or risk guardrails.',
    timestamp: new Date().toISOString()
  }
];

export const AIAgentPage: React.FC = () => {
  const [messages, setMessages] = useState<AgentMessage[]>(seedMessages);
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [autoApply, setAutoApply] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<AgentPlan | null>(null);
  const [currentOutput, setCurrentOutput] = useState<AgentOutputV1 | null>(null);
  const [currentRunMetadata, setCurrentRunMetadata] = useState<{
    runId: string;
    nodeTimings: { langgraphInvokeMs: number; totalMs: number };
    providerUsed: string;
    fallbackUsed: boolean;
  } | null>(null);
  const [lastAgentReply, setLastAgentReply] = useState('');
  const [auditEvents, setAuditEvents] = useState<AgentAuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditLoaded, setAuditLoaded] = useState(false);
  const [auditNextBeforeId, setAuditNextBeforeId] = useState<number | null>(null);
  const [auditHasMore, setAuditHasMore] = useState(false);
  /** Prefix passed to API (`action` LIKE `prefix%`). */
  const [auditActionPrefix, setAuditActionPrefix] = useState('');

  const [watchlistCtx, setWatchlistCtx] = useState<WatchlistContextResponse | null>(null);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const [portfolioUsd, setPortfolioUsd] = useState('');

  const [tickerInput, setTickerInput] = useState('');
  const [addTickerBusy, setAddTickerBusy] = useState(false);

  const [xPulse, setXPulse] = useState<XPulseResponse | null>(null);
  const [xPulseLoading, setXPulseLoading] = useState(false);
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

  const loadWatchlist = useCallback(async () => {
    setWatchlistLoading(true);
    setWatchlistError(null);
    try {
      const data = await fetchAgentWatchlistContext(agentPreferences.maxPositionSizePct);
      setWatchlistCtx(data);
    } catch {
      setWatchlistError('Could not load watchlist prices.');
    } finally {
      setWatchlistLoading(false);
    }
  }, [agentPreferences.maxPositionSizePct]);

  const loadXPulse = useCallback(async () => {
    setXPulseLoading(true);
    try {
      const data = await fetchXPulse();
      setXPulse(data);
    } catch {
      toast.error('Could not refresh X pulse');
    } finally {
      setXPulseLoading(false);
    }
  }, []);

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

  useEffect(() => {
    void loadXPulse();
    const id = window.setInterval(() => void loadXPulse(), 60_000);
    return () => window.clearInterval(id);
  }, [loadXPulse]);

  const formatUsd = (n: number) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

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

  const parsePortfolio = (): number | null => {
    const raw = portfolioUsd.replace(/[^0-9.]/g, '');
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  };

  const handleAddTicker = async () => {
    const sym = tickerInput.trim();
    if (!sym || addTickerBusy) return;
    setAddTickerBusy(true);
    try {
      await addWatchlistSymbol(sym);
      setTickerInput('');
      toast.success(`${sym.toUpperCase()} added to your watchlist`);
      await loadWatchlist();
    } catch (error: unknown) {
      const msg = axios.isAxiosError(error)
        ? String(error.response?.data?.message || '') || error.message
        : error instanceof Error
          ? error.message
          : 'Could not add symbol';
      toast.error(msg);
    } finally {
      setAddTickerBusy(false);
    }
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
      const mode = autoApply ? 'auto_apply_low_risk' : 'recommend_only';
      const response = await chatWithAgent(prompt, mode, agentPreferences);
      setCurrentPlan(response.plan);
      setCurrentOutput(response.output);
      setCurrentRunMetadata(response.runMetadata || null);
      setAgentPreferences(response.preferencesUsed);
      setLastAgentReply(response.reply);
      addMessage('agent', response.reply);

      if (autoApply && response.plan.proposedAlert) {
        try {
          const applied = await applyAgentPlan(response.plan);
          addMessage('system', applied.message);
          toast.success(applied.message);
        } catch (error: any) {
          const msg = error?.response?.data?.message || 'Failed to apply alert draft';
          addMessage('system', `Apply failed: ${msg}`);
          toast.error(msg);
        }
      }
    } catch (error: any) {
      const msg = error?.response?.data?.message || 'Agent request failed';
      addMessage('system', `Agent failed: ${msg}`);
      toast.error(msg);
    } finally {
      setIsBusy(false);
    }
  };

  const applyLatestPlan = async () => {
    if (!latestPlan?.proposedAlert) return;
    try {
      setIsBusy(true);
      const response = await applyAgentPlan(latestPlan);
      toast.success(response.message);
      addMessage('system', response.message);
    } catch (error: any) {
      const msg = error?.response?.data?.message || 'Failed to create alert from plan';
      toast.error(msg);
      addMessage('system', `Apply failed: ${msg}`);
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

  const loadAuditFirstPage = async () => {
    setAuditLoading(true);
    try {
      const page = await fetchAgentAudit({
        limit: 25,
        action: auditActionPrefix || undefined
      });
      setAuditEvents(page.events);
      setAuditNextBeforeId(page.nextBeforeId);
      setAuditHasMore(page.hasMore);
      setAuditLoaded(true);
    } catch {
      toast.error('Could not load policy audit log');
    } finally {
      setAuditLoading(false);
    }
  };

  const loadAuditMore = async () => {
    if (auditNextBeforeId == null || auditLoading) return;
    setAuditLoading(true);
    try {
      const page = await fetchAgentAudit({
        limit: 25,
        beforeId: auditNextBeforeId,
        action: auditActionPrefix || undefined
      });
      setAuditEvents((prev) => [...prev, ...page.events]);
      setAuditNextBeforeId(page.nextBeforeId);
      setAuditHasMore(page.hasMore);
    } catch {
      toast.error('Could not load more audit entries');
    } finally {
      setAuditLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-kib-fg">Dashboard</h1>
        <p className="text-kib-muted mt-2 max-w-3xl">
          Your home base: chat with the AI assistant, then review your watchlist, sizing hints, and opportunity output
          in one place.
        </p>
      </div>

      {showWatchlistSetupHint && (
        <div className="mb-6 rounded-xl border border-amber-500/35 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          <p className="font-medium font-mono">Watchlist grounding needs configuration</p>
          <p className="mt-1 text-amber-200/90">
            Set the same <code className="rounded bg-kib-bg px-1 border border-amber-500/30">AGENT_INTERNAL_SECRET</code> in the Node
            API and Python agent service, keep <code className="rounded bg-kib-bg px-1 border border-amber-500/30">NODE_BACKEND_URL</code>{' '}
            pointed at Node, and add symbols to your watchlist — or turn off <strong>Watchlist only</strong> in the controls.
          </p>
          <p className="mt-2">
            <Link to="/opportunity-signals" className="font-medium text-kib-cyber underline">
              Open signals inbox
            </Link>
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 flex flex-col gap-6">
          <div className="card p-0 overflow-hidden rounded-xl shadow-md ring-1 ring-teal-500/10">
          <div className="px-4 py-3 border-b border-kib-line bg-gradient-to-r from-kib-surface to-kib-card flex items-center justify-between">
            <h2 className="font-semibold font-mono text-kib-fg">AI assistant</h2>
            <span className={`text-xs font-mono px-2 py-1 rounded border ${isBusy ? 'border-amber-500/40 text-amber-200 bg-amber-950/50' : 'border-emerald-500/35 text-emerald-200 bg-emerald-950/40'}`}>
              {isBusy ? 'Processing' : 'Ready'}
            </span>
          </div>

          <div className="h-[480px] overflow-y-auto p-4 space-y-3 bg-kib-card">
            {messages.map((message) => (
              <div key={message.id} className={`max-w-[90%] ${message.role === 'user' ? 'ml-auto' : ''}`}>
                <div
                  className={`rounded-xl px-4 py-3 text-sm whitespace-pre-wrap ${
                    message.role === 'user'
                      ? 'bg-cyan-600 text-white border border-cyan-400/30'
                      : message.role === 'agent'
                        ? 'bg-kib-raise border border-kib-line text-kib-fg'
                        : 'bg-amber-950/60 text-amber-100 border border-amber-500/25'
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 border-t border-kib-line bg-kib-bg">
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => setInput('Create a stock alert strategy for AAPL with 4% and 9% dip thresholds')}
                className="text-xs px-2 py-1 rounded bg-kib-card border border-kib-line hover:bg-slate-800/80"
              >
                AAPL Strategy
              </button>
              <button
                onClick={() => setInput('Monitor TSLA volatility and suggest safer thresholds')}
                className="text-xs px-2 py-1 rounded bg-kib-card border border-kib-line hover:bg-slate-800/80"
              >
                TSLA Volatility Plan
              </button>
            </div>
            <div className="flex gap-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSend();
                }}
                placeholder="Tell the agent what alert strategy to build..."
                className="flex-1 input-field"
              />
              <button onClick={handleSend} disabled={isBusy || !input.trim()} className="btn-primary disabled:opacity-50">
                Send
              </button>
            </div>
          </div>
        </div>

        <section
          id="watchlist"
          className="rounded-xl border border-teal-500/20 bg-gradient-to-b from-kib-card via-kib-surface/90 to-kib-card p-5 sm:p-6 shadow-terminal ring-1 ring-teal-500/15"
        >
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-xl font-semibold text-kib-fg tracking-tight">Watchlist & sizing</h2>
                <p className="text-sm text-kib-muted mt-1 max-w-2xl">
                  Watchlist-style table: last price, day move, baseline and dip-band context — sizing uses{' '}
                  <strong>Max position size %</strong> in the sidebar.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadWatchlist()}
                disabled={watchlistLoading}
                className="btn-secondary text-xs py-1.5 px-3 whitespace-nowrap disabled:opacity-50"
              >
                {watchlistLoading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 sm:items-end mb-5 pb-5 border-b border-teal-100/80">
              <label className="flex-1 block text-sm font-medium text-slate-300">
                Stock ticker
                <div className="flex gap-2 mt-1.5">
                  <input
                    type="text"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    value={tickerInput}
                    onChange={(e) => setTickerInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleAddTicker();
                    }}
                    placeholder="e.g. AAPL or BRK.B"
                    className="input-field flex-1 font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void handleAddTicker()}
                    disabled={addTickerBusy || !tickerInput.trim()}
                    className="btn-primary whitespace-nowrap px-5 disabled:opacity-50"
                  >
                    {addTickerBusy ? 'Adding…' : 'Add'}
                  </button>
                </div>
              </label>
              <p className="text-xs text-slate-500 sm:max-w-xs sm:pb-1">
                Quotes stream in over the socket when the server finishes a price cycle (~1&nbsp;min snapshot from
                Massive/Polygon) and the table reconciles on a slower refresh. This is snapshot data, not broker
                order-book depth.
              </p>
            </div>

            <label className="block text-xs text-kib-muted mb-2">
              Optional portfolio value (USD) for dollar hints
              <input
                type="text"
                inputMode="decimal"
                placeholder="e.g. 50000"
                value={portfolioUsd}
                onChange={(e) => setPortfolioUsd(e.target.value)}
                className="input-field mt-1 w-full text-sm"
              />
            </label>
            {watchlistError && <p className="text-xs text-red-600 mb-2">{watchlistError}</p>}
            {!watchlistCtx?.items.length && !watchlistLoading && (
              <p className="text-sm text-kib-muted">
                Add a ticker above — we&apos;ll fetch a live quote, set a baseline, and show dip-band sizing hints here.
              </p>
            )}
            {watchlistCtx && watchlistCtx.items.length > 0 && (
              <>
                <p className="text-[11px] text-slate-500 mb-3">{watchlistCtx.policyNote}</p>
                <div className="overflow-x-auto rounded-xl border border-kib-line bg-kib-card shadow-sm ring-1 ring-slate-800">
                  <div className="max-h-[min(560px,62vh)] overflow-y-auto">
                    <table className="min-w-[1100px] w-full text-sm">
                      <thead className="sticky top-0 z-10 bg-kib-surface/95 backdrop-blur border-b border-kib-line">
                        <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-kib-muted">
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
                      <tbody className="divide-y divide-slate-800">
                        {sortedWatchlistItems.map((row) => {
                          const port = parsePortfolio();
                          const pct = row.sizing.suggestedPortfolioPct;
                          const dollarHint =
                            port != null && pct > 0 ? formatUsd((pct / 100) * port) : null;
                          return (
                            <tr
                              key={row.alertId}
                              className={`hover:bg-kib-raise/80 transition-colors ${
                                row.active ? '' : 'opacity-80'
                              }`}
                            >
                              <td className="px-3 py-2.5 pl-4 align-top">
                                <div className="flex flex-col gap-0.5">
                                  {row.assetType === 'stock' ? (
                                    <Link
                                      to="/charts"
                                      className="font-semibold font-mono text-kib-fg hover:text-kib-cyber w-fit"
                                      title="Open stock charts"
                                    >
                                      {row.symbol}
                                    </Link>
                                  ) : (
                                    <span className="font-semibold font-mono text-kib-fg">{row.symbol}</span>
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
                                <span className="font-medium text-teal-300">{row.sizing.tierLabel}</span>
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums align-top">
                                <div className="font-medium text-kib-fg">{pct}%</div>
                                {dollarHint && (
                                  <div className="text-[10px] text-slate-500">{dollarHint}</div>
                                )}
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
            <p className="mt-3 text-[11px] text-slate-500">
              Educational only — not investment advice. Verify trades with your own criteria.
            </p>
        </section>

        </div>

        <aside className="lg:col-span-4 space-y-6">
          <div className="card border-kib-line rounded-xl shadow-sm ring-1 ring-teal-500/10">
            <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
              <div>
                <h3 className="text-lg font-semibold text-kib-fg">Investor pulse (X)</h3>
                <p className="text-xs text-kib-muted mt-1">
                  Live posts from accounts you configure server-side, plus cashtag buzz across those posts.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadXPulse()}
                disabled={xPulseLoading}
                className="btn-secondary text-xs py-1.5 px-3 whitespace-nowrap disabled:opacity-50"
              >
                {xPulseLoading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
            {xPulse?.warning && (
              <div className="mb-3 rounded-lg bg-kib-raise border border-kib-line px-3 py-2 text-xs text-slate-300">
                {xPulse.warning}
              </div>
            )}
            {xPulse?.configured && xPulse.accounts.length > 0 && (
              <p className="text-[11px] text-slate-500 mb-2">
                Monitoring {xPulse.accounts.map((a) => `@${a.username || a.id}`).join(', ')}
              </p>
            )}
            {xPulse && xPulse.tickerBuzz.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-slate-300 mb-1">Cashtag attention (this fetch)</p>
                <div className="flex flex-wrap gap-1.5">
                  {xPulse.tickerBuzz.map((b) => (
                    <span
                      key={b.symbol}
                      className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800"
                    >
                      ${b.symbol}
                      <span className="ml-1 text-slate-500">×{b.mentions}</span>
                    </span>
                  ))}
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  Mentions are not buy signals — cross-check fundamentals and your rules.
                </p>
              </div>
            )}
            <div className="max-h-[min(280px,40vh)] overflow-y-auto space-y-2 border-t border-slate-800 pt-3">
              {xPulse && xPulse.tweets.length === 0 && !xPulseLoading && (
                <p className="text-xs text-kib-muted">No posts in this window — check API limits or account IDs.</p>
              )}
              {xPulse?.tweets.map((tw) => (
                <article key={tw.id} className="text-xs border-b border-slate-800 pb-2 last:border-0">
                  <div className="flex justify-between gap-2 text-slate-500">
                    <span>
                      @{tw.monitorUsername || tw.authorUsername || 'user'}{' '}
                      <span className="text-slate-500">· {tw.monitorLabel}</span>
                    </span>
                    <time dateTime={tw.createdAt}>{new Date(tw.createdAt).toLocaleString()}</time>
                  </div>
                  <p className="text-kib-fg mt-1 whitespace-pre-wrap">{tw.text}</p>
                  {tw.cashtags.length > 0 && (
                    <p className="text-[10px] text-teal-700 mt-1">{tw.cashtags.map((c) => `$${c}`).join(' ')}</p>
                  )}
                </article>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold text-kib-fg mb-3">Agent Controls</h3>
            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="text-slate-300">Top candidates</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={agentPreferences.topN}
                  onChange={(e) => setAgentPreferences((prev) => ({ ...prev, topN: Number(e.target.value) }))}
                  className="input-field mt-1 w-full"
                />
              </label>
              <label className="block">
                <span className="text-slate-300">Confidence floor (0-1)</span>
                <input
                  type="number"
                  step={0.01}
                  min={0.1}
                  max={0.95}
                  value={agentPreferences.confidenceFloor}
                  onChange={(e) => setAgentPreferences((prev) => ({ ...prev, confidenceFloor: Number(e.target.value) }))}
                  className="input-field mt-1 w-full"
                />
              </label>
              <label className="block">
                <span className="text-slate-300">Max position size %</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={agentPreferences.maxPositionSizePct}
                  onChange={(e) => setAgentPreferences((prev) => ({ ...prev, maxPositionSizePct: Number(e.target.value) }))}
                  className="input-field mt-1 w-full"
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={agentPreferences.watchlistOnly}
                  onChange={(e) => setAgentPreferences((prev) => ({ ...prev, watchlistOnly: e.target.checked }))}
                />
                Watchlist only
              </label>
            </div>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold text-kib-fg mb-3">Execution Controls</h3>
            <label className="flex items-center gap-2 text-sm text-slate-300 mb-4">
              <input
                type="checkbox"
                checked={autoApply}
                onChange={(e) => setAutoApply(e.target.checked)}
              />
              Auto-apply alert drafts after agent reply
            </label>
            <p className="text-xs text-slate-500 mb-2">
              Creates or updates the draft symbol using 5% / 10% / 15% thresholds (same as &quot;Apply&quot; on a
              candidate card).
            </p>
            <button
              onClick={applyLatestPlan}
              disabled={isBusy || !latestPlan?.proposedAlert}
              className="w-full btn-secondary disabled:opacity-50"
            >
              Apply latest draft to alerts
            </button>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold text-kib-fg mb-3">Latest Plan</h3>
            {latestPlan?.proposedAlert ? (
              <div className="text-sm text-slate-300 space-y-2">
                <p><span className="font-medium">Symbol:</span> {latestPlan.proposedAlert.symbol}</p>
                <p><span className="font-medium">Asset:</span> {latestPlan.proposedAlert.assetType}</p>
                <p>
                  <span className="font-medium">Thresholds:</span>{' '}
                  {latestPlan.proposedAlert.smallThreshold}% / {latestPlan.proposedAlert.mediumThreshold}% / {latestPlan.proposedAlert.largeThreshold}%
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
        </aside>
      </div>

      <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card rounded-xl shadow-sm ring-1 ring-teal-500/10">
            <h3 className="text-lg font-semibold text-kib-fg mb-3">Top opportunities</h3>
            {currentOutput?.topCandidates?.length ? (
              <div className="space-y-3 text-sm text-slate-300">
                {currentOutput.topCandidates.map((candidate) => (
                  <div key={candidate.symbol} className="rounded-lg border border-kib-line p-3 space-y-2 bg-kib-card">
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
                      className="mt-1 w-full btn-primary text-xs py-2 disabled:opacity-50"
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

          <div className="card rounded-xl shadow-sm ring-1 ring-teal-500/10">
            <h3 className="text-lg font-semibold text-kib-fg mb-3">Run metadata</h3>
            {currentRunMetadata ? (
              <div className="text-sm text-slate-300 space-y-1">
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
      </div>

      <div className="mt-6 card rounded-xl shadow-sm ring-1 ring-teal-500/10 p-5 sm:p-6">
            <div className="flex flex-col gap-3 mb-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold text-kib-fg">Policy audit</h3>
                  <p className="text-xs text-kib-muted mt-1">
                    Filter by action prefix, paginate with <strong>Load more</strong>. Match{' '}
                    <code className="rounded bg-slate-800/80 px-1">agentRunId</code> to Run ID.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-kib-muted flex items-center gap-1">
                    Filter
                    <select
                      value={auditActionPrefix}
                      onChange={(e) => {
                        const v = e.target.value;
                        setAuditActionPrefix(v);
                        setAuditEvents([]);
                        setAuditNextBeforeId(null);
                        setAuditHasMore(false);
                        setAuditLoaded(false);
                      }}
                      className="input-field text-xs py-1 max-w-[180px]"
                    >
                      <option value="">All actions</option>
                      <option value="agent_apply">Agent apply…</option>
                      <option value="internal">Internal API…</option>
                      <option value="user_alert">User alert…</option>
                      <option value="quota">Quota…</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => void loadAuditFirstPage()}
                    disabled={auditLoading}
                    className="btn-secondary text-xs py-1.5 px-3 whitespace-nowrap disabled:opacity-50"
                  >
                    {auditLoading && auditEvents.length === 0 ? 'Loading…' : auditLoaded ? 'Refresh' : 'Load'}
                  </button>
                </div>
              </div>
            </div>
            {auditLoaded && auditEvents.length === 0 && (
              <p className="text-sm text-kib-muted">No audit entries for this filter.</p>
            )}
            {auditEvents.length > 0 && (
              <>
                <div className="overflow-x-auto max-h-72 overflow-y-auto text-xs">
                  <table className="min-w-full text-left">
                    <thead className="sticky top-0 bg-kib-card border-b border-kib-line">
                      <tr className="text-kib-muted">
                        <th className="py-1 pr-2 font-medium">Time</th>
                        <th className="py-1 pr-2 font-medium">Action</th>
                        <th className="py-1 font-medium">Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditEvents.map((ev) => (
                        <tr key={ev.id} className="border-b border-slate-800 align-top">
                          <td className="py-1.5 pr-2 whitespace-nowrap text-slate-300">
                            {new Date(ev.created_at).toLocaleString()}
                          </td>
                          <td className="py-1.5 pr-2 text-slate-300">{ev.action}</td>
                          <td className="py-1.5 font-mono text-[11px] text-slate-300 break-all">
                            {JSON.stringify(ev.detail)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {auditHasMore && (
                  <button
                    type="button"
                    onClick={() => void loadAuditMore()}
                    disabled={auditLoading}
                    className="mt-3 w-full btn-secondary text-xs py-2 disabled:opacity-50"
                  >
                    {auditLoading ? 'Loading…' : 'Load more'}
                  </button>
                )}
              </>
            )}
      </div>
    </div>
  );
};

export default AIAgentPage;
