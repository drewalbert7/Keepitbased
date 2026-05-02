import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SimpleChart } from '../components/charts/SimpleChart';
import { StockSearch } from '../components/charts/StockSearch';
import { getStockHistory, getStockQuote, getStockInfo, getTechnicalData, ChartData, QuoteData, StockInfo, TechnicalData } from '../services/chartService';
import { useRealTimeQuotes } from '../hooks/useRealTimeQuotes';
import { toast } from 'react-hot-toast';

export const ChartPage: React.FC = () => {
  const [selectedSymbol, setSelectedSymbol] = useState<string>('AAPL');
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [quoteData, setQuoteData] = useState<QuoteData | null>(null);
  const [stockInfo, setStockInfo] = useState<StockInfo | null>(null);
  const [period, setPeriod] = useState<string>('1y');
  const [interval, setInterval] = useState<string>('1d');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showVolume, setShowVolume] = useState<boolean>(true);
  const [showIndicators, setShowIndicators] = useState<boolean>(true);
  const [historySource, setHistorySource] = useState<string>('massive_aggs');
  const [quoteSource, setQuoteSource] = useState<string>('snapshot');
  const [quoteLastUpdated, setQuoteLastUpdated] = useState<string>('');
  const [historyLastUpdated, setHistoryLastUpdated] = useState<string>('');
  const [technicalData, setTechnicalData] = useState<TechnicalData['data']>([]);
  const [staleSeconds, setStaleSeconds] = useState<number>(0);
  const [dataErrorMessage, setDataErrorMessage] = useState<string>('');
  const [dataInfoMessage, setDataInfoMessage] = useState<string>('');

  const formatCompact = useCallback(
    (value: number) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value),
    []
  );

  const getSourceStatus = (source: string): { label: string; className: string } => {
    if (source === 'snapshot') {
      return { label: 'Live', className: 'bg-green-900/40 text-green-300 border-green-700' };
    }
    if (source === 'agg_minute') {
      return { label: 'Near-live', className: 'bg-yellow-900/40 text-yellow-300 border-yellow-700' };
    }
    return { label: 'Delayed', className: 'bg-blue-900/40 text-blue-300 border-blue-700' };
  };

  const quoteStatus = getSourceStatus(quoteSource);
  const trackedSymbols = useMemo(() => [selectedSymbol], [selectedSymbol]);

  const getStaleThresholdSeconds = (source: string) => {
    if (source === 'snapshot') return 10;
    if (source === 'agg_minute') return 30;
    return 120;
  };

  const isDataStale = staleSeconds > getStaleThresholdSeconds(quoteSource);

  const handleQuoteUpdate = useCallback((quote: QuoteData) => {
    setQuoteData((prevQuote) => (prevQuote ? { ...prevQuote, ...quote } : quote));
    setQuoteSource(quote.sourceUsed || 'snapshot');
    setQuoteLastUpdated(quote.lastUpdated || quote.timestamp || new Date().toISOString());
  }, []);

  // Real-time quotes
  const { connectionStatus, isConnected, pollingIntervalMs } = useRealTimeQuotes({
    symbols: trackedSymbols,
    onQuoteUpdate: handleQuoteUpdate
  });

  const updateCadenceLabel = pollingIntervalMs >= 60000
    ? 'updates every 60s'
    : pollingIntervalMs <= 3000
      ? 'updates every 3s'
      : 'updates every 10s';
  const connectionLabel = isConnected
    ? 'Connected'
    : connectionStatus === 'connecting'
      ? 'Syncing'
      : 'Disconnected';

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (!quoteLastUpdated) return;
      const age = Math.max(0, Math.floor((Date.now() - new Date(quoteLastUpdated).getTime()) / 1000));
      setStaleSeconds(age);
    }, 5000);

    return () => {
      clearInterval(intervalId);
    };
  }, [quoteLastUpdated]);

  const periodOptions = [
    { value: '1d', label: '1D', interval: '5m' },
    { value: '5d', label: '5D', interval: '15m' },
    { value: '1mo', label: '1M', interval: '1h' },
    { value: '3mo', label: '3M', interval: '1d' },
    { value: '6mo', label: '6M', interval: '1d' },
    { value: 'ytd', label: 'YTD', interval: '1d' },
    { value: '1y', label: '1Y', interval: '1d' },
    { value: '5y', label: '5Y', interval: '1wk' },
    { value: 'all', label: 'All', interval: '1mo' },
  ];

  const loadStockData = async (symbol: string, newPeriod?: string, newInterval?: string) => {
    setIsLoading(true);
    setDataErrorMessage('');
    setDataInfoMessage('');
    try {
      const actualPeriod = newPeriod || period;
      const actualInterval = newInterval || interval;

      // History drives the chart — do not fail the whole page if quote/info/technical fail.
      let historyData;
      try {
        historyData = await getStockHistory(symbol, actualPeriod, actualInterval);
      } catch (histErr: unknown) {
        const status = (histErr as { response?: { status?: number } })?.response?.status;
        if (status === 403) {
          setDataErrorMessage('Massive entitlement does not include this symbol/timeframe yet.');
        } else if (status === 404) {
          setDataErrorMessage(`Symbol ${symbol} was not found.`);
        } else if (status === 429) {
          setDataErrorMessage('Rate limit reached. Please retry in a moment.');
        } else {
          setDataErrorMessage('Could not load price history. Check connection and retry.');
        }
        toast.error(`Failed to load chart data for ${symbol}`);
        setChartData([]);
        return;
      }

      const upper = symbol.toUpperCase();
      const [quoteResult, infoResult, technicalResult] = await Promise.allSettled([
        getStockQuote(upper),
        getStockInfo(upper),
        getTechnicalData(upper, actualPeriod)
      ]);

      const quote =
        quoteResult.status === 'fulfilled'
          ? quoteResult.value
          : null;
      const info = infoResult.status === 'fulfilled' ? infoResult.value : null;
      const technical =
        technicalResult.status === 'fulfilled' ? technicalResult.value : null;

      if (quoteResult.status === 'rejected') {
        console.warn('Quote failed (chart still loads from history):', quoteResult.reason);
      }

      setChartData(historyData.data);
      setStockInfo(info);

      const rows = historyData.data || [];
      const lastBar = rows.length > 0 ? rows[rows.length - 1] : null;

      if (quote) {
        setQuoteData(quote);
        setQuoteSource(quote.sourceUsed || 'snapshot');
        setQuoteLastUpdated(quote.lastUpdated || quote.timestamp || new Date().toISOString());
      } else if (lastBar) {
        setQuoteData({
          symbol: upper,
          price: lastBar.close,
          open: lastBar.open,
          high: lastBar.high,
          low: lastBar.low,
          volume: lastBar.volume ?? 0,
          change: lastBar.close - lastBar.open,
          changePercent: lastBar.open ? ((lastBar.close - lastBar.open) / lastBar.open) * 100 : 0,
          marketCap: 0,
          companyName: upper,
          timestamp: new Date(lastBar.time * 1000).toISOString(),
          sourceUsed: 'history_bar',
          partialData: true,
          lastUpdated: new Date().toISOString()
        });
        setQuoteSource('history_bar');
        setQuoteLastUpdated(new Date().toISOString());
        setDataErrorMessage('Live quote unavailable; showing last bar close.');
      } else {
        setQuoteData(null);
      }

      setTechnicalData(technical?.data || []);
      setHistorySource(historyData.sourceUsed || 'massive_aggs');
      setHistoryLastUpdated(historyData.lastUpdated || historyData.timestamp || new Date().toISOString());
      if (historyData.coverage?.note) {
        setDataInfoMessage(historyData.coverage.note);
      }

      if (newPeriod) setPeriod(newPeriod);
      if (newInterval) setInterval(newInterval);
    } catch (error: unknown) {
      console.error('Error loading stock data:', error);
      setDataErrorMessage('Temporary market-data error. Please retry.');
      toast.error(`Failed to load data for ${symbol}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStockData(selectedSymbol);
  }, [selectedSymbol]);

  const handleSymbolSelect = useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
  }, []);

  const handlePeriodChange = useCallback((newPeriod: string, newInterval: string) => {
    loadStockData(selectedSymbol, newPeriod, newInterval);
  }, [loadStockData, selectedSymbol]);

  const latestTechnical = technicalData.length > 0 ? technicalData[technicalData.length - 1] : null;
  const quoteChangePositive = (quoteData?.change ?? 0) >= 0;
  const staleLabel = useMemo(() => `updated ${staleSeconds}s ago`, [staleSeconds]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
            <div className="space-y-1">
              <h1 className="text-2xl font-bold tracking-tight">Stocks Dashboard</h1>
              <p className="text-sm text-gray-400">Professional charting powered by Massive market data</p>
            </div>
            
            {/* Controls */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-2 items-center">
              {/* Connection Status */}
              <div className="flex items-center justify-center space-x-2 rounded-lg bg-gray-800/70 px-3 py-1.5 border border-gray-700 h-9">
                <div className={`w-2 h-2 rounded-full ${
                  isConnected ? 'bg-green-500' : connectionStatus === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'
                }`} />
                <span className="text-xs text-gray-400">
                  {connectionLabel}
                </span>
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
              <div className={`px-2 py-1 rounded text-xs border text-center h-9 flex items-center justify-center ${quoteStatus.className}`}>
                {quoteStatus.label}
              </div>
              <div className="px-2 py-1 rounded text-xs bg-gray-800 border border-gray-700 text-gray-300 text-center h-9 flex items-center justify-center">
                {updateCadenceLabel}
              </div>
              <div className={`text-center px-2 py-1 rounded text-xs border tabular-nums h-9 flex items-center justify-center ${isDataStale ? 'bg-red-900/40 text-red-300 border-red-700' : 'bg-gray-800 text-gray-300 border-gray-700'}`}>
                {staleLabel}
              </div>
              <button
                onClick={() => loadStockData(selectedSymbol)}
                disabled={isLoading}
                className="px-3 py-1.5 h-9 rounded-lg text-xs font-semibold border border-blue-700 bg-blue-600/80 hover:bg-blue-500 disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="max-w-md">
            <StockSearch
              onSelectStock={handleSymbolSelect}
              currentSymbol={selectedSymbol}
            />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:[grid-template-columns:minmax(0,3fr)_minmax(320px,1fr)] gap-6">
          {/* Main Chart */}
          <div>
            <div className="space-y-4">
              {/* Period Selection */}
              <div className="flex items-center justify-between">
                <div className="flex space-x-1">
                  {periodOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => handlePeriodChange(option.value, option.interval)}
                      disabled={isLoading}
                      className={`px-3 py-1 text-sm rounded transition-colors ${
                        period === option.value
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
                    <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                    <span className="text-sm">Loading...</span>
                  </div>
                )}
              </div>

              {/* Chart */}
              <div className="bg-gray-800/80 rounded-xl overflow-hidden border border-gray-700/70 shadow-xl">
                <div className="px-4 py-2 border-b border-gray-700 text-xs text-gray-300 bg-gray-900/90 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Feed status</span>
                    <span className={`px-2 py-0.5 rounded border ${quoteStatus.className}`}>{quoteStatus.label}</span>
                    <span className="text-gray-400">quote: {quoteSource}</span>
                    <span className="text-gray-400">history: {historySource}</span>
                    <span className="text-gray-500">{updateCadenceLabel}</span>
                    <span className={`${isDataStale ? 'text-red-300' : 'text-gray-500'}`}>
                      quote updated {staleSeconds}s ago
                    </span>
                  </div>
                  <div className="text-gray-500">
                    Massive data pipeline
                    {historyLastUpdated ? ` • history ${new Date(historyLastUpdated).toLocaleTimeString()}` : ''}
                  </div>
                </div>
                {dataInfoMessage && (
                  <div className="px-4 py-2 text-xs text-amber-200/90 bg-amber-950/40 border-b border-amber-800/50">
                    {dataInfoMessage}
                  </div>
                )}
                {chartData.length > 0 ? (
                  <SimpleChart
                    data={chartData}
                    technicalData={technicalData}
                    symbol={selectedSymbol}
                    height={600}
                    showVolume={showVolume}
                    showIndicators={showIndicators}
                    onTimeScaleChange={handlePeriodChange}
                    currentTimeScale={period}
                    currentInterval={interval}
                    sourceUsed={historySource}
                  />
                ) : (
                  <div className="h-96 flex items-center justify-center text-gray-400">
                    {isLoading
                      ? 'Loading chart data...'
                      : dataErrorMessage || 'No chart data available for this symbol/timeframe'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6 min-w-[320px]">
            {/* Quote Information */}
            {quoteData && (
              <div className="bg-gray-800/80 rounded-xl p-6 border border-gray-700/70">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold">{quoteData.symbol}</h3>
                    <p className="text-gray-400 text-sm">{quoteData.companyName}</p>
                    <p className={`text-sm mt-1 font-medium ${quoteChangePositive ? 'text-green-400' : 'text-red-400'}`}>
                      {quoteChangePositive ? '+' : ''}${quoteData.change.toFixed(2)} ({quoteData.changePercent.toFixed(2)}%)
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Price</span>
                      <span className="font-semibold">${quoteData.price.toFixed(2)}</span>
                    </div>
                    
                    <div className="flex justify-between">
                      <span className="text-gray-400">Change</span>
                      <span className={`font-semibold ${quoteData.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {quoteData.change >= 0 ? '+' : ''}${quoteData.change.toFixed(2)} ({quoteData.changePercent.toFixed(2)}%)
                      </span>
                    </div>
                    
                    <div className="flex justify-between">
                      <span className="text-gray-400">Open</span>
                      <span>${quoteData.open.toFixed(2)}</span>
                    </div>
                    
                    <div className="flex justify-between">
                      <span className="text-gray-400">High</span>
                      <span>${quoteData.high.toFixed(2)}</span>
                    </div>
                    
                    <div className="flex justify-between">
                      <span className="text-gray-400">Low</span>
                      <span>${quoteData.low.toFixed(2)}</span>
                    </div>
                    
                    <div className="flex justify-between">
                      <span className="text-gray-400">Volume</span>
                      <span>{formatCompact(quoteData.volume)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Stock Information */}
            {stockInfo && (
              <div className="bg-gray-800/80 rounded-xl p-6 border border-gray-700/70">
                <h4 className="text-lg font-semibold mb-4">Company Info</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Sector</span>
                    <span>{stockInfo.sector || 'N/A'}</span>
                  </div>
                  
                  <div className="flex justify-between">
                    <span className="text-gray-400">Industry</span>
                    <span>{stockInfo.industry || 'N/A'}</span>
                  </div>
                  
                  <div className="flex justify-between">
                    <span className="text-gray-400">Market Cap</span>
                    <span>{stockInfo.marketCap ? `$${formatCompact(stockInfo.marketCap)}` : 'N/A'}</span>
                  </div>
                  
                  <div className="flex justify-between">
                    <span className="text-gray-400">P/E Ratio</span>
                    <span>{stockInfo.peRatio ? stockInfo.peRatio.toFixed(2) : 'N/A'}</span>
                  </div>
                  
                  <div className="flex justify-between">
                    <span className="text-gray-400">Beta</span>
                    <span>{stockInfo.beta ? stockInfo.beta.toFixed(2) : 'N/A'}</span>
                  </div>
                  
                  <div className="flex justify-between">
                    <span className="text-gray-400">52W High</span>
                    <span>{stockInfo.week52High ? `$${stockInfo.week52High.toFixed(2)}` : 'N/A'}</span>
                  </div>
                  
                  <div className="flex justify-between">
                    <span className="text-gray-400">52W Low</span>
                    <span>{stockInfo.week52Low ? `$${stockInfo.week52Low.toFixed(2)}` : 'N/A'}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Technical Indicators */}
            {showIndicators && latestTechnical && (
              <div className="bg-gray-800/80 rounded-xl p-6 border border-gray-700/70">
                <h4 className="text-lg font-semibold mb-4">Indicators</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">SMA 20</span>
                    <span>{latestTechnical.sma20 != null ? latestTechnical.sma20.toFixed(2) : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">SMA 50</span>
                    <span>{latestTechnical.sma50 != null ? latestTechnical.sma50.toFixed(2) : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">EMA 20</span>
                    <span>{latestTechnical.ema20 != null ? latestTechnical.ema20.toFixed(2) : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">EMA 50</span>
                    <span>{latestTechnical.ema50 != null ? latestTechnical.ema50.toFixed(2) : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">RSI 14</span>
                    <span>{latestTechnical.rsi != null ? latestTechnical.rsi.toFixed(2) : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">MACD</span>
                    <span>{latestTechnical.macd != null ? latestTechnical.macd.toFixed(4) : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Signal</span>
                    <span>{latestTechnical.signal != null ? latestTechnical.signal.toFixed(4) : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Histogram</span>
                    <span className={latestTechnical.histogram != null && latestTechnical.histogram >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {latestTechnical.histogram != null ? latestTechnical.histogram.toFixed(4) : 'N/A'}
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