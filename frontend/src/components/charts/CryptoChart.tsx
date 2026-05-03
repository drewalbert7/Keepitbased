import React, { useEffect, useRef, useState, useMemo } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, HistogramData, LineData, CandlestickSeries, HistogramSeries, LineSeries, PriceScaleMode } from 'lightweight-charts';
import { CryptoCandle, formatCryptoPrice, formatCryptoVolume } from '../../services/cryptoService';
import TradingViewTimeline from './TradingViewTimeline';
import {
  computeCryptoTechnicalSeries,
  summarizeCryptoIndicators,
  type CryptoIndicatorSummary,
} from './cryptoChartTechnical';

interface CryptoChartProps {
  data: CryptoCandle[];
  symbol: string;
  height?: number;
  showVolume?: boolean;
  showIndicators?: boolean;
  interval?: string;
  isLive?: boolean;
  onCrosshairMove?: (data: any) => void;
  onTimeScaleChange?: (scale: string, interval: string) => void;
  currentTimeScale?: string;
  currentInterval?: string;
  /** Latest indicator values for sidebar (aligned with chart series). */
  onIndicatorSummary?: (summary: CryptoIndicatorSummary | null) => void;
}

export const CryptoChart: React.FC<CryptoChartProps> = ({
  data,
  symbol,
  height = 600,
  showVolume = true,
  showIndicators = true,
  interval = '1h',
  isLive = false,
  onCrosshairMove,
  onTimeScaleChange,
  currentTimeScale = '1Y',
  currentInterval = '1d',
  onIndicatorSummary,
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const sma20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const sma50SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  
  const [currentCandle, setCurrentCandle] = useState<CryptoCandle | null>(null);
  const [zoomEnabled, setZoomEnabled] = useState(true);
  const [panEnabled, setPanEnabled] = useState(true);

  
  // Initialize chart (only once)
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#0f172a' },
        textColor: '#e2e8f0',
        fontSize: 12,
        fontFamily: 'Inter, system-ui, sans-serif'
      },
      grid: {
        vertLines: { color: '#1e293b', style: 1, visible: true },
        horzLines: { color: '#1e293b', style: 1, visible: true },
      },
      crosshair: {
        mode: 0,
        vertLine: {
          color: '#64748b',
          width: 1,
          style: 0,
          labelBackgroundColor: '#1e293b'
        },
        horzLine: {
          color: '#64748b',
          width: 1,
          style: 0,
          labelBackgroundColor: '#1e293b'
        }
      },
      rightPriceScale: {
        borderColor: '#1e293b',
        textColor: '#cbd5e1',
        entireTextOnly: false,
        scaleMargins: {
          top: 0.1,
          bottom: 0.2
        }
      },
      leftPriceScale: {
        borderColor: '#1e293b',
        textColor: '#cbd5e1',
        scaleMargins: {
          top: 0.1,
          bottom: 0.2
        }
      },
      timeScale: {
        borderColor: '#1e293b',
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        lockVisibleTimeRangeOnResize: true,
        rightOffset: 0,
        minBarSpacing: 0.5,
        tickMarkFormatter: (time: number) => {
          const date = new Date(time); // Expecting milliseconds
          const now = new Date();
          
          // Calculate time differences for smart formatting
          const timeDiff = now.getTime() - date.getTime();
          const daysDiff = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
          
          // Use browser's locale for automatic localization
          const locale = undefined;
          
          // Format based on time range and data density
          if (daysDiff <= 1) {
            // Today - show time in 24-hour format
            return date.toLocaleTimeString(locale, { 
              hour: '2-digit',
              minute: '2-digit',
              hour12: false
            });
          } else if (daysDiff <= 7) {
            // Last week - show day and time
            return date.toLocaleString(locale, { 
              month: 'short', 
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false
            });
          } else if (daysDiff <= 365) {
            // This year - show month/day
            return date.toLocaleDateString(locale, { 
              month: 'short', 
              day: 'numeric'
            });
          } else {
            // Previous years - show year/month/day
            return date.toLocaleDateString(locale, { 
              year: 'numeric',
              month: 'short', 
              day: 'numeric'
            });
          }
        }
      }
    });

    chartRef.current = chart;

    // Create candlestick series
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
      priceFormat: {
        type: 'price',
        precision: 8,
        minMove: 0.00000001,
      },
    });

    candlestickSeriesRef.current = candlestickSeries;

    // Create volume series if enabled
    if (showVolume) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        color: '#6b7280',
        priceFormat: {
          type: 'volume',
        },
        priceScaleId: 'volume',
      });

      volumeSeriesRef.current = volumeSeries;

      // Configure volume price scale
      chart.priceScale('volume').applyOptions({
        scaleMargins: {
          top: 0.7,
          bottom: 0,
        },
        borderColor: '#374151',
        textColor: '#9ca3af',
      });
    }

    // Create SMA indicators if enabled
    if (showIndicators) {
      const sma20Series = chart.addSeries(LineSeries, {
        color: '#3b82f6',
        lineWidth: 1,
        title: 'SMA 20',
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });

      const sma50Series = chart.addSeries(LineSeries, {
        color: '#f59e0b',
        lineWidth: 1,
        title: 'SMA 50',
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });

      sma20SeriesRef.current = sma20Series;
      sma50SeriesRef.current = sma50Series;
    }

    // Handle crosshair move
    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setCurrentCandle(null);
        return;
      }

      const candleData = param.seriesData.get(candlestickSeries) as CandlestickData | undefined;
      const volumeData = volumeSeriesRef.current ? 
        param.seriesData.get(volumeSeriesRef.current) as HistogramData | undefined : 
        undefined;

      if (candleData) {
        setCurrentCandle({
          time: param.time as number,
          open: candleData.open,
          high: candleData.high,
          low: candleData.low,
          close: candleData.close,
          volume: volumeData?.value || 0,
          vwap: 0, // Not available in crosshair
          trades: 0 // Not available in crosshair
        });

        onCrosshairMove?.({
          time: param.time,
          candle: candleData,
          volume: volumeData?.value,
          price: candleData.close
        });
      }
    });

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: height
        });
      }
    };

    window.addEventListener('resize', handleResize);
    
    // Add keyboard event handlers
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '=') {
        // Zoom in
        chart.timeScale().fitContent();
      } else if (e.key === '-' || e.key === '_') {
        // Zoom out
        chart.timeScale().fitContent();
      } else if (e.key === '0') {
        // Reset zoom
        chart.timeScale().fitContent();
      }
    };

    window.addEventListener('keydown', handleKeyPress);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyPress);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, []); // Empty dependency array - initialize only once

  // Handle volume series creation/removal
  useEffect(() => {
    if (!chartRef.current || !candlestickSeriesRef.current) return;

    if (showVolume && !volumeSeriesRef.current) {
      const volumeSeries = chartRef.current.addSeries(HistogramSeries, {
        color: '#64748b',
        priceFormat: {
          type: 'volume',
        },
        priceScaleId: 'volume',
      });

      volumeSeriesRef.current = volumeSeries;

      // Configure volume price scale
      chartRef.current.priceScale('volume').applyOptions({
        scaleMargins: {
          top: 0.7,
          bottom: 0,
        },
        borderColor: '#1e293b',
        textColor: '#94a3b8',
      });
    } else if (!showVolume && volumeSeriesRef.current) {
      chartRef.current.removeSeries(volumeSeriesRef.current);
      volumeSeriesRef.current = null;
    }
  }, [showVolume]);

  // Handle SMA indicators creation/removal
  useEffect(() => {
    if (!chartRef.current || !candlestickSeriesRef.current) return;

    if (showIndicators) {
      if (!sma20SeriesRef.current) {
        const sma20Series = chartRef.current.addSeries(LineSeries, {
          color: '#3b82f6',
          lineWidth: 2,
          title: 'SMA 20',
          priceLineVisible: false,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
        });

        sma20SeriesRef.current = sma20Series;
      }

      if (!sma50SeriesRef.current) {
        const sma50Series = chartRef.current.addSeries(LineSeries, {
          color: '#f59e0b',
          lineWidth: 2,
          title: 'SMA 50',
          priceLineVisible: false,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
        });

        sma50SeriesRef.current = sma50Series;
      }
    } else {
      if (sma20SeriesRef.current) {
        chartRef.current.removeSeries(sma20SeriesRef.current);
        sma20SeriesRef.current = null;
      }

      if (sma50SeriesRef.current) {
        chartRef.current.removeSeries(sma50SeriesRef.current);
        sma50SeriesRef.current = null;
      }
    }
  }, [showIndicators]);

  const technicalData = useMemo(() => computeCryptoTechnicalSeries(data), [data]);

  useEffect(() => {
    if (!onIndicatorSummary) return;
    if (!data.length) {
      onIndicatorSummary(null);
      return;
    }
    onIndicatorSummary(summarizeCryptoIndicators(technicalData));
  }, [data, technicalData, onIndicatorSummary]);

  // Update chart data
  useEffect(() => {
    if (!data.length || !chartRef.current || !candlestickSeriesRef.current) return;

    const candlestickData: CandlestickData[] = data.map(candle => ({
      time: candle.time as any, // Convert to proper Time type
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close
    }));

    // Update candlestick series data
    candlestickSeriesRef.current.setData(candlestickData);

    // Update volume series if it exists and is enabled
    if (volumeSeriesRef.current && showVolume) {
      const volumeData: HistogramData[] = data.map(candle => ({
        time: candle.time as any, // Convert to proper Time type
        value: candle.volume,
        color: candle.close >= candle.open ? '#10b981' : '#ef4444'
      }));
      volumeSeriesRef.current.setData(volumeData);
    }

    // Update SMA indicators if they exist and are enabled
    if (showIndicators) {
      if (sma20SeriesRef.current) {
        sma20SeriesRef.current.setData(technicalData.sma20);
      }
      if (sma50SeriesRef.current) {
        sma50SeriesRef.current.setData(technicalData.sma50);
      }
    }

    // Update chart scale based on timeframe
    const timeScale = chartRef.current.timeScale();
    const barSpacing = getOptimalBarSpacing(data.length, interval);
    
    // Calculate visible range based on data
    const visibleRange = data.length > 0 ? {
      from: data[0].time - 3600, // Add 1 hour padding before
      to: data[data.length - 1].time + 3600 // Add 1 hour padding after
    } : null;
    
    // For live data, keep the chart scrolled to the right to show latest data
    const rightOffset = isLive ? 20 : 10;
    
    timeScale.applyOptions({
      barSpacing: barSpacing,
      fixLeftEdge: true,
      fixRightEdge: true,
      lockVisibleTimeRangeOnResize: true,
      rightOffset: rightOffset,
      minBarSpacing: 0.5
    });

    // Set visible range if we have data
    if (visibleRange) {
      timeScale.setVisibleRange({
        from: visibleRange.from as any,
        to: visibleRange.to as any
      });
    } else {
      timeScale.fitContent();
    }
    
    // For live data, scroll to show the most recent candle
    if (isLive && data.length > 0) {
      const latestTime = data[data.length - 1].time;
      timeScale.scrollToRealTime();
    }
  }, [data, technicalData, interval, isLive]); // Added isLive to dependencies

  // Update chart size and handle responsive behavior
  useEffect(() => {
    if (chartRef.current && chartContainerRef.current) {
      chartRef.current.applyOptions({
        width: chartContainerRef.current.clientWidth,
        height: height
      });

      // Maintain scroll position when resizing
      const timeScale = chartRef.current.timeScale();
      const visibleRange = timeScale.getVisibleRange();
      if (visibleRange) {
        timeScale.setVisibleRange(visibleRange);
      }
    }
  }, [height]);

  // Enhanced bar spacing calculation with performance optimization
  const getOptimalBarSpacing = (dataLength: number, interval: string): number => {
    if (!chartContainerRef.current) return 2;
    
    const baseWidth = chartContainerRef.current.clientWidth;
    const targetBars = Math.min(150, Math.max(30, dataLength));
    const spacing = Math.max(baseWidth / targetBars, 1);
    
    // Enhanced timeframe multipliers for better visualization
    const timeframeMultiplier: Record<string, number> = {
      '1m': 0.2,
      '3m': 0.3,
      '5m': 0.4,
      '15m': 0.6,
      '30m': 0.8,
      '1h': 1.0,
      '2h': 1.3,
      '4h': 1.8,
      '6h': 2.2,
      '12h': 3.0,
      '1d': 5.0,
      '3d': 8.0,
      '1w': 12.0,
      '2w': 18.0,
      '1M': 25.0
    };
    
    const adjustedSpacing = spacing * (timeframeMultiplier[interval] || 1.0);
    return Math.min(Math.max(adjustedSpacing, 0.3), 40); // Optimized range
  };

  // Dynamic time formatter based on data range and interval
  const getTimeFormatter = () => {
    if (!data.length) return (time: number) => new Date(time).toLocaleDateString();
    
    const earliestTime = data[0].time;
    const latestTime = data[data.length - 1].time;
    const timeRange = latestTime - earliestTime;
    const daysRange = timeRange / (1000 * 60 * 60 * 24);
    
    return (time: number) => {
      const date = new Date(time);
      const now = new Date();
      
      // Use browser's locale for automatic localization
      const locale = undefined; // Let browser determine user's locale
      
      // Different formatting based on data range
      if (daysRange <= 1) {
        // Intraday data - show times in 24-hour format for international consistency
        return date.toLocaleTimeString(locale, { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: false
        });
      } else if (daysRange <= 7) {
        // Weekly range - show abbreviated date and time
        return date.toLocaleString(locale, { 
          month: 'short', 
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
      } else if (daysRange <= 90) {
        // Quarterly range - show abbreviated date
        return date.toLocaleDateString(locale, { 
          month: 'short', 
          day: 'numeric'
        });
      } else if (daysRange <= 730) {
        // Biennial range - show month and year
        return date.toLocaleDateString(locale, { 
          month: 'short', 
          year: 'numeric'
        });
      } else {
        // Multi-year range - show full date with year
        return date.toLocaleDateString(locale, { 
          year: 'numeric',
          month: 'short', 
          day: 'numeric'
        });
      }
    };
  };

  const getCurrentPrice = () => {
    if (currentCandle) return currentCandle.close;
    if (data.length > 0) return data[data.length - 1].close;
    return 0;
  };

  const getCurrentChange = () => {
    if (data.length < 2) return { change: 0, changePercent: 0 };
    
    const current = getCurrentPrice();
    const previous = data[data.length - 2]?.close || 0;
    const change = current - previous;
    const changePercent = previous > 0 ? (change / previous) * 100 : 0;
    
    return { change, changePercent };
  };

  const { change, changePercent } = getCurrentChange();
  const currentPrice = getCurrentPrice();

  return (
    <div className="w-full bg-gray-900 rounded-lg overflow-hidden">
      {/* Professional Chart Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border-b border-slate-700 bg-slate-900/50 space-y-3 sm:space-y-0">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-3">
            <h2 className="text-xl font-bold text-white">{symbol}</h2>
            {isLive && (
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-xs text-green-400 font-medium bg-green-900/30 px-2 py-1 rounded-full">
                  LIVE
                </span>
              </div>
            )}
            <div className="flex items-baseline space-x-3">
              <span className="text-2xl font-bold text-white">
                {formatCryptoPrice(currentPrice)}
              </span>
              <span className={`text-lg font-semibold ${
                change >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {change >= 0 ? '+' : ''}{formatCryptoPrice(Math.abs(change))}
              </span>
              <span className={`text-lg font-semibold ${
                change >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                ({changePercent.toFixed(2)}%)
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-4">
          {/* Price Information */}
          <div className="flex items-center space-x-4 text-sm text-slate-400">
            {currentCandle && (
              <div className="flex items-center space-x-4">
                <div className="flex space-x-2">
                  <span className="text-slate-500">O:</span>
                  <span className="text-white font-medium">{formatCryptoPrice(currentCandle.open)}</span>
                </div>
                <div className="flex space-x-2">
                  <span className="text-slate-500">H:</span>
                  <span className="text-green-400 font-medium">{formatCryptoPrice(currentCandle.high)}</span>
                </div>
                <div className="flex space-x-2">
                  <span className="text-slate-500">L:</span>
                  <span className="text-red-400 font-medium">{formatCryptoPrice(currentCandle.low)}</span>
                </div>
                <div className="flex space-x-2">
                  <span className="text-slate-500">C:</span>
                  <span className="text-white font-medium">{formatCryptoPrice(currentCandle.close)}</span>
                </div>
                {currentCandle.volume > 0 && (
                  <div className="flex space-x-2">
                    <span className="text-slate-500">Vol:</span>
                    <span className="text-slate-300 font-medium">{formatCryptoVolume(currentCandle.volume)}</span>
                  </div>
                )}
              </div>
            )}
            {!currentCandle && data.length > 0 && (
              <div className="text-slate-400">
                <span className="text-slate-500">Bars:</span>
                <span className="text-white font-medium ml-1">{data.length}</span>
              </div>
            )}
          </div>
          
          {/* Zoom Controls */}
          <div className="flex items-center space-x-2 bg-slate-800 px-3 py-1 rounded-lg">
            <span className="text-slate-500 text-xs mr-2">Zoom:</span>
            <button 
              onClick={() => {
                const timeScale = chartRef.current?.timeScale();
                if (timeScale) {
                  timeScale.fitContent();
                }
              }}
              className="px-2 py-1 text-xs bg-slate-700 text-slate-300 rounded hover:bg-slate-600 transition-colors"
              title="Zoom In (+)"
            >
              +
            </button>
            <button 
              onClick={() => {
                const timeScale = chartRef.current?.timeScale();
                if (timeScale) {
                  timeScale.fitContent();
                }
              }}
              className="px-2 py-1 text-xs bg-slate-700 text-slate-300 rounded hover:bg-slate-600 transition-colors"
              title="Reset (0)"
            >
              0
            </button>
            <button 
              onClick={() => {
                const timeScale = chartRef.current?.timeScale();
                if (timeScale) {
                  timeScale.fitContent();
                }
              }}
              className="px-2 py-1 text-xs bg-slate-700 text-slate-300 rounded hover:bg-slate-600 transition-colors"
              title="Zoom Out (-)"
            >
              -
            </button>
          </div>
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

      {/* Chart Container */}
      <div 
        ref={chartContainerRef}
        className="w-full"
        style={{ height: `${height}px` }}
      />

      {/* Professional Legend */}
      {(showIndicators || showVolume) && (
        <div className="flex items-center justify-between px-4 py-3 bg-slate-900/80 border-t border-slate-700 text-xs">
          <div className="flex items-center space-x-6">
            {showIndicators && (
              <>
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-0.5 bg-blue-500"></div>
                  <span className="text-blue-400 font-medium">MA 20</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-0.5 bg-yellow-500"></div>
                  <span className="text-yellow-400 font-medium">MA 50</span>
                </div>
              </>
            )}
            {showVolume && (
              <div className="flex items-center space-x-2">
                <div className="w-3 h-2 bg-slate-600"></div>
                <span className="text-slate-400 font-medium">Volume</span>
              </div>
            )}
          </div>
          <div className="text-slate-500">
            {data.length > 0 && (
              <span>{data.length} {String(interval).toUpperCase()} candles</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CryptoChart;