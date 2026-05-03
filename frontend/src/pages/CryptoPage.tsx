import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import CryptoChart from '../components/charts/CryptoChart';
import CryptoSearch from '../components/charts/CryptoSearch';
import type { CryptoIndicatorSummary } from '../components/charts/cryptoChartTechnical';
import {
  getCryptoOHLC,
  getCryptoTicker,
  CryptoCandle,
  CryptoTicker,
  KRAKEN_INTERVALS,
  formatCryptoPrice,
  formatCryptoVolume,
  formatPairName,
  getIntervalLabel,
  TimeRange,
  getTimeRangeLabel,
} from '../services/cryptoService';
import { toast } from 'react-hot-toast';

function parseCryptoPairFromParams(sp: URLSearchParams): string {
  const pairRaw = sp.get('pair')?.trim().toUpperCase() || '';
  if (pairRaw.startsWith('X:') && /USD$/i.test(pairRaw)) {
    return pairRaw;
  }
  const sym = sp.get('symbol')?.trim().toUpperCase() || '';
  if (sym && !sym.includes(':') && /^[A-Z0-9]{2,15}$/.test(sym)) {
    return `X:${sym}USD`;
  }
  return 'X:BTCUSD';
}

function initialCryptoPair(): string {
  if (typeof window === 'undefined') return 'X:BTCUSD';
  return parseCryptoPairFromParams(new URLSearchParams(window.location.search));
}

/** Preset row aligned with stock chart period labels (interval + range chosen per crypto data limits). */
const CRYPTO_CHART_PRESETS: {
  id: string;
  label: string;
  interval: keyof typeof KRAKEN_INTERVALS;
  range: TimeRange;
}[] = [
  { id: '1d', label: '1D', interval: '5m', range: '1D' },
  { id: '5d', label: '5D', interval: '15m', range: '1W' },
  { id: '1mo', label: '1M', interval: '1h', range: '1M' },
  { id: '3mo', label: '3M', interval: '1d', range: '3M' },
  { id: '6mo', label: '6M', interval: '1d', range: '6M' },
  { id: 'ytd', label: 'YTD', interval: '1d', range: '6M' },
  { id: '1y', label: '1Y', interval: '1d', range: '1Y' },
  { id: '5y', label: '5Y', interval: '1w', range: 'ALL' },
  { id: 'all', label: 'All', interval: '1M', range: 'ALL' },
];

