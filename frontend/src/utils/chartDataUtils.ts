import { CryptoCandle } from '../services/cryptoService';

export interface LiveChartData {
  candles: CryptoCandle[];
  lastUpdateTime: number;
  isLive: boolean;
}

/**
 * Merge new OHLC data with existing chart data
 * Handles both updating the current candle and adding new completed candles
 */
export const mergeChartData = (
  existingData: CryptoCandle[],
  newData: CryptoCandle,
  currentInterval: number, // in minutes
  isRealTime: boolean = true
): CryptoCandle[] => {
  if (!existingData.length) {
    return [newData];
  }

  const lastCandle = existingData[existingData.length - 1];
  const newCandleTime = newData.time;
  const intervalMs = currentInterval * 60 * 1000;

  // Calculate which interval this new data belongs to
  const newCandleIntervalStart = Math.floor(newCandleTime / intervalMs) * intervalMs;
  const lastCandleIntervalStart = Math.floor(lastCandle.time / intervalMs) * intervalMs;

  // If it's the same interval as the last candle, update it
  if (newCandleIntervalStart === lastCandleIntervalStart && isRealTime) {
    const updatedCandle: CryptoCandle = {
      ...lastCandle,
      high: Math.max(lastCandle.high, newData.high),
      low: Math.min(lastCandle.low, newData.low),
      close: newData.close,
      volume: lastCandle.volume + newData.volume,
      trades: lastCandle.trades + newData.trades,
      vwap: calculateVWAP(lastCandle, newData)
    };

    return [...existingData.slice(0, -1), updatedCandle];
  }

  // If it's a new interval, add the completed candle
  if (newCandleIntervalStart > lastCandleIntervalStart) {
    // Ensure no gaps by checking if we missed any intervals
    const expectedNextInterval = lastCandleIntervalStart + intervalMs;
    
    if (newCandleIntervalStart > expectedNextInterval) {
      // Fill missing intervals with last known data
      const filledCandles: CryptoCandle[] = [];
      let currentIntervalTime = expectedNextInterval;
      
      while (currentIntervalTime < newCandleIntervalStart) {
        filledCandles.push({
          time: currentIntervalTime,
          open: lastCandle.close,
          high: lastCandle.close,
          low: lastCandle.close,
          close: lastCandle.close,
          volume: 0,
          trades: 0,
          vwap: lastCandle.close
        });
        currentIntervalTime += intervalMs;
      }
      
      return [...existingData, ...filledCandles, newData];
    }

    return [...existingData, newData];
  }

  // If it's older data, insert it in the correct position
  const insertIndex = existingData.findIndex(candle => candle.time >= newCandleTime);
  if (insertIndex === -1) {
    return [...existingData, newData];
  }

  // Replace if exact timestamp match, otherwise insert
  if (existingData[insertIndex].time === newCandleTime) {
    return [
      ...existingData.slice(0, insertIndex),
      newData,
      ...existingData.slice(insertIndex + 1)
    ];
  }

  return [
    ...existingData.slice(0, insertIndex),
    newData,
    ...existingData.slice(insertIndex)
  ];
};

/**
 * Calculate Volume Weighted Average Price
 */
const calculateVWAP = (existingCandle: CryptoCandle, newData: CryptoCandle): number => {
  const totalVolume = existingCandle.volume + newData.volume;
  if (totalVolume === 0) return newData.close;
  
  const existingValue = existingCandle.vwap * existingCandle.volume;
  const newValue = newData.close * newData.volume;
  
  return (existingValue + newValue) / totalVolume;
};

/**
 * Complete the current candle and start a new one
 * Used when a time interval ends
 */
export const completeCurrentCandle = (
  existingData: CryptoCandle[],
  currentInterval: number
): CryptoCandle[] => {
  if (!existingData.length) return existingData;

  const lastCandle = existingData[existingData.length - 1];
  const now = Date.now();
  const intervalMs = currentInterval * 60 * 1000;
  
  const lastCandleInterval = Math.floor(lastCandle.time / intervalMs) * intervalMs;
  const currentIntervalStart = Math.floor(now / intervalMs) * intervalMs;

  // If we're in a new interval, complete the last candle
  if (currentIntervalStart > lastCandleInterval) {
    return existingData; // The last candle is already complete
  }

  return existingData;
};

/**
 * Clean up old candles to maintain performance
 * Keep reasonable number of candles based on interval
 */
export const cleanupChartData = (
  data: CryptoCandle[],
  interval: number,
  maxCandles: number = 1000
): CryptoCandle[] => {
  if (data.length <= maxCandles) return data;

  // Calculate how many candles to keep based on interval
  const candlesToKeep = Math.min(maxCandles, getMaxCandlesForInterval(interval));
  
  return data.slice(-candlesToKeep);
};

const getMaxCandlesForInterval = (intervalMinutes: number): number => {
  // Show more data for longer intervals
  if (intervalMinutes >= 1440) return 365; // Daily - 1 year
  if (intervalMinutes >= 240) return 180;  // 4h+ - 30 days  
  if (intervalMinutes >= 60) return 168;   // 1h+ - 1 week
  if (intervalMinutes >= 15) return 96;   // 15m+ - 24 hours
  return 1440; // < 15m - 24 hours of data
};

/**
 * Check if data needs refreshing based on time
 */
export const shouldRefreshData = (
  lastUpdateTime: number,
  currentInterval: number,
  thresholdMinutes: number = 5
): boolean => {
  const now = Date.now();
  const thresholdMs = thresholdMinutes * 60 * 1000;
  const intervalMs = currentInterval * 60 * 1000;
  
  // For shorter intervals, be more aggressive about refreshing
  if (currentInterval < 60) {
    return (now - lastUpdateTime) > Math.min(thresholdMs, intervalMs * 2);
  }
  
  return (now - lastUpdateTime) > thresholdMs;
};

/**
 * Convert OHLC data from WebSocket format to chart format
 */
export const formatWebSocketOHLC = (ohlcData: any): CryptoCandle => {
  return {
    time: parseInt(ohlcData.time) * 1000, // Convert to milliseconds
    open: parseFloat(ohlcData.open),
    high: parseFloat(ohlcData.high),
    low: parseFloat(ohlcData.low),
    close: parseFloat(ohlcData.close),
    vwap: parseFloat(ohlcData.vwap),
    volume: Number(ohlcData.volume),
    trades: parseInt(ohlcData.count || 0)
  };
};

/**
 * Validate and sanitize chart data
 */
export const validateChartData = (data: CryptoCandle[]): CryptoCandle[] => {
  return data.filter(candle => {
    return (
      candle &&
      typeof candle.time === 'number' &&
      typeof candle.open === 'number' &&
      typeof candle.high === 'number' &&
      typeof candle.low === 'number' &&
      typeof candle.close === 'number' &&
      candle.high >= candle.low &&
      candle.open > 0 &&
      candle.close > 0 &&
      candle.volume >= 0
    );
  }).sort((a, b) => a.time - b.time);
};