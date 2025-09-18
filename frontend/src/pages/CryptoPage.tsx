import React, { useState, useEffect, useCallback } from 'react';
import CryptoChart from '../components/charts/CryptoChart';
import CryptoSearch from '../components/charts/CryptoSearch';
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
  getTimeRangeLabel 
} from '../services/cryptoService';
import { useRealTimeCrypto } from '../hooks/useRealTimeCrypto';
import { mergeChartData, formatWebSocketOHLC, validateChartData } from '../utils/chartDataUtils';
import { toast } from 'react-hot-toast';

export const CryptoPage: React.FC = () => {
  const [selectedPair, setSelectedPair] = useState<string>('XXBTZUSD'); // Bitcoin/USD
  const [chartData, setChartData] = useState<CryptoCandle[]>([]);
  const [tickerData, setTickerData] = useState<CryptoTicker | null>(null);
  const [interval, setInterval] = useState<keyof typeof KRAKEN_INTERVALS>('1h');
  const [timeRange, setTimeRange] = useState<TimeRange>('1M');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showVolume, setShowVolume] = useState<boolean>(true);
  const [showIndicators, setShowIndicators] = useState<boolean>(true);
  const [crosshairData, setCrosshairData] = useState<any>(null);
  const [lastDataUpdate, setLastDataUpdate] = useState<number>(Date.now());
  const [dataCache, setDataCache] = useState<Map<string, CryptoCandle[]>>(new Map());

  // Real-time data
  const {
    tickers,
    connectionStatus,
    isConnected,
    error: wsError,
    getTicker
  } = useRealTimeCrypto({
    pairs: [selectedPair],
    enableOHLC: true,
    ohlcInterval: interval,
    onTickerUpdate: (ticker) => {
      // Update ticker data with real-time information
      setTickerData(prevTicker => prevTicker ? { ...prevTicker, ...ticker } : ticker);
    },
    onOHLCUpdate: (ohlcData) => {
      // Handle real-time OHLC updates for live chart
      if (ohlcData.symbol === selectedPair) {
        const formattedOHLC = formatWebSocketOHLC(ohlcData);
        setChartData(prevData => {
          const mergedData = mergeChartData(prevData, formattedOHLC, KRAKEN_INTERVALS[interval], true);
          return validateChartData(mergedData);
        });
      }
    }
  });

  const intervalOptions = [
    { value: '1m' as const, label: '1m' },
    { value: '3m' as const, label: '3m' },
    { value: '5m' as const, label: '5m' },
    { value: '15m' as const, label: '15m' },
    { value: '30m' as const, label: '30m' },
    { value: '1h' as const, label: '1h' },
    { value: '2h' as const, label: '2h' },
    { value: '4h' as const, label: '4h' },
    { value: '6h' as const, label: '6h' },
    { value: '8h' as const, label: '8h' },
    { value: '12h' as const, label: '12h' },
    { value: '1d' as const, label: '1d' },
    { value: '3d' as const, label: '3d' },
    { value: '1w' as const, label: '1w' },
    { value: '2w' as const, label: '2w' },
    { value: '1M' as const, label: '1M' },
  ];

  const timeRangeOptions = [
    { value: '1D' as const, label: '1D' },
    { value: '1W' as const, label: '1W' },
    { value: '1M' as const, label: '1M' },
    { value: '3M' as const, label: '3M' },
    { value: '6M' as const, label: '6M' },
    { value: '1Y' as const, label: '1Y' },
    { value: 'ALL' as const, label: 'ALL' }
  ];

  const loadCryptoData = useCallback(async (pair: string, newInterval?: keyof typeof KRAKEN_INTERVALS, newTimeRange?: TimeRange, forceRefresh: boolean = false) => {
    const actualInterval = newInterval || interval;
    const actualTimeRange = newTimeRange || timeRange;
    const cacheKey = `${pair}-${actualInterval}-${actualTimeRange}`;

    // Check cache first with expiry
    if (!forceRefresh && dataCache.has(cacheKey)) {
      const cachedData = dataCache.get(cacheKey)!;
      const cacheAge = Date.now() - lastDataUpdate;
      const maxCacheAge = actualInterval === '1m' ? 30000 : 300000; // 30s for 1m, 5m for others
      
      if (cacheAge < maxCacheAge) {
        setChartData(cachedData);
        
        if (newInterval) setInterval(newInterval);
        if (newTimeRange) setTimeRange(newTimeRange);
        
        setLastDataUpdate(Date.now());
        return;
      }
    }

    setIsLoading(true);
    try {
      // Load OHLC data and ticker with staggered timing to reduce server load
      const [ohlcData, ticker] = await Promise.all([
        getCryptoOHLC(pair, actualInterval, undefined, actualTimeRange),
        new Promise(resolve => setTimeout(resolve, 500)).then(() => 
          getCryptoTicker(pair).catch(() => null)
        ) // Ticker is optional, delayed by 500ms
      ]);

      // Update cache with expiry tracking
      setDataCache(prev => {
        const newCache = new Map(prev);
        newCache.set(cacheKey, ohlcData.data);
        // Limit cache size to prevent memory issues
        if (newCache.size > 15) {
          const firstKey = newCache.keys().next().value;
          newCache.delete(firstKey);
        }
        return newCache;
      });

      setChartData(ohlcData.data);
      if (ticker) {
        setTickerData(ticker);
      }
      
      if (newInterval) {
        setInterval(newInterval);
      }
      
      if (newTimeRange) {
        setTimeRange(newTimeRange);
      }
      
      setLastDataUpdate(Date.now());
      toast.success(`Loaded ${formatPairName(pair)} data - ${getTimeRangeLabel(actualTimeRange)}`);
      
    } catch (error) {
      console.error('Error loading crypto data:', error);
      toast.error(`Failed to load data for ${formatPairName(pair)}`);
      
      // Fallback to cached data if available
      if (dataCache.has(cacheKey)) {
        console.log('Using cached data as fallback');
        setChartData(dataCache.get(cacheKey)!);
        toast.info('Showing cached data while offline');
      }
    } finally {
      setIsLoading(false);
    }
  }, [interval, timeRange, dataCache, lastDataUpdate]);

  useEffect(() => {
    loadCryptoData(selectedPair);
  }, [selectedPair, loadCryptoData]);

  const handlePairSelect = (pair: string) => {
    setSelectedPair(pair);
    setCrosshairData(null);
  };

  const handleIntervalChange = (newInterval: keyof typeof KRAKEN_INTERVALS) => {
    // Debounce rapid interval changes
    if (isLoading) return;
    
    // Clear existing data when changing intervals to avoid timestamp conflicts
    setChartData([]);
    loadCryptoData(selectedPair, newInterval);
  };

  const handleTimeRangeChange = (newTimeRange: TimeRange) => {
    // Debounce rapid time range changes
    if (isLoading) return;
    
    // Clear existing data when changing time ranges
    setChartData([]);
    loadCryptoData(selectedPair, undefined, newTimeRange);
  };

  const handleRefresh = () => {
    // Force refresh current data
    loadCryptoData(selectedPair, undefined, undefined, true);
  };

  const handleCrosshairMove = (data: any) => {
    setCrosshairData(data);
  };

  // Get the current ticker data (real-time or static)
  const currentTicker = getTicker(selectedPair) || tickerData;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-robinhood-gray-900">Crypto Charts</h1>
            <p className="text-robinhood-gray-600 mt-2">Real-time cryptocurrency trading charts powered by Kraken</p>
          </div>
          
          {/* Connection Status */}
          <div className="flex items-center space-x-2">
            <div className={`w-3 h-3 rounded-full ${
              isConnected ? 'bg-robinhood-green animate-pulse' : 
              connectionStatus === 'connecting' ? 'bg-yellow-500' : 'bg-robinhood-red'
            }`} />
            <span className="text-sm text-robinhood-gray-600 font-medium">
              {isConnected ? 'Live Data' : 
               connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
            </span>
            {isConnected && (
              <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
                Real-time OHLC
              </span>
            )}
          </div>
        </div>

        {/* Search and Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="max-w-md flex-1">
            <CryptoSearch
              onSelectPair={handlePairSelect}
              currentPair={selectedPair}
            />
          </div>
          
          <div className="flex items-center space-x-4">
            {/* WebSocket Error */}
            {wsError && (
              <div className="text-xs text-robinhood-red px-2 py-1 bg-red-50 rounded" title={wsError}>
                Connection Error
              </div>
            )}

            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={showVolume}
                onChange={(e) => setShowVolume(e.target.checked)}
                className="rounded text-robinhood-green focus:ring-robinhood-green"
              />
              <span className="text-sm text-robinhood-gray-700">Volume</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={showIndicators}
                onChange={(e) => setShowIndicators(e.target.checked)}
                className="rounded text-robinhood-green focus:ring-robinhood-green"
              />
              <span className="text-sm text-robinhood-gray-700">Indicators</span>
            </label>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Chart */}
        <div className="lg:col-span-3">
          <div className="card p-0 overflow-hidden">
            {/* Professional Interval and Time Range Selection */}
            <div className="p-6 border-b border-slate-700 bg-slate-800/50">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                {/* Interval Selection */}
                <div className="flex flex-col gap-2">
                  <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Interval</span>
                  <div className="flex space-x-1 bg-slate-700 p-1 rounded-lg">
                    {intervalOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => handleIntervalChange(option.value)}
                        disabled={isLoading}
                        className={`px-3 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
                          interval === option.value
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-300 hover:bg-slate-600'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Time Range Selection */}
                <div className="flex flex-col gap-2">
                  <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Time Range</span>
                  <div className="flex space-x-1 bg-slate-700 p-1 rounded-lg">
                    {timeRangeOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => handleTimeRangeChange(option.value)}
                        disabled={isLoading}
                        className={`px-3 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
                          timeRange === option.value
                            ? 'bg-robinhood-green text-white shadow-sm'
                            : 'text-slate-300 hover:bg-slate-600'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                
                {/* Refresh Button */}
                <button
                  onClick={handleRefresh}
                  disabled={isLoading}
                  className="flex items-center space-x-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Refresh data"
                >
                  <svg className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span className="text-sm font-medium">Refresh</span>
                </button>
              </div>
            </div>

            {/* Chart */}
            <div className="bg-gray-900">
              {chartData.length > 0 ? (
                <CryptoChart
                  data={chartData}
                  symbol={formatPairName(selectedPair)}
                  height={600}
                  showVolume={showVolume}
                  showIndicators={showIndicators}
                  interval={interval}
                  isLive={isConnected}
                  onCrosshairMove={handleCrosshairMove}
                />
              ) : (
                <div className="h-96 flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <div className="text-lg font-medium mb-2">
                      {isLoading ? 'Loading chart data...' : 'No chart data available'}
                    </div>
                    {!isLoading && (
                      <p className="text-sm text-gray-400">
                        Select a crypto pair to view its chart
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Current Price Information */}
          {currentTicker && (
            <div className="card">
              <div className="space-y-4">
                <div className="border-b border-robinhood-gray-200 pb-4">
                  <h3 className="text-xl font-bold text-robinhood-gray-900">{formatPairName(currentTicker.symbol)}</h3>
                  <p className="text-robinhood-gray-500 text-sm">
                    {getIntervalLabel(interval)} • {getTimeRangeLabel(timeRange)} • Kraken
                  </p>
                </div>
                
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-robinhood-gray-600 font-medium">Price</span>
                    <span className="font-bold text-lg text-robinhood-gray-900">
                      {formatCryptoPrice(currentTicker.price)}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <span className="text-robinhood-gray-600 font-medium">Change</span>
                    <span className={`font-bold ${
                      currentTicker.change >= 0 ? 'price-positive' : 'price-negative'
                    }`}>
                      {currentTicker.change >= 0 ? '+' : ''}{formatCryptoPrice(Math.abs(currentTicker.change))} 
                      ({currentTicker.changePercent.toFixed(2)}%)
                    </span>
                  </div>
                  
                  <div className="flex justify-between">
                    <span className="text-robinhood-gray-600">24h High</span>
                    <span className="font-semibold text-robinhood-gray-800">{formatCryptoPrice(currentTicker.high)}</span>
                  </div>
                  
                  <div className="flex justify-between">
                    <span className="text-robinhood-gray-600">24h Low</span>
                    <span className="font-semibold text-robinhood-gray-800">{formatCryptoPrice(currentTicker.low)}</span>
                  </div>
                  
                  <div className="flex justify-between">
                    <span className="text-robinhood-gray-600">24h Volume</span>
                    <span className="font-semibold text-robinhood-gray-800">{formatCryptoVolume(currentTicker.volume)}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-robinhood-gray-600">VWAP</span>
                    <span className="font-semibold text-robinhood-gray-800">{formatCryptoPrice(currentTicker.vwap)}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-robinhood-gray-600">Bid</span>
                    <span className="price-positive font-semibold">{formatCryptoPrice(currentTicker.bid)}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-robinhood-gray-600">Ask</span>
                    <span className="price-negative font-semibold">{formatCryptoPrice(currentTicker.ask)}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-robinhood-gray-600">Spread</span>
                    <span className="font-semibold text-robinhood-gray-800">{formatCryptoPrice(currentTicker.spread)}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-robinhood-gray-600">24h Trades</span>
                    <span className="font-semibold text-robinhood-gray-800">{currentTicker.trades.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Crosshair Data */}
          {crosshairData && (
            <div className="card">
              <h4 className="text-lg font-semibold text-robinhood-gray-900 mb-4">Crosshair Data</h4>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-robinhood-gray-600">Time</span>
                  <span className="font-medium text-robinhood-gray-800">{new Date(crosshairData.time * 1000).toLocaleString()}</span>
                </div>
                
                {crosshairData.candle && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-robinhood-gray-600">Open</span>
                      <span className="font-semibold text-robinhood-gray-800">{formatCryptoPrice(crosshairData.candle.open)}</span>
                    </div>
                    
                    <div className="flex justify-between">
                      <span className="text-robinhood-gray-600">High</span>
                      <span className="price-positive font-semibold">{formatCryptoPrice(crosshairData.candle.high)}</span>
                    </div>
                    
                    <div className="flex justify-between">
                      <span className="text-robinhood-gray-600">Low</span>
                      <span className="price-negative font-semibold">{formatCryptoPrice(crosshairData.candle.low)}</span>
                    </div>
                    
                    <div className="flex justify-between">
                      <span className="text-robinhood-gray-600">Close</span>
                      <span className={`font-bold ${
                        crosshairData.candle.close >= crosshairData.candle.open ? 'price-positive' : 'price-negative'
                      }`}>
                        {formatCryptoPrice(crosshairData.candle.close)}
                      </span>
                    </div>
                  </>
                )}
                
                {crosshairData.volume && (
                  <div className="flex justify-between">
                    <span className="text-robinhood-gray-600">Volume</span>
                    <span className="font-semibold text-robinhood-gray-800">{formatCryptoVolume(crosshairData.volume)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Market Statistics */}
          <div className="card">
            <h4 className="text-lg font-semibold text-robinhood-gray-900 mb-4">Market Info</h4>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-robinhood-gray-600">Interval</span>
                <span className="font-semibold text-robinhood-gray-800">{getIntervalLabel(interval)}</span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-robinhood-gray-600">Time Range</span>
                <span className="font-semibold text-robinhood-gray-800">{getTimeRangeLabel(timeRange)}</span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-robinhood-gray-600">Candles</span>
                <span className="font-semibold text-robinhood-gray-800">{chartData.length.toLocaleString()}</span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-robinhood-gray-600">Exchange</span>
                <span className="font-semibold text-robinhood-gray-800">Kraken</span>
              </div>

              <div className="flex justify-between">
                <span className="text-robinhood-gray-600">Data Source</span>
                <span className={`font-semibold ${isConnected ? 'text-green-600' : 'text-gray-600'}`}>
                  {isConnected ? 'Live WebSocket' : 'REST API'}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-robinhood-gray-600">Last Update</span>
                <span className="font-semibold text-robinhood-gray-800">
                  {isConnected ? 'Real-time' : new Date(lastDataUpdate).toLocaleTimeString()}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CryptoPage;