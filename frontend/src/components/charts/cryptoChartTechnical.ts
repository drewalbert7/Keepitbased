import type { LineData } from 'lightweight-charts';
import type { CryptoCandle } from '../../services/cryptoService';

export type CryptoTechnicalSeries = {
  sma20: LineData[];
  sma50: LineData[];
  ema12: LineData[];
  ema26: LineData[];
  ema20: LineData[];
  ema50: LineData[];
  macd: { signal: LineData[]; histogram: LineData[]; macd: LineData[] };
  rsi: LineData[];
  bollinger: { upper: LineData[]; middle: LineData[]; lower: LineData[] };
};

export type CryptoIndicatorSummary = {
  sma20: number | null;
  sma50: number | null;
  ema20: number | null;
  ema50: number | null;
  rsi: number | null;
  macd: number | null;
  signal: number | null;
  histogram: number | null;
};

function calculateEMAFromCloses(candles: CryptoCandle[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);
  if (!candles.length) return ema;

  let sum = 0;
  for (let i = 0; i < period && i < candles.length; i++) {
    sum += candles[i].close;
  }
  ema[period - 1] = sum / Math.min(period, candles.length);

  for (let i = period; i < candles.length; i++) {
    ema[i] = (candles[i].close - ema[i - 1]) * multiplier + ema[i - 1];
  }

  return ema;
}

function calculateEMAFromValues(values: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);
  if (values.length < period) return ema;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  ema[period - 1] = sum / period;

  for (let i = period; i < values.length; i++) {
    ema[i] = (values[i] - ema[i - 1]) * multiplier + ema[i - 1];
  }

  return ema;
}

function calculateRSIWindow(periodData: CryptoCandle[]): number {
  if (periodData.length < 2) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i < periodData.length; i++) {
    const change = periodData[i].close - periodData[i - 1].close;
    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  if (losses === 0) return 100;

  const avgGain = gains / (periodData.length - 1);
  const avgLoss = losses / (periodData.length - 1);
  const rs = avgGain / avgLoss;

  return 100 - 100 / (1 + rs);
}

export function computeCryptoTechnicalSeries(data: CryptoCandle[]): CryptoTechnicalSeries {
  if (!data.length) {
    return {
      sma20: [],
      sma50: [],
      ema12: [],
      ema26: [],
      ema20: [],
      ema50: [],
      macd: { signal: [], histogram: [], macd: [] },
      rsi: [],
      bollinger: { upper: [], middle: [], lower: [] },
    };
  }

  const sma20: LineData[] = [];
  const sma50: LineData[] = [];
  const ema12: LineData[] = [];
  const ema26: LineData[] = [];
  const ema20: LineData[] = [];
  const ema50: LineData[] = [];
  const macdSignal: LineData[] = [];
  const macdHistogram: LineData[] = [];
  const macdLine: LineData[] = [];
  const rsi: LineData[] = [];
  const bbUpper: LineData[] = [];
  const bbMiddle: LineData[] = [];
  const bbLower: LineData[] = [];

  for (let i = 19; i < data.length; i++) {
    const sum = data.slice(i - 19, i + 1).reduce((acc, candle) => acc + candle.close, 0);
    sma20.push({
      time: data[i].time as LineData['time'],
      value: sum / 20,
    });
  }

  for (let i = 49; i < data.length; i++) {
    const sum = data.slice(i - 49, i + 1).reduce((acc, candle) => acc + candle.close, 0);
    sma50.push({
      time: data[i].time as LineData['time'],
      value: sum / 50,
    });
  }

  const ema12Data = calculateEMAFromCloses(data, 12);
  ema12Data.forEach((value, index) => {
    if (index >= 11) {
      ema12.push({
        time: data[index].time as LineData['time'],
        value,
      });
    }
  });

  const ema26Data = calculateEMAFromCloses(data, 26);
  ema26Data.forEach((value, index) => {
    if (index >= 25) {
      ema26.push({
        time: data[index].time as LineData['time'],
        value,
      });
    }
  });

  const ema20Data = calculateEMAFromCloses(data, 20);
  ema20Data.forEach((value, index) => {
    if (index >= 19) {
      ema20.push({
        time: data[index].time as LineData['time'],
        value,
      });
    }
  });

  const ema50Data = calculateEMAFromCloses(data, 50);
  ema50Data.forEach((value, index) => {
    if (index >= 49) {
      ema50.push({
        time: data[index].time as LineData['time'],
        value,
      });
    }
  });

  const minEMAIndex = Math.max(25, 11);
  for (let i = minEMAIndex; i < data.length; i++) {
    const macdValue = ema12Data[i] - ema26Data[i];
    macdLine.push({
      time: data[i].time as LineData['time'],
      value: macdValue,
    });
  }

  const macdValues = macdLine.map((item) => item.value);
  const macdSignalData = calculateEMAFromValues(macdValues, 9);
  macdSignalData.forEach((value, index) => {
    if (index < 8 || !macdLine[index] || value === undefined || Number.isNaN(value)) return;
    macdSignal.push({
      time: macdLine[index].time,
      value,
    });
    macdHistogram.push({
      time: macdLine[index].time,
      value: macdLine[index].value - value,
    });
  });

  for (let i = 14; i < data.length; i++) {
    const rsiValue = calculateRSIWindow(data.slice(i - 14, i + 1));
    rsi.push({
      time: data[i].time as LineData['time'],
      value: rsiValue,
    });
  }

  for (let i = 19; i < data.length; i++) {
    const periodData = data.slice(i - 19, i + 1);
    const sum = periodData.reduce((acc, candle) => acc + candle.close, 0);
    const middle = sum / 20;

    const variance = periodData.reduce((acc, candle) => acc + Math.pow(candle.close - middle, 2), 0);
    const stdDev = Math.sqrt(variance / 20);

    const upper = middle + stdDev * 2;
    const lower = middle - stdDev * 2;

    bbUpper.push({
      time: data[i].time as LineData['time'],
      value: upper,
    });
    bbMiddle.push({
      time: data[i].time as LineData['time'],
      value: middle,
    });
    bbLower.push({
      time: data[i].time as LineData['time'],
      value: lower,
    });
  }

  return {
    sma20,
    sma50,
    ema12,
    ema26,
    ema20,
    ema50,
    macd: { signal: macdSignal, histogram: macdHistogram, macd: macdLine },
    rsi,
    bollinger: { upper: bbUpper, middle: bbMiddle, lower: bbLower },
  };
}

function lastSeriesValue(arr: LineData[]): number | null {
  if (!arr.length) return null;
  return arr[arr.length - 1].value;
}

export function summarizeCryptoIndicators(series: CryptoTechnicalSeries): CryptoIndicatorSummary | null {
  const hasAny =
    series.sma20.length ||
    series.sma50.length ||
    series.rsi.length ||
    series.macd.macd.length;

  if (!hasAny) return null;

  return {
    sma20: lastSeriesValue(series.sma20),
    sma50: lastSeriesValue(series.sma50),
    ema20: lastSeriesValue(series.ema20),
    ema50: lastSeriesValue(series.ema50),
    rsi: lastSeriesValue(series.rsi),
    macd: lastSeriesValue(series.macd.macd),
    signal: lastSeriesValue(series.macd.signal),
    histogram: lastSeriesValue(series.macd.histogram),
  };
}
