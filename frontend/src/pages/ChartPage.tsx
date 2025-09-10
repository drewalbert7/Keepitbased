import React, { useState, useEffect } from 'react';
import { SimpleChart } from '../components/charts/SimpleChart';
import { StockSearch } from '../components/charts/StockSearch';
import { getStockHistory, getStockQuote, getStockInfo, ChartData, QuoteData, StockInfo } from '../services/chartService';
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

  // Real-time quotes
  const { quotes, connectionStatus, isConnected } = useRealTimeQuotes({
    symbols: [selectedSymbol],
    onQuoteUpdate: (quote) => {
      // Update quote data with real-time information
      setQuoteData(prevQuote => prevQuote ? { ...prevQuote, ...quote } : quote);
    }
  });

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
    try {
      const actualPeriod = newPeriod || period;
      const actualInterval = newInterval || interval;

      // Load chart data, quote, and stock info in parallel
      const [historyData, quote, info] = await Promise.all([
        getStockHistory(symbol, actualPeriod, actualInterval),
        getStockQuote(symbol),
        getStockInfo(symbol).catch(() => null) // Stock info is optional
      ]);

      setChartData(historyData.data);
      setQuoteData(quote);
      setStockInfo(info);
      
      if (newPeriod) setPeriod(newPeriod);
      if (newInterval) setInterval(newInterval);
      
    } catch (error) {
      console.error('Error loading stock data:', error);
      toast.error(`Failed to load data for ${symbol}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStockData(selectedSymbol);
  }, [selectedSymbol]);

  const handleSymbolSelect = (symbol: string) => {
    setSelectedSymbol(symbol);
  };

  const handlePeriodChange = (newPeriod: string, newInterval: string) => {
    loadStockData(selectedSymbol, newPeriod, newInterval);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold">Stock Charts</h1>
            
            {/* Controls */}
            <div className="flex items-center space-x-4">
              {/* Connection Status */}
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${
                  isConnected ? 'bg-green-500' : connectionStatus === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'
                }`} />
                <span className="text-xs text-gray-400">
                  {isConnected ? 'Live' : connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
                </span>
              </div>

              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={showVolume}
                  onChange={(e) => setShowVolume(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm">Volume</span>
              </label>
              
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={showIndicators}
                  onChange={(e) => setShowIndicators(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm">Indicators</span>
              </label>
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
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Chart */}
          <div className="lg:col-span-3">
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
              <div className="bg-gray-800 rounded-lg overflow-hidden">
                {chartData.length > 0 ? (
                  <SimpleChart
                    data={chartData}
                    symbol={selectedSymbol}
                    height={600}
                    showVolume={showVolume}
                    showIndicators={showIndicators}
                    onTimeScaleChange={handlePeriodChange}
                    currentTimeScale={period}
                    currentInterval={interval}
                  />
                ) : (
                  <div className="h-96 flex items-center justify-center text-gray-400">
                    {isLoading ? 'Loading chart data...' : 'No chart data available'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Quote Information */}
            {quoteData && (
              <div className="bg-gray-800 rounded-lg p-6">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold">{quoteData.symbol}</h3>
                    <p className="text-gray-400 text-sm">{quoteData.companyName}</p>
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
                      <span>{quoteData.volume.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Stock Information */}
            {stockInfo && (
              <div className="bg-gray-800 rounded-lg p-6">
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
                    <span>{stockInfo.marketCap ? `$${(stockInfo.marketCap / 1e9).toFixed(2)}B` : 'N/A'}</span>
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
          </div>
        </div>
      </div>
    </div>
  );
};