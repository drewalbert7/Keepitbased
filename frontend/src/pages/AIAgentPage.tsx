import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  AgentMessage,
  AgentPreferences,
  chatWithAgent,
  fetchAgentWatchlistContext,
  type AssistantIntentMode,
  type WatchlistContextItem,
  type WatchlistContextResponse
} from '../services/aiAgentService';
import { isTwStockSymbol, removeWatchlistSymbol } from '../services/watchlistApi';
import { useSocket } from '../contexts/SocketContext';
import {
  chartQuoteToPriceUpdatePayload,
  cryptoTickerToPriceUpdatePayload,
  mergeWatchlistPriceUpdates,
  overlayFresherWatchlistQuotes
} from '../utils/watchlistDerived';
import { getStockQuote, type QuoteData } from '../services/chartService';
import { getCryptoTicker, polygonPairFromCryptoBase, type CryptoTicker } from '../services/cryptoService';
import { OpportunityPolicyPanel } from '../components/OpportunityPolicyPanel';
import { ResizablePair } from '../components/ResizablePair';
import { WatchlistStockSearchInput } from '../components/WatchlistStockSearchInput';
import { WatchlistTwStockSearchInput } from '../components/WatchlistTwStockSearchInput';
import { WatchlistCryptoSearchInput } from '../components/WatchlistCryptoSearchInput';
import { Watchlist52WeekRange } from '../components/Watchlist52WeekRange';
import { StockFundamentalsModal } from '../components/StockFundamentalsModal';
import { DeployListPanel } from '../components/DeployListPanel';
import { QuantAgiSuggestionsPanel } from '../components/QuantAgiSuggestionsPanel';
import { secIssuerBrowseUrl } from '../services/fundamentalsApi';
import {
  addDeployListItem,
  clearDeployList,
  fetchDeployList,
  isDeploySelectableRow,
  optimizeDeployList,
  removeDeployListItem,
  type DeployListItem
} from '../services/deployListApi';
import LoadingSpinner from '../components/ui/LoadingSpinner';

const seedMessages: AgentMessage[] = [
  {
    id: 'm-1',
    role: 'system',
    content:
      '**Grok** answers any question quickly. **Watchlist analyst** scans your dashboard list with live quotes, scores, and dip-band context. Educational only — not investment advice.',
    timestamp: new Date().toISOString()
  }
];

