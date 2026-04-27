import React, { memo, useEffect, useMemo, useRef } from 'react';
import {
  CandlestickData,
  CandlestickSeries,
  createChart,
  HistogramData,
  HistogramSeries,
  IChartApi,
  ISeriesApi,
  LineData,
  LineSeries
} from 'lightweight-charts';
import TradingViewTimeline from './TradingViewTimeline';

interface ChartData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TechnicalPoint {
  time: number;
  sma20: number | null;
  sma50: number | null;
  ema20: number | null;
  ema50: number | null;
}

interface SimpleChartProps {
  data: ChartData[];
  technicalData?: TechnicalPoint[];
  symbol: string;
  height?: number;
  showVolume?: boolean;
  showIndicators?: boolean;
  onTimeScaleChange?: (scale: string, interval: string) => void;
  currentTimeScale?: string;
  currentInterval?: string;
  sourceUsed?: string;
}

export const SimpleChart: React.FC<SimpleChartProps> = memo(({
  data,
  technicalData = [],
  symbol,
  height = 600,
  showVolume = true,
  showIndicators = true,
  onTimeScaleChange,
  currentTimeScale = '1Y',
  currentInterval = '1d',
  sourceUsed = 'massive_aggs'
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const sma20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const sma50SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema50SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const hasInitialFitRef = useRef(false);

  const displayedData = useMemo(() => data.slice(-Math.min(1000, data.length)), [data]);
  const currentPrice = displayedData.length > 0 ? displayedData[displayedData.length - 1].close : 0;
  const previousPrice = displayedData.length > 1 ? displayedData[displayedData.length - 2].close : 0;
  const change = currentPrice - previousPrice;
  const changePercent = previousPrice > 0 ? (change / previousPrice) * 100 : 0;

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height,
      layout: {
        background: { color: '#111827' },
        textColor: '#d1d5db'
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' }
      },
      rightPriceScale: {
        borderColor: '#374151'
      },
      timeScale: {
        borderColor: '#374151',
        timeVisible: true,
        secondsVisible: false
      },
      crosshair: {
        vertLine: { color: '#6b7280' },
        horzLine: { color: '#6b7280' }
      }
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444'
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#64748b',
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' }
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.75, bottom: 0 },
      borderColor: '#374151'
    });

    const sma20Series = chart.addSeries(LineSeries, {
      color: '#f59e0b',
      lineWidth: 2,
      priceLineVisible: false,
      crosshairMarkerVisible: false
    });
    const sma50Series = chart.addSeries(LineSeries, {
      color: '#60a5fa',
      lineWidth: 2,
      priceLineVisible: false,
      crosshairMarkerVisible: false
    });
    const ema20Series = chart.addSeries(LineSeries, {
      color: '#34d399',
      lineWidth: 2,
      priceLineVisible: false,
      crosshairMarkerVisible: false
    });
    const ema50Series = chart.addSeries(LineSeries, {
      color: '#f472b6',
      lineWidth: 2,
      priceLineVisible: false,
      crosshairMarkerVisible: false
    });

    chartRef.current = chart;
    candleSeriesRef.current = candlestickSeries;
    volumeSeriesRef.current = volumeSeries;
    sma20SeriesRef.current = sma20Series;
    sma50SeriesRef.current = sma50Series;
    ema20SeriesRef.current = ema20Series;
    ema50SeriesRef.current = ema50Series;

    const resizeObserver = new ResizeObserver(() => {
      if (!chartContainerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth, height });
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      sma20SeriesRef.current = null;
      sma50SeriesRef.current = null;
      ema20SeriesRef.current = null;
      ema50SeriesRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;

    const candleData: CandlestickData[] = displayedData.map((row) => ({
      time: row.time as any,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close
    }));
    candleSeriesRef.current.setData(candleData);

    const volumeData: HistogramData[] = displayedData.map((row) => ({
      time: row.time as any,
      value: row.volume,
      color: row.close >= row.open ? '#10b981' : '#ef4444'
    }));
    volumeSeriesRef.current.setData(showVolume ? volumeData : []);

    if (!hasInitialFitRef.current && displayedData.length > 0) {
      chartRef.current?.timeScale().fitContent();
      hasInitialFitRef.current = true;
    }
  }, [displayedData, showVolume]);

  useEffect(() => {
    if (!sma20SeriesRef.current || !sma50SeriesRef.current || !ema20SeriesRef.current || !ema50SeriesRef.current) {
      return;
    }

    const timeSet = new Set(displayedData.map((d) => d.time));
    const filtered = technicalData.filter((p) => timeSet.has(p.time));
    const toLine = (key: keyof Omit<TechnicalPoint, 'time'>): LineData[] =>
      filtered
        .filter((p) => p[key] != null)
        .map((p) => ({ time: p.time as any, value: Number(p[key]) }));

    sma20SeriesRef.current.setData(showIndicators ? toLine('sma20') : []);
    sma50SeriesRef.current.setData(showIndicators ? toLine('sma50') : []);
    ema20SeriesRef.current.setData(showIndicators ? toLine('ema20') : []);
    ema50SeriesRef.current.setData(showIndicators ? toLine('ema50') : []);
  }, [technicalData, displayedData, showIndicators]);

  return (
    <div className="w-full bg-gray-900 rounded-lg overflow-hidden text-white">
      <div className="flex items-center justify-between p-4 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center space-x-6">
          <h2 className="text-2xl font-bold">{symbol}</h2>
          <div className="flex items-baseline space-x-3">
            <span className="text-3xl font-bold">${currentPrice.toFixed(2)}</span>
            <span className={`text-lg font-semibold ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {change >= 0 ? '+' : ''}${change.toFixed(2)}
            </span>
            <span className={`text-lg font-semibold ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              ({changePercent.toFixed(2)}%)
            </span>
          </div>
        </div>
        <div className="flex items-center space-x-4 text-sm text-gray-400">
          <span className="px-2 py-0.5 rounded bg-gray-800 border border-gray-700 text-xs uppercase tracking-wide">
            {sourceUsed}
          </span>
          <span>Vol: {displayedData[displayedData.length - 1]?.volume?.toLocaleString() || 'N/A'}</span>
          <span>Points: {displayedData.length}</span>
        </div>
      </div>

      {onTimeScaleChange && (
        <TradingViewTimeline
          onTimeScaleChange={onTimeScaleChange}
          currentScale={currentTimeScale}
          currentInterval={currentInterval}
        />
      )}

      <div ref={chartContainerRef} className="w-full" style={{ height: `${height}px` }} />

      <div className="px-4 py-2 bg-gray-900 border-t border-gray-800 text-xs text-gray-400 flex items-center gap-4">
        {showIndicators && (
          <>
            <span className="text-amber-400">SMA20</span>
            <span className="text-blue-400">SMA50</span>
            <span className="text-emerald-400">EMA20</span>
            <span className="text-pink-400">EMA50</span>
          </>
        )}
        {showVolume && <span className="text-gray-300">Volume</span>}
      </div>
    </div>
  );
});