import React, { useMemo } from 'react';
import TradingViewTimeline from './TradingViewTimeline';

interface ChartData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface SimpleChartProps {
  data: ChartData[];
  symbol: string;
  height?: number;
  showVolume?: boolean;
  showIndicators?: boolean;
  onTimeScaleChange?: (scale: string, interval: string) => void;
  currentTimeScale?: string;
  currentInterval?: string;
}

export const SimpleChart: React.FC<SimpleChartProps> = ({
  data,
  symbol,
  height = 600,
  showVolume = true,
  showIndicators = true,
  onTimeScaleChange,
  currentTimeScale = '1Y',
  currentInterval = '1d'
}) => {
  const currentPrice = data.length > 0 ? data[data.length - 1]?.close : 0;
  const previousPrice = data.length > 1 ? data[data.length - 2]?.close : 0;
  const change = currentPrice - previousPrice;
  const changePercent = previousPrice > 0 ? (change / previousPrice) * 100 : 0;

  const chartMetrics = useMemo(() => {
    if (data.length === 0) return { min: 0, max: 0, range: 0 };
    
    const prices = data.map(d => [d.high, d.low, d.open, d.close]).flat();
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min;
    
    return { min, max, range };
  }, [data]);

  const renderCandlestick = (candle: ChartData, index: number) => {
    const { min, max, range } = chartMetrics;
    if (range === 0) return null;

    const isGreen = candle.close >= candle.open;
    const bodyTop = Math.max(candle.open, candle.close);
    const bodyBottom = Math.min(candle.open, candle.close);
    
    const wickTop = ((max - candle.high) / range) * 100;
    const bodyTopPercent = ((max - bodyTop) / range) * 100;
    const bodyHeight = ((bodyTop - bodyBottom) / range) * 100;
    const wickBottomHeight = ((bodyBottom - candle.low) / range) * 100;

    return (
      <div key={index} className="flex-1 flex flex-col justify-end items-center h-full relative">
        {/* Upper wick */}
        <div 
          className={`w-0.5 ${isGreen ? 'bg-green-400' : 'bg-red-400'}`}
          style={{ 
            height: `${bodyTopPercent - wickTop}%`,
            marginTop: `${wickTop}%`,
            position: 'absolute',
            top: 0
          }}
        />
        
        {/* Candle body */}
        <div 
          className={`w-2 border ${isGreen ? 'bg-green-400 border-green-400' : 'bg-red-400 border-red-400'}`}
          style={{ 
            height: `${Math.max(bodyHeight, 1)}%`,
            marginTop: `${bodyTopPercent}%`,
            position: 'absolute',
            top: 0
          }}
        />
        
        {/* Lower wick */}
        <div 
          className={`w-0.5 ${isGreen ? 'bg-green-400' : 'bg-red-400'}`}
          style={{ 
            height: `${wickBottomHeight}%`,
            position: 'absolute',
            bottom: 0
          }}
        />
      </div>
    );
  };

  return (
    <div className="w-full bg-gray-900 rounded-lg overflow-hidden text-white">
      {/* Chart Header - TradingView style */}
      <div className="flex items-center justify-between p-4 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center space-x-6">
          <h2 className="text-2xl font-bold">{symbol}</h2>
          <div className="flex items-baseline space-x-3">
            <span className="text-3xl font-bold">${currentPrice.toFixed(2)}</span>
            <span 
              className={`text-lg font-semibold ${
                change >= 0 ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {change >= 0 ? '+' : ''}${change.toFixed(2)}
            </span>
            <span 
              className={`text-lg font-semibold ${
                change >= 0 ? 'text-green-400' : 'text-red-400'
              }`}
            >
              ({changePercent.toFixed(2)}%)
            </span>
          </div>
        </div>
        <div className="flex items-center space-x-4 text-sm text-gray-400">
          <span>Vol: {data[data.length - 1]?.volume?.toLocaleString() || 'N/A'}</span>
          <span>Points: {data.length}</span>
        </div>
      </div>

      {/* TradingView Timeline */}
      {onTimeScaleChange && (
        <TradingViewTimeline
          onTimeScaleChange={onTimeScaleChange}
          currentScale={currentTimeScale}
          currentInterval={currentInterval}
        />
      )}

      {/* Candlestick Chart */}
      <div className="relative bg-gray-900">
        {data.length > 0 ? (
          <>
            {/* Price scale on the right */}
            <div className="absolute right-2 top-0 h-full flex flex-col justify-between py-4 text-xs text-gray-400">
              <span>${chartMetrics.max.toFixed(2)}</span>
              <span>${((chartMetrics.max + chartMetrics.min) / 2).toFixed(2)}</span>
              <span>${chartMetrics.min.toFixed(2)}</span>
            </div>
            
            {/* Chart area */}
            <div 
              className="flex items-end px-4 py-2 bg-gradient-to-b from-gray-900 to-gray-800"
              style={{ height: `${height}px` }}
            >
              {data.slice(-Math.min(50, data.length)).map((candle, index) => 
                renderCandlestick(candle, index)
              )}
            </div>
            
            {/* Time labels at bottom */}
            <div className="flex justify-between px-4 py-2 bg-gray-900 text-xs text-gray-400 border-t border-gray-800">
              <span>{new Date(data[Math.max(0, data.length - 50)].time * 1000).toLocaleDateString()}</span>
              <span>{new Date(data[data.length - 1].time * 1000).toLocaleDateString()}</span>
            </div>
          </>
        ) : (
          <div 
            className="flex items-center justify-center bg-gray-800"
            style={{ height: `${height}px` }}
          >
            <div className="text-center text-gray-400">
              <div className="text-xl mb-2">No chart data available</div>
              <div className="text-sm">Please select a stock symbol to view data</div>
            </div>
          </div>
        )}
      </div>

      {/* Market Data Panel */}
      <div className="p-4 bg-gray-900 border-t border-gray-800">
        <div className="grid grid-cols-3 gap-6 mb-4">
          <div>
            <div className="text-xs text-gray-400 mb-1">Day's Range</div>
            <div className="text-sm text-white">
              ${Math.min(...data.slice(-1).map(d => d.low)).toFixed(2)} - ${Math.max(...data.slice(-1).map(d => d.high)).toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-1">Volume</div>
            <div className="text-sm text-white">
              {data[data.length - 1]?.volume?.toLocaleString() || 'N/A'}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-1">Data Points</div>
            <div className="text-sm text-white">{data.length}</div>
          </div>
        </div>
        
        {/* Recent OHLC Data */}
        <div className="border-t border-gray-800 pt-4">
          <h4 className="text-sm font-semibold mb-3 text-gray-300">Recent Sessions</h4>
          <div className="space-y-2">
            {data.slice(-5).reverse().map((item, index) => {
              const isGreen = item.close >= item.open;
              return (
                <div key={index} className="grid grid-cols-6 gap-3 text-xs py-1 hover:bg-gray-800 rounded">
                  <div className="text-gray-400">
                    {new Date(item.time * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                  <div className="text-white">${item.open.toFixed(2)}</div>
                  <div className="text-green-400">${item.high.toFixed(2)}</div>
                  <div className="text-red-400">${item.low.toFixed(2)}</div>
                  <div className={`font-semibold ${isGreen ? 'text-green-400' : 'text-red-400'}`}>
                    ${item.close.toFixed(2)}
                  </div>
                  <div className="text-gray-400 text-right">
                    {item.volume.toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};