export const AIAgentPage: React.FC = () => {
  const [messages, setMessages] = useState<AgentMessage[]>(seedMessages);
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [currentRunMetadata, setCurrentRunMetadata] = useState<{
    runId: string;
    nodeTimings: { langgraphInvokeMs: number; totalMs: number };
    providerUsed: string;
    fallbackUsed: boolean;
  } | null>(null);
  const [lastAgentReply, setLastAgentReply] = useState('');

  const [watchlistCtx, setWatchlistCtx] = useState<WatchlistContextResponse | null>(null);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  /** After first loadWatchlist completes (success or error); avoids empty flash on login. */
  const [watchlistHydrated, setWatchlistHydrated] = useState(false);
  const watchlistHydratedRef = useRef(false);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const { socket } = useSocket();

  type WlSortKey = 'symbol' | 'dayPct' | 'vsBase';
  const [wlSort, setWlSort] = useState<{ key: WlSortKey; dir: 1 | -1 }>({ key: 'symbol', dir: 1 });

  /** Table rows: all symbols, stocks only, or crypto only */
  type WlAssetTab = 'all' | 'stock' | 'crypto';
  const [wlAssetTab, setWlAssetTab] = useState<WlAssetTab>('all');
  /** Add form: one search at a time for clearer layout */
  const [wlAddTab, setWlAddTab] = useState<'stock' | 'tw' | 'crypto'>('stock');

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

  /** Matches backend `assistantIntent`: scan vs Q&A vs heuristic routing. */
  /** Watchlist row → fundamentals + SEC filings (stocks only) */
  const [wlFundamentalsSymbol, setWlFundamentalsSymbol] = useState<string | null>(null);

  const [deployItems, setDeployItems] = useState<DeployListItem[]>([]);
  const [deployTotalPct, setDeployTotalPct] = useState(0);
  const [deployLoading, setDeployLoading] = useState(false);
  const [deployListLoaded, setDeployListLoaded] = useState(false);
  const [deployOptimizing, setDeployOptimizing] = useState(false);
  const [deployTogglingIds, setDeployTogglingIds] = useState<Set<number>>(() => new Set());
  const deployAlertIds = useMemo(
    () => new Set(deployItems.map((d) => d.userAlertId)),
    [deployItems]
  );

  const patchWatchlistDeployFlag = useCallback((alertId: number, onDeployList: boolean) => {
    setWatchlistCtx((prev) => {
      if (!prev?.items?.length) return prev;
      return {
        ...prev,
        items: prev.items.map((item) =>
          item.alertId === alertId ? { ...item, onDeployList } : item
        )
      };
    });
  }, []);

  const [assistantMode, setAssistantMode] = useState<AssistantIntentMode>('grok_chat');
  /** Progressive character reveal after the full reply arrives (not live token streaming). */
  const [streamReplyDisplay, setStreamReplyDisplay] = useState(true);
  const revealRafRef = useRef<number | null>(null);

  const watchlistRef = useRef(watchlistCtx);
  watchlistRef.current = watchlistCtx;
  const watchlistLoadGenRef = useRef(0);

  /** Drives ~10s polling for live stock + crypto quotes on visible watchlist rows */
  const watchlistPollSignature = useMemo(() => {
    if (!watchlistCtx?.items?.length) return '';
    return watchlistCtx.items
      .map((i) => `${i.assetType}:${i.symbol.toUpperCase()}`)
      .sort()
      .join(',');
  }, [watchlistCtx?.items]);

  const loadDeployList = useCallback(async () => {
    setDeployLoading(true);
    try {
      const data = await fetchDeployList();
      setDeployItems(data.items);
      setDeployTotalPct(data.totalTargetWeightPct);
      setDeployListLoaded(true);
    } catch {
      /* non-fatal */
    } finally {
      setDeployLoading(false);
    }
  }, []);

  const loadWatchlist = useCallback(async () => {
    const gen = ++watchlistLoadGenRef.current;
    setWatchlistLoading(true);
    setWatchlistError(null);
    try {
      const data = await fetchAgentWatchlistContext(agentPreferences.maxPositionSizePct);
      if (gen !== watchlistLoadGenRef.current) return;

      const stockSymbols = Array.from(
        new Set(
          data.items
            .filter((i) => i.assetType === 'stock' && !isTwStockSymbol(i.symbol))
            .map((i) => i.symbol.toUpperCase())
        )
      );
      let merged = data;
      if (stockSymbols.length) {
        const results = await Promise.all(stockSymbols.map((s) => getStockQuote(s).catch(() => null)));
        if (gen !== watchlistLoadGenRef.current) return;
        const payloads = results
          .filter((q): q is QuoteData => q !== null)
          .map(chartQuoteToPriceUpdatePayload);
        if (payloads.length) {
          merged = mergeWatchlistPriceUpdates(merged, payloads, Date.now()) ?? merged;
        }
      }

      const cryptoPolyKeys = Array.from(
        new Set(
          merged.items
            .filter((i) => i.assetType === 'crypto')
            .map((i) => polygonPairFromCryptoBase(i.symbol))
        )
      );
      if (cryptoPolyKeys.length) {
        const cr = await Promise.all(cryptoPolyKeys.map((p) => getCryptoTicker(p).catch(() => null)));
        if (gen !== watchlistLoadGenRef.current) return;
        const tickerMap = new Map<string, CryptoTicker | null>();
        cryptoPolyKeys.forEach((poly, idx) => {
          tickerMap.set(poly, cr[idx]);
        });
        const cryptoPayloads: Array<Record<string, unknown>> = [];
        for (const row of merged.items) {
          if (row.assetType !== 'crypto') continue;
          const poly = polygonPairFromCryptoBase(row.symbol);
          const t = tickerMap.get(poly);
          if (t) cryptoPayloads.push(cryptoTickerToPriceUpdatePayload(t, row.symbol));
        }
        if (cryptoPayloads.length) {
          merged = mergeWatchlistPriceUpdates(merged, cryptoPayloads, Date.now()) ?? merged;
        }
      }

      if (gen !== watchlistLoadGenRef.current) return;

      setWatchlistCtx((prev) => {
        if (gen !== watchlistLoadGenRef.current) return prev;
        return overlayFresherWatchlistQuotes(merged, prev);
      });
    } catch {
      if (gen === watchlistLoadGenRef.current) {
        setWatchlistError('Could not load watchlist prices.');
      }
    } finally {
      if (gen === watchlistLoadGenRef.current) {
        setWatchlistLoading(false);
        if (!watchlistHydratedRef.current) {
          watchlistHydratedRef.current = true;
          setWatchlistHydrated(true);
        }
      }
    }
  }, [agentPreferences.maxPositionSizePct]);

  useEffect(() => {
    return () => {
      if (revealRafRef.current != null) {
        cancelAnimationFrame(revealRafRef.current);
        revealRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!watchlistPollSignature) return;
    let cancelled = false;

    const runBatch = async () => {
      const ctx = watchlistRef.current;
      if (!ctx?.items?.length) return;

      const stockSyms = Array.from(
        new Set(
          ctx.items
            .filter((i) => i.assetType === 'stock' && !isTwStockSymbol(i.symbol))
            .map((i) => i.symbol.toUpperCase())
        )
      );
      const cryptoPolys = Array.from(
        new Set(
          ctx.items
            .filter((i) => i.assetType === 'crypto')
            .map((i) => polygonPairFromCryptoBase(i.symbol))
        )
      );

      const payloads: Array<Record<string, unknown>> = [];

      if (stockSyms.length) {
        const results = await Promise.all(stockSyms.map((s) => getStockQuote(s).catch(() => null)));
        if (cancelled) return;
        payloads.push(
          ...results
            .filter((q): q is QuoteData => q !== null)
            .map(chartQuoteToPriceUpdatePayload)
        );
      }

      if (cryptoPolys.length) {
        const cr = await Promise.all(cryptoPolys.map((p) => getCryptoTicker(p).catch(() => null)));
        if (cancelled) return;
        const tickerMap = new Map<string, CryptoTicker | null>();
        cryptoPolys.forEach((poly, idx) => tickerMap.set(poly, cr[idx]));
        for (const row of ctx.items) {
          if (row.assetType !== 'crypto') continue;
          const poly = polygonPairFromCryptoBase(row.symbol);
          const t = tickerMap.get(poly);
          if (t) payloads.push(cryptoTickerToPriceUpdatePayload(t, row.symbol));
        }
      }

      if (!payloads.length) return;
      setWatchlistCtx((prev) => mergeWatchlistPriceUpdates(prev, payloads, Date.now()));
    };

    void runBatch();
    const handle = window.setInterval(() => void runBatch(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [watchlistPollSignature]);

  useEffect(() => {
    void loadWatchlist();
    void loadDeployList();
    /** Reconcile with server (baselines, new rows); live quotes also merge via Socket `priceUpdate`. */
    const id = window.setInterval(() => void loadWatchlist(), 90_000);
    return () => window.clearInterval(id);
  }, [loadWatchlist, loadDeployList]);

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

  const formatBidAskCell = (row: WatchlistContextItem) => {
    const b = row.bidPrice;
    const a = row.askPrice;
    const hasB = b != null && Number.isFinite(Number(b));
    const hasA = a != null && Number.isFinite(Number(a));
    if (!hasB && !hasA) return '—';
    const bidStr = hasB ? formatQuote(Number(b), row.assetType) : '—';
    const askStr = hasA ? formatQuote(Number(a), row.assetType) : '—';
    let bpsLine: React.ReactElement | null = null;
    if (hasB && hasA) {
      const nb = Number(b);
      const na = Number(a);
      const mid = (nb + na) / 2;
      const bps = mid > 0 ? ((na - nb) / mid) * 10000 : null;
      if (bps != null && Number.isFinite(bps)) {
        bpsLine = (
          <div className="text-[10px] tabular-nums text-kib-muted">{bps.toFixed(1)} bps spread</div>
        );
      }
    }
    return (
      <div className="text-right">
        <div className="tabular-nums">
          {bidStr} <span className="text-kib-muted">/</span> {askStr}
        </div>
        {bpsLine}
      </div>
    );
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

  const wlCounts = useMemo(() => {
    const items = watchlistCtx?.items ?? [];
    let stocks = 0;
    let crypto = 0;
    for (const i of items) {
      if (i.assetType === 'crypto') crypto += 1;
      else stocks += 1;
    }
    return { stocks, crypto, total: items.length };
  }, [watchlistCtx?.items]);

  const filteredWatchlistItems = useMemo(() => {
    if (wlAssetTab === 'all') return sortedWatchlistItems;
    return sortedWatchlistItems.filter((row) =>
      wlAssetTab === 'crypto' ? row.assetType === 'crypto' : row.assetType === 'stock'
    );
  }, [sortedWatchlistItems, wlAssetTab]);

  const wlTabBtn = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-xs font-semibold transition-colors sm:text-[13px] ${
      active
        ? 'bg-white/[0.14] text-kib-fg shadow-sm ring-1 ring-white/[0.12]'
        : 'text-kib-muted hover:bg-white/[0.06] hover:text-kib-fg'
    }`;

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

  const handleToggleDeploy = async (row: WatchlistContextItem, checked: boolean) => {
    if (!isDeploySelectableRow(row.assetType, row.symbol, row.active)) return;
    if (deployTogglingIds.has(row.alertId)) return;

    const priorItems = deployItems;
    const priorOnDeploy = deployListLoaded
      ? deployAlertIds.has(row.alertId)
      : row.onDeployList === true;

    setDeployTogglingIds((prev) => new Set(prev).add(row.alertId));
    patchWatchlistDeployFlag(row.alertId, checked);
    if (checked) {
      const pct = row.sizing?.suggestedPortfolioPct;
      const weight = pct != null && pct > 0 ? pct : null;
      setDeployItems((prev) => {
        if (prev.some((d) => d.userAlertId === row.alertId)) return prev;
        return [
          ...prev,
          {
            id: 0,
            userAlertId: row.alertId,
            symbol: row.symbol,
            assetType: row.assetType,
            baselinePrice: row.baselinePrice,
            targetWeightPct: weight,
            suggestedLimitMin: null,
            suggestedLimitMax: null,
            source: 'manual',
            grokRationale: null,
            status: 'active',
            lastOptimizedAt: null,
            updatedAt: new Date().toISOString()
          }
        ];
      });
    } else {
      setDeployItems((prev) => prev.filter((d) => d.userAlertId !== row.alertId));
    }

    try {
      if (checked) {
        const pct = row.sizing?.suggestedPortfolioPct;
        await addDeployListItem(
          row.alertId,
          pct != null && pct > 0 ? pct : undefined
        );
        toast.success(`${row.symbol} added to deploy list`);
      } else {
        await removeDeployListItem(row.alertId);
        toast.success(`${row.symbol} removed from deploy list`);
      }
      await loadDeployList();
    } catch (error: unknown) {
      patchWatchlistDeployFlag(row.alertId, priorOnDeploy);
      setDeployItems(priorItems);
      const msg = axios.isAxiosError(error)
        ? String(error.response?.data?.message || '') || error.message
        : 'Deploy list update failed';
      toast.error(msg);
    } finally {
      setDeployTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(row.alertId);
        return next;
      });
    }
  };

  const handleOptimizeDeployList = async () => {
    setDeployOptimizing(true);
    try {
      const result = await optimizeDeployList();
      setDeployItems(result.items);
      const total = result.items.reduce((s, it) => s + (it.targetWeightPct || 0), 0);
      setDeployTotalPct(Number(total.toFixed(2)));
      toast.success(result.message);
      await loadWatchlist();
    } catch (error: unknown) {
      const msg = axios.isAxiosError(error)
        ? String(error.response?.data?.message || '') || error.message
        : 'Grok optimization failed';
      toast.error(msg);
    } finally {
      setDeployOptimizing(false);
    }
  };

  const handleClearDeployList = async () => {
    try {
      await clearDeployList();
      setDeployItems([]);
      setDeployTotalPct(0);
      setWatchlistCtx((prev) => {
        if (!prev?.items?.length) return prev;
        return {
          ...prev,
          items: prev.items.map((item) => ({ ...item, onDeployList: false }))
        };
      });
      toast.success('Deploy list cleared');
      await loadWatchlist();
    } catch {
      toast.error('Could not clear deploy list');
    }
  };

  const handleRemoveTicker = async (symbol: string, assetType: 'stock' | 'crypto' = 'stock') => {
    try {
      await removeWatchlistSymbol(symbol, assetType);
      toast.success(`${symbol} removed from watchlist`);
      await loadWatchlist();
      await loadDeployList();
    } catch (error: unknown) {
      const msg = axios.isAxiosError(error)
        ? String(error.response?.data?.message || '') || error.message
        : 'Could not remove symbol';
      toast.error(msg);
    }
  };

  const addMessage = (role: AgentMessage['role'], content: string): string => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setMessages((prev) => [
      ...prev,
      {
        id,
        role,
        content,
        timestamp: new Date().toISOString()
      }
    ]);
    return id;
  };

  const revealReplyProgressively = useCallback((messageId: string, full: string) => {
    if (!full.length) return;
    let idx = 0;
    const chunk = Math.max(2, Math.min(8, Math.ceil(full.length / 120)));
    const tick = () => {
      idx = Math.min(full.length, idx + chunk);
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, content: full.slice(0, idx) } : m))
      );
      if (idx < full.length) {
        revealRafRef.current = requestAnimationFrame(tick);
      } else {
        revealRafRef.current = null;
      }
    };
    revealRafRef.current = requestAnimationFrame(tick);
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isBusy) return;
    if (revealRafRef.current != null) {
      cancelAnimationFrame(revealRafRef.current);
      revealRafRef.current = null;
    }
    const prompt = input.trim();
    const conversationHistory = messages
      .filter((m) => m.role === 'user' || m.role === 'agent')
      .slice(-12)
      .map((m) => ({
        role: (m.role === 'agent' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: m.content
      }));

    setInput('');
    setIsBusy(true);
    addMessage('user', prompt);
    const agentMessageId = addMessage('agent', '');

    try {
      const response = await chatWithAgent(prompt, 'recommend_only', agentPreferences, {
        assistantIntent: assistantMode,
        conversationHistory
      });
      setCurrentRunMetadata(response.runMetadata || null);
      setAgentPreferences(response.preferencesUsed);
      setLastAgentReply(response.reply);
      const full = response.reply || '';
      if (streamReplyDisplay && full.length > 0) {
        revealReplyProgressively(agentMessageId, full);
      } else {
        setMessages((prev) =>
          prev.map((m) => (m.id === agentMessageId ? { ...m, content: full } : m))
        );
      }
    } catch (error: any) {
      setMessages((prev) => prev.filter((m) => m.id !== agentMessageId));
      const msg = error?.response?.data?.message || 'Agent request failed';
      addMessage('system', `Agent failed: ${msg}`);
      toast.error(msg);
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
          Watchlist and alert policy first — then ask Grok anything, or run the watchlist analyst.
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
            <div className="mb-5 flex flex-col gap-4 border-b border-white/[0.06] pb-5">
              <div>
                <p className="text-sm font-medium text-kib-fg">Add to watchlist</p>
                <p className="mt-0.5 text-xs text-kib-muted">
                  Choose asset type, then search. Same list for stocks and crypto — quotes poll ~10s with socket merge
                  (not broker feeds).
                </p>
                <div
                  className="mt-3 inline-flex w-full max-w-md flex-wrap gap-1 rounded-lg border border-white/[0.08] bg-black/25 p-1 sm:w-auto"
                  role="tablist"
                  aria-label="Add symbol type"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={wlAddTab === 'stock'}
                    onClick={() => setWlAddTab('stock')}
                    className={wlTabBtn(wlAddTab === 'stock')}
                  >
                    US stock
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={wlAddTab === 'tw'}
                    onClick={() => setWlAddTab('tw')}
                    className={wlTabBtn(wlAddTab === 'tw')}
                  >
                    Taiwan (TWSE)
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={wlAddTab === 'crypto'}
                    onClick={() => setWlAddTab('crypto')}
                    className={wlTabBtn(wlAddTab === 'crypto')}
                  >
                    Crypto
                  </button>
                </div>
                <div className="mt-3 max-w-xl">
                  {wlAddTab === 'stock' ? (
                    <WatchlistStockSearchInput
                      onSymbolAdded={() => void loadWatchlist()}
                      disabled={watchlistLoading}
                    />
                  ) : wlAddTab === 'tw' ? (
                    <WatchlistTwStockSearchInput
                      onSymbolAdded={() => void loadWatchlist()}
                      disabled={watchlistLoading}
                    />
                  ) : (
                    <WatchlistCryptoSearchInput
                      onSymbolAdded={() => void loadWatchlist()}
                      disabled={watchlistLoading}
                    />
                  )}
                </div>
              </div>
            </div>

            {watchlistError && <p className="text-xs text-red-600 mb-2">{watchlistError}</p>}
            {!watchlistHydrated ? (
              <div
                className="flex min-h-[min(200px,28vh)] flex-col items-center justify-center gap-3 rounded-lg border border-white/[0.06] bg-kib-surface/50 py-10"
                role="status"
                aria-live="polite"
                aria-busy="true"
              >
                <LoadingSpinner size="md" />
                <p className="text-xs text-kib-muted">Loading watchlist and quotes…</p>
              </div>
            ) : (
              <>
                {!watchlistCtx?.items.length && !watchlistLoading && (
                  <p className="text-sm text-kib-muted">
                    Add a stock or crypto above — we&apos;ll fetch a live quote, set a baseline, and show dip-band sizing hints
                    here.
                  </p>
                )}
                {watchlistCtx && watchlistCtx.items.length > 0 && (
              <>
                <p className="text-[11px] text-slate-500 mb-3">{watchlistCtx.policyNote}</p>

                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                  <div
                    className="inline-flex w-full flex-wrap gap-1 rounded-lg border border-white/[0.08] bg-kib-surface/80 p-1 sm:w-auto"
                    role="tablist"
                    aria-label="Watchlist asset filter"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={wlAssetTab === 'all'}
                      onClick={() => setWlAssetTab('all')}
                      className={wlTabBtn(wlAssetTab === 'all')}
                    >
                      All{' '}
                      <span className="tabular-nums text-kib-muted">({wlCounts.total})</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={wlAssetTab === 'stock'}
                      onClick={() => setWlAssetTab('stock')}
                      className={wlTabBtn(wlAssetTab === 'stock')}
                    >
                      Stocks{' '}
                      <span className="tabular-nums text-kib-muted">({wlCounts.stocks})</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={wlAssetTab === 'crypto'}
                      onClick={() => setWlAssetTab('crypto')}
                      className={wlTabBtn(wlAssetTab === 'crypto')}
                    >
                      Crypto{' '}
                      <span className="tabular-nums text-kib-muted">({wlCounts.crypto})</span>
                    </button>
                  </div>
                </div>

                {filteredWatchlistItems.length === 0 && (
                  <p className="mb-3 rounded-lg border border-amber-500/20 bg-amber-950/15 px-3 py-2 text-sm text-amber-100/90">
                    No {wlAssetTab === 'stock' ? 'stocks' : 'crypto'} on this watchlist. Switch to{' '}
                    <button
                      type="button"
                      className="font-semibold text-kib-cyber underline-offset-2 hover:underline"
                      onClick={() => setWlAssetTab('all')}
                    >
                      All
                    </button>{' '}
                    or add symbols above.
                  </p>
                )}

                <p className="mb-2 text-[11px] text-kib-muted lg:hidden">
                  Scroll horizontally for the full watchlist — same columns as desktop.
                </p>
                <div className="-mx-1 overflow-x-auto rounded-lg border border-white/[0.06] bg-kib-surface px-1 sm:mx-0 sm:px-0">
                  <div className="max-h-[min(70vh,560px)] overflow-y-auto overscroll-x-contain sm:max-h-[min(520px,65vh)]">
                    <table className="w-full min-w-[1420px] text-[13px] sm:min-w-[1520px] sm:text-sm">
                      <thead className="sticky top-0 z-20 border-b border-white/[0.06] bg-kib-surface/95 backdrop-blur-sm">
                        <tr className="text-left text-[10px] font-medium uppercase tracking-wide text-kib-muted sm:text-[11px]">
                          <th
                            className="sticky left-0 top-0 z-30 w-12 border-r border-white/[0.06] bg-kib-surface/95 px-1 py-2.5 text-center lg:static lg:z-auto lg:w-14 lg:border-0 lg:bg-transparent lg:px-2 lg:py-3"
                            title="Capital deploy list (US stocks)"
                          >
                            Deploy
                          </th>
                          <th className="sticky left-12 top-0 z-30 border-r border-white/[0.06] bg-kib-surface/95 px-2 py-2.5 pl-2 shadow-[4px_0_12px_-4px_rgba(0,0,0,0.5)] lg:static lg:left-auto lg:top-auto lg:z-auto lg:border-0 lg:bg-transparent lg:px-3 lg:py-3 lg:pl-4 lg:shadow-none">
                            <button
                              type="button"
                              onClick={() => toggleWlSort('symbol')}
                              className="font-semibold uppercase tracking-wide hover:text-kib-cyber text-left"
                            >
                              Symbol{wlSort.key === 'symbol' ? (wlSort.dir === 1 ? ' ↑' : ' ↓') : ''}
                            </button>
                          </th>
                          <th className="px-2 py-2.5 text-right tabular-nums lg:px-3 lg:py-3">Last</th>
                          <th className="px-2 py-2.5 text-right tabular-nums lg:px-3 lg:py-3">
                            <button
                              type="button"
                              onClick={() => toggleWlSort('dayPct')}
                              className="font-semibold uppercase tracking-wide hover:text-kib-cyber ml-auto block w-full text-right"
                            >
                              Day %{wlSort.key === 'dayPct' ? (wlSort.dir === 1 ? ' ↑' : ' ↓') : ''}
                            </button>
                          </th>
                          <th className="px-2 py-2.5 text-right tabular-nums lg:px-3 lg:py-3">Volume</th>
                          <th
                            className="px-2 py-2.5 text-right tabular-nums lg:px-3 lg:py-3"
                            title="Session open (vendor snapshot when available)"
                          >
                            Open
                          </th>
                          <th
                            className="px-2 py-2.5 text-right tabular-nums lg:px-3 lg:py-3"
                            title="Session VWAP — Polygon/Massive day.vw when present"
                          >
                            VWAP
                          </th>
                          <th
                            className="px-2 py-2.5 text-right tabular-nums lg:px-3 lg:py-3"
                            title="Best bid / best ask from snapshot or exchange 24h ticker"
                          >
                            Bid / Ask
                          </th>
                          <th className="px-2 py-2.5 text-right tabular-nums lg:px-3 lg:py-3">Day range</th>
                          <th className="min-w-[128px] px-2 py-2.5 lg:min-w-[140px] lg:px-3 lg:py-3">52W range</th>
                          <th className="px-2 py-2.5 text-right tabular-nums lg:px-3 lg:py-3">Baseline</th>
                          <th className="px-2 py-2.5 text-right tabular-nums lg:px-3 lg:py-3">
                            <button
                              type="button"
                              onClick={() => toggleWlSort('vsBase')}
                              className="font-semibold uppercase tracking-wide hover:text-kib-cyber ml-auto block w-full text-right"
                            >
                              vs baseline{wlSort.key === 'vsBase' ? (wlSort.dir === 1 ? ' ↑' : ' ↓') : ''}
                            </button>
                          </th>
                          <th className="max-w-[120px] px-2 py-2.5 lg:max-w-[140px] lg:px-3 lg:py-3">Next dip</th>
                          <th className="max-w-[140px] px-2 py-2.5 lg:max-w-[160px] lg:px-3 lg:py-3">Signal</th>
                          <th className="px-2 py-2.5 text-right tabular-nums lg:px-3 lg:py-3">Size %</th>
                          <th className="w-12 px-1 py-2.5 pr-2 lg:w-14 lg:px-3 lg:py-3 lg:pr-4" aria-label="Remove" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.06]">
                        {filteredWatchlistItems.map((row) => {
                          const pct = row.sizing.suggestedPortfolioPct;
                          const canDeploy = isDeploySelectableRow(
                            row.assetType,
                            row.symbol,
                            row.active
                          );
                          const onDeploy = deployListLoaded
                            ? deployAlertIds.has(row.alertId)
                            : row.onDeployList === true;
                          return (
                            <tr
                              key={`${row.assetType}:${row.alertId}:${row.symbol}`}
                              className={`group transition-colors hover:bg-white/[0.03] ${
                                row.active ? '' : 'opacity-80'
                              } ${onDeploy ? 'bg-emerald-500/[0.04]' : ''}`}
                            >
                              <td className="sticky left-0 z-10 border-r border-white/[0.06] bg-kib-surface px-1 py-2 text-center align-top lg:static lg:z-auto lg:border-0 lg:bg-transparent lg:px-2 lg:py-2.5">
                                <input
                                  type="checkbox"
                                  className="rounded border-white/20 bg-kib-bg disabled:opacity-30"
                                  checked={onDeploy}
                                  disabled={
                                    !canDeploy ||
                                    watchlistLoading ||
                                    deployTogglingIds.has(row.alertId)
                                  }
                                  title={
                                    !row.active
                                      ? 'Paused watchlist rows cannot be on the deploy list'
                                      : canDeploy
                                        ? 'Include on capital deploy list'
                                        : 'US stocks only for deploy list'
                                  }
                                  onChange={(e) => void handleToggleDeploy(row, e.target.checked)}
                                />
                              </td>
                              <td className="sticky left-12 z-10 border-r border-white/[0.06] bg-kib-surface px-2 py-2 align-top shadow-[4px_0_12px_-4px_rgba(0,0,0,0.35)] transition-colors group-hover:bg-white/[0.03] lg:static lg:left-auto lg:z-auto lg:border-0 lg:bg-transparent lg:px-3 lg:py-2.5 lg:pl-4 lg:shadow-none">
                                <div className="flex flex-col gap-0.5">
                                  {row.assetType === 'stock' ? (
                                    isTwStockSymbol(row.symbol) ? (
                                      <span
                                        className="flex flex-col gap-0.5 w-fit"
                                        title={
                                          row.englishAlias
                                            ? `${row.englishAlias} · ${row.symbol} (TWSE)`
                                            : 'Taiwan (TWSE) — charts via iTick coming soon'
                                        }
                                      >
                                        <span className="font-semibold text-kib-fg tracking-tight">
                                          {row.englishAlias || row.symbol}
                                        </span>
                                        {row.englishAlias && (
                                          <span className="text-[10px] font-mono text-kib-muted">
                                            {row.symbol}
                                          </span>
                                        )}
                                      </span>
                                    ) : (
                                      <Link
                                        to={`/charts?symbol=${encodeURIComponent(row.symbol)}`}
                                        className="font-semibold font-mono text-kib-fg hover:text-kib-cyber w-fit"
                                        title={`Open chart for ${row.symbol}`}
                                      >
                                        {row.symbol}
                                      </Link>
                                    )
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
                                  {row.assetType === 'stock' && !isTwStockSymbol(row.symbol) && (
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1">
                                      <button
                                        type="button"
                                        className="text-[10px] font-medium uppercase tracking-wide text-kib-cyber/95 hover:text-kib-cyber hover:underline"
                                        title="Consensus-style fundamentals snapshot"
                                        onClick={() => setWlFundamentalsSymbol(row.symbol.toUpperCase())}
                                      >
                                        Financials
                                      </button>
                                      <span className="text-[10px] text-kib-muted">·</span>
                                      <a
                                        href={secIssuerBrowseUrl(row.symbol)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[10px] font-medium uppercase tracking-wide text-kib-muted hover:text-kib-cyber"
                                        title="SEC.gov issuer filings (new tab)"
                                      >
                                        SEC ↗
                                      </a>
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums align-top lg:px-3 lg:py-2.5">
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
                                className={`px-2 py-2 text-right tabular-nums align-top lg:px-3 lg:py-2.5 ${changeColorClass(
                                  row.dayChangePct ?? undefined
                                )}`}
                              >
                                {formatDayChangePct(row)}
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-300 align-top lg:px-3 lg:py-2.5">
                                {formatVolume(row.volume ?? undefined)}
                              </td>
                              <td
                                className="px-2 py-2 text-right tabular-nums text-slate-300 align-top lg:px-3 lg:py-2.5"
                                title={
                                  row.quoteSourceUsed
                                    ? `Open · quote source: ${row.quoteSourceUsed}`
                                    : 'Regular-session open when vendor provides it'
                                }
                              >
                                {row.dayOpen != null && Number.isFinite(row.dayOpen)
                                  ? formatQuote(row.dayOpen, row.assetType)
                                  : '—'}
                              </td>
                              <td
                                className="px-2 py-2 text-right tabular-nums text-slate-300 align-top lg:px-3 lg:py-2.5"
                                title="Session VWAP (e.g. Polygon day.vw)"
                              >
                                {row.sessionVwap != null && Number.isFinite(row.sessionVwap)
                                  ? formatQuote(row.sessionVwap, row.assetType)
                                  : '—'}
                              </td>
                              <td
                                className="px-2 py-2 text-right text-slate-300 align-top lg:px-3 lg:py-2.5"
                                title={
                                  row.quoteSourceUsed
                                    ? `Bid/ask · ${row.quoteSourceUsed}`
                                    : 'Best bid and ask when vendor exposes them'
                                }
                              >
                                {formatBidAskCell(row)}
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-400 text-xs align-top lg:px-3 lg:py-2.5">
                                {row.dayHigh != null &&
                                Number.isFinite(Number(row.dayHigh)) &&
                                row.dayLow != null &&
                                Number.isFinite(Number(row.dayLow)) ? (
                                  <>
                                    {formatQuote(row.dayHigh, row.assetType)} /{' '}
                                    {formatQuote(row.dayLow, row.assetType)}
                                  </>
                                ) : row.dayHigh != null && Number.isFinite(Number(row.dayHigh)) ? (
                                  <>{formatQuote(row.dayHigh, row.assetType)} / —</>
                                ) : row.dayLow != null && Number.isFinite(Number(row.dayLow)) ? (
                                  <>— / {formatQuote(row.dayLow, row.assetType)}</>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="px-2 py-2 align-top lg:px-3 lg:py-2.5">
                                <Watchlist52WeekRange
                                  assetType={row.assetType}
                                  currentPrice={row.currentPrice}
                                  week52High={row.week52High}
                                  week52Low={row.week52Low}
                                />
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-slate-300 align-top lg:px-3 lg:py-2.5">
                                {formatQuote(row.baselinePrice, row.assetType)}
                              </td>
                              <td
                                className={`px-2 py-2 text-right tabular-nums align-top lg:px-3 lg:py-2.5 ${vsBaselineColor(row)}`}
                              >
                                {vsBaselineDisplay(row)}
                              </td>
                              <td className="max-w-[120px] px-2 py-2 text-xs text-slate-300 align-top sm:max-w-[140px] lg:px-3 lg:py-2.5">
                                {row.nextThresholdGap ? (
                                  <span>
                                    {row.nextThresholdGap.next}: ~{row.nextThresholdGap.pctRemaining.toFixed(2)}% to go
                                  </span>
                                ) : (
                                  <span className="text-slate-500">—</span>
                                )}
                              </td>
                              <td
                                className="max-w-[140px] px-2 py-2 text-xs text-slate-300 align-top lg:max-w-[180px] lg:px-3 lg:py-2.5"
                                title={row.sizing.rationale}
                              >
                                <span className="font-medium text-kib-cyber/90">{row.sizing.tierLabel}</span>
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums align-top lg:px-3 lg:py-2.5">
                                <div className="font-medium text-kib-fg">{pct}%</div>
                              </td>
                              <td className="w-12 px-1 py-2 pr-2 text-right align-top lg:w-auto lg:px-3 lg:py-2.5 lg:pr-4">
                                <button
                                  type="button"
                                  onClick={() =>
                              void handleRemoveTicker(
                                row.symbol,
                                String(row.assetType).toLowerCase() === 'crypto' ? 'crypto' : 'stock'
                              )
                            }
                                  className="text-[11px] font-medium text-red-600 hover:text-red-700 hover:underline sm:text-xs"
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
              </>
            )}
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
                <h3 className="text-sm font-semibold text-kib-fg">Opportunity alerts</h3>
                <p className="mt-1 text-[11px] leading-snug text-kib-muted">
                  Stage 1 flags dips vs your baselines (same host rules for every symbol). Stage 2{' '}
                  <strong className="text-kib-fg/90">UltimateDipBuyer AI</strong> (Grok) adds verdict, confidence, and
                  timing notes on the <strong className="text-kib-fg/90">same Signals row</strong>. Profile dip briefing +
                  opportunity email toggles + server flags control the rich email; gated runs still show under{' '}
                  <Link to="/opportunity-signals" className="text-kib-cyber underline-offset-2 hover:underline">
                    Signals
                  </Link>
                  . Details in the policy panel.
                </p>
              </div>
              <OpportunityPolicyPanel embedInPanel />
            </div>
              }
            />

            <DeployListPanel
              items={deployItems}
              totalTargetWeightPct={deployTotalPct}
              loading={deployLoading}
              optimizing={deployOptimizing}
              onOptimize={() => void handleOptimizeDeployList()}
              onClear={() => void handleClearDeployList()}
              onRemove={(alertId) => {
                void (async () => {
                  try {
                    await removeDeployListItem(alertId);
                    await loadDeployList();
                    await loadWatchlist();
                  } catch {
                    toast.error('Could not remove');
                  }
                })();
              }}
            />

            <QuantAgiSuggestionsPanel onSymbolAdded={() => void loadWatchlist()} />

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

          <div className="border-b border-white/[0.06] bg-kib-surface px-3 py-2 sm:px-4">
            <div
              className="inline-flex w-full max-w-md gap-1 rounded-lg border border-white/[0.08] bg-black/25 p-1"
              role="tablist"
              aria-label="Assistant mode"
            >
              {(
                [
                  { id: 'grok_chat' as const, label: 'Grok' },
                  { id: 'scan_rank' as const, label: 'Watchlist analyst' }
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={assistantMode === tab.id}
                  onClick={() => setAssistantMode(tab.id)}
                  className={wlTabBtn(assistantMode === tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-kib-muted">
              {assistantMode === 'grok_chat'
                ? 'Direct Grok — fast answers on any topic.'
                : 'Scans your active watchlist with scores, quotes, and dip-band sizing.'}
            </p>
          </div>

          {currentRunMetadata?.fallbackUsed ? (
            <div className="border-b border-amber-500/25 bg-amber-950/20 px-4 py-2.5 text-xs text-amber-100/95">
              <span className="font-medium">Backup mode:</span> Grok / LangGraph did not complete — local template used.
              Check <code className="rounded bg-black/30 px-1 font-mono text-[11px]">stock-service</code> health and{' '}
              <code className="rounded bg-black/30 px-1 font-mono text-[11px]">GROK_API_KEY</code>.
              {assistantMode === 'scan_rank' ? (
                <>
                  {' '}
                  Watchlist scans may need a longer{' '}
                  <code className="rounded bg-black/30 px-1 font-mono text-[11px]">AGENT_PYTHON_TIMEOUT_MS</code>.
                </>
              ) : null}
            </div>
          ) : null}

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
              {assistantMode === 'grok_chat' ? (
                <>
                  <button
                    type="button"
                    onClick={() => setInput('What is RSI and when do dip buyers care about it?')}
                    className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-kib-fg hover:bg-white/[0.07]"
                  >
                    What is RSI?
                  </button>
                  <button
                    type="button"
                    onClick={() => setInput('Explain market cap vs float in plain English')}
                    className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-kib-fg hover:bg-white/[0.07]"
                  >
                    Market cap vs float
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setInput(
                        'Rank my active watchlist: use live quotes, scoring weights, and summarize the strongest dip-band opportunities vs baselines.'
                      )
                    }
                    className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-kib-fg hover:bg-white/[0.07]"
                  >
                    Rank watchlist
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setInput('Which watchlist names are closest to the overreaction tier today?')
                    }
                    className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-kib-fg hover:bg-white/[0.07]"
                  >
                    Near overreaction
                  </button>
                </>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSend();
                }}
                placeholder={
                  assistantMode === 'grok_chat'
                    ? 'Ask Grok anything…'
                    : 'e.g. Rank my watchlist and highlight the best dip-band setups vs baselines'
                }
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

      </div>

      <StockFundamentalsModal
        open={wlFundamentalsSymbol !== null}
        symbol={wlFundamentalsSymbol}
        onClose={() => setWlFundamentalsSymbol(null)}
      />
    </div>
  );
};

export default AIAgentPage;