export const CryptoPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedPair, setSelectedPair] = useState<string>(initialCryptoPair);
  const [chartData, setChartData] = useState<CryptoCandle[]>([]);
  const [tickerData, setTickerData] = useState<CryptoTicker | null>(null);
  const [interval, setInterval] = useState<keyof typeof KRAKEN_INTERVALS>('1h');
  const [timeRange, setTimeRange] = useState<TimeRange>('1M');
  const [activePresetId, setActivePresetId] = useState<string>('1mo');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showVolume, setShowVolume] = useState<boolean>(true);
  const [showIndicators, setShowIndicators] = useState<boolean>(true);
  const [crosshairData, setCrosshairData] = useState<Record<string, unknown> | null>(null);
  const [indicatorSummary, setIndicatorSummary] = useState<CryptoIndicatorSummary | null>(null);
  const [historyLastUpdated, setHistoryLastUpdated] = useState<string>('');
  const [quoteLastUpdated, setQuoteLastUpdated] = useState<string>('');
  const [quoteSource, setQuoteSource] = useState<string>('polygon_ticker');
  const [staleSeconds, setStaleSeconds] = useState<number>(0);
  const [dataErrorMessage, setDataErrorMessage] = useState<string>('');
  const [dataInfoMessage, setDataInfoMessage] = useState<string>('');

  const dataCacheRef = useRef<Map<string, CryptoCandle[]>>(new Map());
  const lastFetchAtRef = useRef<Map<string, number>>(new Map());

  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'open' | 'closing' | 'closed'>('closed');
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [wsError, setWsError] = useState<string | null>(null);

  const formatCompact = useCallback((value: number | null | undefined) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
  }, []);

  const getSourceStatus = (source: string): { label: string; className: string } => {
    if (source === 'polygon_ticker' && isConnected) {
      return { label: 'Live', className: 'bg-green-900/40 text-green-300 border-green-700' };
    }
    if (source === 'polygon_ticker') {
      return { label: 'Near-live', className: 'bg-yellow-900/40 text-yellow-300 border-yellow-700' };
    }
    return { label: 'Delayed', className: 'bg-blue-900/40 text-blue-300 border-blue-700' };
  };

  const quoteStatus = getSourceStatus(quoteSource);
  const pollingIntervalMs = 10000;
  const updateCadenceLabel = 'updates every 10s';
  const connectionLabel = isConnected
    ? 'Connected'
    : connectionStatus === 'connecting'
      ? 'Syncing'
      : 'Disconnected';

  const getStaleThresholdSeconds = () => (isConnected ? 18 : 120);
  const isDataStale = staleSeconds > getStaleThresholdSeconds();
  const staleLabel = useMemo(() => `updated ${staleSeconds}s ago`, [staleSeconds]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (!quoteLastUpdated) return;
      const age = Math.max(0, Math.floor((Date.now() - new Date(quoteLastUpdated).getTime()) / 1000));
      setStaleSeconds(age);
    }, 5000);
    return () => clearInterval(intervalId);
  }, [quoteLastUpdated]);

  const loadCryptoData = useCallback(
    async (
      pair: string,
      newInterval?: keyof typeof KRAKEN_INTERVALS,
      newTimeRange?: TimeRange,
      forceRefresh: boolean = false
    ) => {
      const actualInterval = newInterval || interval;
      const actualTimeRange = newTimeRange || timeRange;
      const cacheKey = `${pair}-${actualInterval}-${actualTimeRange}`;

      if (!forceRefresh && dataCacheRef.current.has(cacheKey)) {
        const cachedData = dataCacheRef.current.get(cacheKey)!;
        const lastAt = lastFetchAtRef.current.get(cacheKey) ?? 0;
        const cacheAge = Date.now() - lastAt;
        const maxCacheAge = actualInterval === '1m' ? 30000 : 300000;

        if (cacheAge < maxCacheAge) {
          setChartData(cachedData);
          if (newInterval) setInterval(newInterval);
          if (newTimeRange) setTimeRange(newTimeRange);
          return;
        }
      }

      setIsLoading(true);
      setDataErrorMessage('');
      setDataInfoMessage('');
      try {
        const [ohlcData, ticker] = await Promise.all([
          getCryptoOHLC(pair, actualInterval, undefined, actualTimeRange),
          (async (): Promise<CryptoTicker | null> => {
            await new Promise<void>((r) => setTimeout(r, 500));
            try {
              return await getCryptoTicker(pair);
            } catch {
              return null;
            }
          })(),
        ]);

        const newCache = new Map(dataCacheRef.current);
        newCache.set(cacheKey, ohlcData.data);
        if (newCache.size > 15) {
          const firstKey = newCache.keys().next().value;
          if (firstKey !== undefined) newCache.delete(firstKey);
        }
        dataCacheRef.current = newCache;
        lastFetchAtRef.current.set(cacheKey, Date.now());

        setChartData(ohlcData.data);
        if (ticker) {
          setTickerData(ticker);
          setQuoteLastUpdated(ticker.timestamp || new Date().toISOString());
          setQuoteSource('polygon_ticker');
        }

        if (newInterval) setInterval(newInterval);
        if (newTimeRange) setTimeRange(newTimeRange);

        setHistoryLastUpdated(ohlcData.timestamp || new Date().toISOString());
      } catch (error) {
        console.error('Error loading crypto data:', error);
        setDataErrorMessage('Could not load OHLC. Check connection and retry.');
        toast.error(`Failed to load data for ${formatPairName(pair)}`);

        const fallback = dataCacheRef.current.get(cacheKey);
        if (fallback) {
          setChartData(fallback);
          toast('Showing cached data while offline');
        } else {
          setChartData([]);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [interval, timeRange]
  );

  useEffect(() => {
    const next = parseCryptoPairFromParams(searchParams);
    setSelectedPair((prev) => (next !== prev ? next : prev));
  }, [searchParams]);

  useEffect(() => {
    void loadCryptoData(selectedPair);
  }, [selectedPair, interval, timeRange, loadCryptoData]);

  useEffect(() => {
    let active = true;
    setConnectionStatus('connecting');

    const refreshTicker = async () => {
      try {
        const ticker = await getCryptoTicker(selectedPair);
        if (!active || !ticker || typeof ticker !== 'object') return;
        setTickerData((prev) => (prev ? { ...prev, ...ticker } : ticker));
        setQuoteLastUpdated(
          typeof ticker.timestamp === 'string' && ticker.timestamp ? ticker.timestamp : new Date().toISOString()
        );
        setQuoteSource('polygon_ticker');
        setConnectionStatus('open');
        setIsConnected(true);
        setWsError(null);
      } catch {
        if (!active) return;
        setConnectionStatus('closed');
        setIsConnected(false);
        setWsError('Failed to fetch live ticker updates');
      }
    };

    void refreshTicker();
    const id = window.setInterval(() => {
      void refreshTicker();
    }, pollingIntervalMs);

    return () => {
      active = false;
      clearInterval(id);
    };
  }, [selectedPair, pollingIntervalMs]);

  const handleIndicatorSummary = useCallback((summary: CryptoIndicatorSummary | null) => {
    setIndicatorSummary(summary);
  }, []);

  const handlePairSelect = (pair: string) => {
    setSelectedPair(pair);
    setCrosshairData(null);
    setSearchParams({ pair }, { replace: true });
  };

  const handlePresetChange = (preset: (typeof CRYPTO_CHART_PRESETS)[number]) => {
    if (isLoading) return;
    setChartData([]);
    setActivePresetId(preset.id);
    setInterval(preset.interval);
    setTimeRange(preset.range);
  };

  const handleRefresh = () => {
    void loadCryptoData(selectedPair, undefined, undefined, true);
  };

  const handleCrosshairMove = (data: Record<string, unknown> | undefined | null) => {
    setCrosshairData(data ?? null);
  };

  const currentTicker = tickerData;
  const quoteChange = Number(currentTicker?.change);
  const quoteChangePct = Number(currentTicker?.changePercent);
  const quoteChangePositive = Number.isFinite(quoteChange) ? quoteChange >= 0 : true;
  const pctLabel = Number.isFinite(quoteChangePct) ? quoteChangePct.toFixed(2) : '—';
  const tradesLabel =
    typeof currentTicker?.trades === 'number' && Number.isFinite(currentTicker.trades)
      ? Math.round(currentTicker.trades).toLocaleString()
      : '—';
  const displayName = formatPairName(selectedPair);

  const crosshairTimeMs = useMemo(() => {
    if (!crosshairData?.time || typeof crosshairData.time !== 'number') return null;
    const t = crosshairData.time as number;
    return t < 1e12 ? t * 1000 : t;
  }, [crosshairData]);

  return (
    <div className="min-h-screen app-shell text-kib-fg">
      <div className="border-b border-white/[0.08] bg-kib-surface/50 backdrop-blur-sm">
        <div className="mx-auto max-w-[1360px] px-4 py-4 sm:px-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
            <div className="space-y-1">
              <h1 className="text-2xl font-bold tracking-tight">Crypto Dashboard</h1>
              <p className="text-sm text-gray-400">Professional charting — Polygon crypto aggregates &amp; ticker</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-2 items-center">
              <div className="flex items-center justify-center space-x-2 rounded-lg bg-gray-800/70 px-3 py-1.5 border border-gray-700 h-9">
                <div
                  className={`w-2 h-2 rounded-full ${
                    isConnected ? 'bg-green-500' : connectionStatus === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'
                  }`}
                />
                <span className="text-xs text-gray-400">{connectionLabel}</span>
              </div>

              <label className="flex items-center justify-center space-x-2 rounded-lg bg-gray-800/70 px-3 py-1.5 border border-gray-700 h-9">
                <input
                  type="checkbox"
                  checked={showVolume}
                  onChange={(e) => setShowVolume(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm">Volume</span>
              </label>

              <label className="flex items-center justify-center space-x-2 rounded-lg bg-gray-800/70 px-3 py-1.5 border border-gray-700 h-9">
                <input
                  type="checkbox"
                  checked={showIndicators}
                  onChange={(e) => setShowIndicators(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm">Indicators</span>
              </label>

              <div className="px-2 py-1 rounded text-xs bg-gray-800 border border-gray-700 text-gray-300 text-center h-9 flex items-center justify-center">
                Data: {quoteSource}
              </div>
              <div
                className={`px-2 py-1 rounded text-xs border text-center h-9 flex items-center justify-center ${quoteStatus.className}`}
              >
                {quoteStatus.label}
              </div>
              <div className="px-2 py-1 rounded text-xs bg-gray-800 border border-gray-700 text-gray-300 text-center h-9 flex items-center justify-center">
                {updateCadenceLabel}
              </div>
              <div
                className={`text-center px-2 py-1 rounded text-xs border tabular-nums h-9 flex items-center justify-center ${
                  isDataStale ? 'bg-red-900/40 text-red-300 border-red-700' : 'bg-gray-800 text-gray-300 border-gray-700'
                }`}
              >
                {staleLabel}
              </div>
              <button
                type="button"
                onClick={() => handleRefresh()}
                disabled={isLoading}
                className="px-3 py-1.5 h-9 rounded-lg text-xs font-semibold border border-blue-700 bg-blue-600/80 hover:bg-blue-500 disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
          </div>

          {wsError && (
            <div className="mb-3 text-xs text-red-300 px-2 py-1 bg-red-950/40 border border-red-500/35 rounded font-mono inline-block" title={wsError}>
              {wsError}
            </div>
          )}

          <div className="max-w-md">
            <CryptoSearch onSelectPair={handlePairSelect} currentPair={selectedPair} />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1360px] px-4 py-6 sm:px-6">
        <div className="grid grid-cols-1 lg:[grid-template-columns:minmax(0,3fr)_minmax(320px,1fr)] gap-6">
          <div>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex flex-wrap gap-1">
                  {CRYPTO_CHART_PRESETS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => handlePresetChange(option)}
                      disabled={isLoading}
                      className={`px-3 py-1 text-sm rounded transition-colors ${
                        activePresetId === option.id &&
                        interval === option.interval &&
                        timeRange === option.range
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      } disabled:opacity-50`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                {isLoading && (
                  <div className="flex items-center space-x-2 text-gray-400">
                    <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
                    <span className="text-sm">Loading...</span>
                  </div>
                )}
              </div>

              <div className="bg-gray-800/80 rounded-xl overflow-hidden border border-gray-700/70 shadow-xl">
                <div className="px-4 py-2 border-b border-gray-700 text-xs text-gray-300 bg-gray-900/90 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Feed status</span>
                    <span className={`px-2 py-0.5 rounded border ${quoteStatus.className}`}>{quoteStatus.label}</span>
                    <span className="text-gray-400">ticker: {quoteSource}</span>
                    <span className="text-gray-400">
                      bars: {getIntervalLabel(interval)} / {getTimeRangeLabel(timeRange)}
                    </span>
                    <span className="text-gray-500">{updateCadenceLabel}</span>
                    <span className={isDataStale ? 'text-red-300' : 'text-gray-500'}>ticker {staleLabel}</span>
                  </div>
                  <div className="text-gray-500">
                    Polygon crypto
                    {historyLastUpdated ? ` • history ${new Date(historyLastUpdated).toLocaleTimeString()}` : ''}
                  </div>
                </div>
                {dataInfoMessage && (
                  <div className="px-4 py-2 text-xs text-amber-200/90 bg-amber-950/40 border-b border-amber-800/50">
                    {dataInfoMessage}
                  </div>
                )}
                {chartData.length > 0 ? (
                  <CryptoChart
                    data={chartData}
                    symbol={displayName}
                    height={600}
                    showVolume={showVolume}
                    showIndicators={showIndicators}
                    interval={interval}
                    isLive={isConnected}
                    onCrosshairMove={handleCrosshairMove}
                    onIndicatorSummary={handleIndicatorSummary}
                  />
                ) : (
                  <div className="h-96 flex items-center justify-center text-gray-400 px-4 text-center">
                    {isLoading
                      ? 'Loading chart data...'
                      : dataErrorMessage || 'No chart data available for this pair and timeframe'}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-6 min-w-[320px]">
            {currentTicker && (
              <div className="bg-gray-800/80 rounded-xl p-6 border border-gray-700/70">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold">{formatPairName(currentTicker.symbol)}</h3>
                    <p className="text-gray-400 text-sm">
                      {getIntervalLabel(interval)} · {getTimeRangeLabel(timeRange)} · Polygon
                    </p>
                    <p className={`text-sm mt-1 font-medium ${quoteChangePositive ? 'text-green-400' : 'text-red-400'}`}>
                      {quoteChangePositive ? '+' : ''}
                      {formatCryptoPrice(currentTicker.change)} ({pctLabel}%)
                    </p>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Price</span>
                      <span className="font-semibold">{formatCryptoPrice(currentTicker.price)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Change</span>
                      <span
                        className={`font-semibold ${
                          Number.isFinite(quoteChange) && quoteChange >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}
                      >
                        {Number.isFinite(quoteChange) && quoteChange >= 0 ? '+' : ''}
                        {formatCryptoPrice(currentTicker.change)} ({pctLabel}%)
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">24h High</span>
                      <span>{formatCryptoPrice(currentTicker.high)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">24h Low</span>
                      <span>{formatCryptoPrice(currentTicker.low)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">24h Volume</span>
                      <span>{formatCompact(currentTicker.volume)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">VWAP</span>
                      <span>{formatCryptoPrice(currentTicker.vwap)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Bid / Ask</span>
                      <span>
                        {formatCryptoPrice(currentTicker.bid)} / {formatCryptoPrice(currentTicker.ask)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Spread</span>
                      <span>{formatCryptoPrice(currentTicker.spread)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">24h Trades</span>
                      <span>{tradesLabel}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {crosshairData && crosshairTimeMs !== null && (
              <div className="bg-gray-800/80 rounded-xl p-6 border border-gray-700/70">
                <h4 className="text-lg font-semibold mb-4">Crosshair</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Time</span>
                    <span>{new Date(crosshairTimeMs).toLocaleString()}</span>
                  </div>
                  {Boolean(crosshairData.candle) && typeof crosshairData.candle === 'object' && crosshairData.candle !== null && (
                    <>
                      {(['open', 'high', 'low', 'close'] as const).map((k) => {
                        const candle = crosshairData.candle as Record<string, number>;
                        const v = candle[k];
                        return (
                          <div key={k} className="flex justify-between capitalize">
                            <span className="text-gray-400">{k}</span>
                            <span className={k === 'high' ? 'text-green-400' : k === 'low' ? 'text-red-400' : ''}>
                              {formatCryptoPrice(v)}
                            </span>
                          </div>
                        );
                      })}
                    </>
                  )}
                  {typeof crosshairData.volume === 'number' && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Volume</span>
                      <span>{formatCryptoVolume(crosshairData.volume)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="bg-gray-800/80 rounded-xl p-6 border border-gray-700/70">
              <h4 className="text-lg font-semibold mb-4">Pair info</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Pair</span>
                  <span>{selectedPair}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Display</span>
                  <span>{displayName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Candles</span>
                  <span>{chartData.length.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Cadence</span>
                  <span>{updateCadenceLabel}</span>
                </div>
              </div>
            </div>

            {showIndicators && indicatorSummary && (
              <div className="bg-gray-800/80 rounded-xl p-6 border border-gray-700/70">
                <h4 className="text-lg font-semibold mb-4">Indicators</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">SMA 20</span>
                    <span>{indicatorSummary.sma20 != null ? indicatorSummary.sma20.toFixed(4) : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">SMA 50</span>
                    <span>{indicatorSummary.sma50 != null ? indicatorSummary.sma50.toFixed(4) : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">EMA 20</span>
                    <span>{indicatorSummary.ema20 != null ? indicatorSummary.ema20.toFixed(4) : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">EMA 50</span>
                    <span>{indicatorSummary.ema50 != null ? indicatorSummary.ema50.toFixed(4) : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">RSI 14</span>
                    <span>{indicatorSummary.rsi != null ? indicatorSummary.rsi.toFixed(2) : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">MACD</span>
                    <span>{indicatorSummary.macd != null ? indicatorSummary.macd.toFixed(6) : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Signal</span>
                    <span>{indicatorSummary.signal != null ? indicatorSummary.signal.toFixed(6) : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Histogram</span>
                    <span
                      className={
                        indicatorSummary.histogram != null && indicatorSummary.histogram >= 0
                          ? 'text-green-400'
                          : 'text-red-400'
                      }
                    >
                      {indicatorSummary.histogram != null ? indicatorSummary.histogram.toFixed(6) : 'N/A'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CryptoPage;
