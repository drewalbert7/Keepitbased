import axios from 'axios';

/** Must match auth API (`/api`) so production/nginx routes hit Express, not `/charts` 404 → SPA HTML. */
const API_BASE_URL = process.env.REACT_APP_API_URL || '/api';

export interface ChartData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HistoryCoverage {
  requestedFrom: string;
  requestedTo: string;
  barsReturned: number;
  oldestBar: string | null;
  newestBar: string | null;
  /** Set when the feed starts much later than requested (common with 24-month plan caps). */
  note?: string;
}

export interface HistoryResponse {
  symbol: string;
  data: ChartData[];
  period: string;
  interval: string;
  timestamp: string;
  sourceUsed?: string;
  partialData?: boolean;
  lastUpdated?: string;
  coverage?: HistoryCoverage;
}

export interface QuoteData {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  change: number;
  changePercent: number;
  marketCap: number;
  companyName: string;
  timestamp: string;
  sourceUsed?: 'snapshot' | 'agg_minute' | 'agg_day' | string;
  partialData?: boolean;
  lastUpdated?: string;
}

export interface StockInfo {
  symbol: string;
  companyName: string;
  sector: string;
  industry: string;
  marketCap: number;
  peRatio: number;
  dividendYield: number;
  beta: number;
  week52High: number;
  week52Low: number;
  avgVolume: number;
  description: string;
  timestamp: string;
}

export interface TechnicalData {
  symbol: string;
  data: {
    time: number;
    close: number;
    sma20: number | null;
    sma50: number | null;
    ema20: number | null;
    ema50: number | null;
    macd: number | null;
    signal: number | null;
    histogram: number | null;
    rsi: number | null;
  }[];
  timestamp: string;
}

export interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
}

export interface SearchResponse {
  results: SearchResult[];
}

// Create axios instance with default config - use chart proxy
const chartApi = axios.create({
  baseURL: `${API_BASE_URL}/charts`,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

const quoteCache = new Map<string, { value: QuoteData; expiresAt: number }>();
const quoteInflight = new Map<string, Promise<QuoteData>>();
const QUOTE_CACHE_TTL_MS = 2500;

// Add request interceptor for error handling
chartApi.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('Chart API Error:', error.response?.data || error.message);
    throw error;
  }
);

export const getStockHistory = async (
  symbol: string,
  period: string = '1y',
  interval: string = '1d'
): Promise<HistoryResponse> => {
  const response = await chartApi.get(`/history/${symbol}`, {
    params: { period, interval }
  });
  const payload = response.data as HistoryResponse;
  const normalizedData = (payload.data || [])
    .filter((row) =>
      Number.isFinite(row.time) &&
      Number.isFinite(row.open) &&
      Number.isFinite(row.high) &&
      Number.isFinite(row.low) &&
      Number.isFinite(row.close)
    )
    .map((row) => ({
      ...row,
      time: Math.floor(Number(row.time))
    }))
    .sort((a, b) => a.time - b.time);

  return {
    ...payload,
    data: normalizedData
  };
};

export const getStockQuote = async (symbol: string): Promise<QuoteData> => {
  const key = symbol.toUpperCase();
  const now = Date.now();

  const cached = quoteCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const inflight = quoteInflight.get(key);
  if (inflight) {
    return inflight;
  }

  const request = chartApi.get(`/quote/${key}`).then((response) => {
    const payload = response.data as QuoteData;
    quoteCache.set(key, {
      value: payload,
      expiresAt: Date.now() + QUOTE_CACHE_TTL_MS
    });
    return payload;
  }).finally(() => {
    quoteInflight.delete(key);
  });

  quoteInflight.set(key, request);
  return request;
};

export const getStockInfo = async (symbol: string): Promise<StockInfo> => {
  const response = await chartApi.get(`/info/${symbol}`);
  return response.data;
};

export const getTechnicalData = async (
  symbol: string,
  period: string = '6mo'
): Promise<TechnicalData> => {
  const response = await chartApi.get(`/technical/${symbol}`, {
    params: { period }
  });
  return response.data;
};

export const searchStocks = async (query: string): Promise<SearchResponse> => {
  const response = await chartApi.get('/search', {
    params: { q: query }
  });
  return response.data;
};

export const checkChartServiceHealth = async () => {
  const response = await chartApi.get('/health');
  return response.data;
};

// Utility function to format timestamp for charts (expects milliseconds)
export const formatTimestamp = (timestamp: number): string => {
  return new Date(timestamp).toLocaleDateString();
};

// Utility function to format currency
export const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
};

// Utility function to format large numbers
export const formatLargeNumber = (value: number): string => {
  if (value >= 1e12) {
    return `$${(value / 1e12).toFixed(2)}T`;
  } else if (value >= 1e9) {
    return `$${(value / 1e9).toFixed(2)}B`;
  } else if (value >= 1e6) {
    return `$${(value / 1e6).toFixed(2)}M`;
  } else if (value >= 1e3) {
    return `$${(value / 1e3).toFixed(2)}K`;
  }
  return `$${value.toFixed(2)}`;
};

export default chartApi;