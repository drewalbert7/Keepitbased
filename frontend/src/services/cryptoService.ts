import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export interface CryptoPair {
  symbol: string;
  wsname: string;
  base: string;
  quote: string;
  displayName: string;
  lotSize: number;
  priceDecimals: number;
}

export interface CryptoTicker {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  vwap: number;
  trades: number;
  change: number;
  changePercent: number;
  bid: number;
  ask: number;
  spread: number;
  timestamp: string;
}

export interface CryptoCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  vwap: number;
  volume: number;
  trades: number;
}

export interface CryptoOHLC {
  symbol: string;
  data: CryptoCandle[];
  interval: number;
  lastId: number;
  timestamp: string;
}

export interface CryptoTrade {
  price: number;
  volume: number;
  time: number;
  side: 'b' | 's'; // buy or sell
  type: 'm' | 'l'; // market or limit
  misc: string;
}

export interface CryptoTrades {
  symbol: string;
  trades: CryptoTrade[];
  lastId: string;
  timestamp: string;
}

export interface OrderBookEntry {
  price: number;
  volume: number;
  timestamp: number;
}

export interface CryptoOrderBook {
  symbol: string;
  asks: OrderBookEntry[];
  bids: OrderBookEntry[];
  timestamp: string;
}

export interface SpreadEntry {
  time: number;
  bid: number;
  ask: number;
}

export interface CryptoSpread {
  symbol: string;
  spreads: SpreadEntry[];
  lastId: string;
  timestamp: string;
}

// Kraken interval mapping (minutes)
export const KRAKEN_INTERVALS = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
  '1w': 10080,
  '15d': 21600
} as const;

export const POPULAR_CRYPTO_PAIRS = [
  'XXBTZUSD', // Bitcoin/USD
  'XETHZUSD', // Ethereum/USD
  'ADAUSD',   // Cardano/USD
  'SOLUSD',   // Solana/USD
  'DOTUSD',   // Polkadot/USD
  'LINKUSD',  // Chainlink/USD
  'MATICUSD', // Polygon/USD
  'AVAXUSD',  // Avalanche/USD
  'ATOMUSD',  // Cosmos/USD
  'ALGOUSD'   // Algorand/USD
];

// Create axios instance
const cryptoApi = axios.create({
  baseURL: `${API_BASE_URL}/crypto`,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add request interceptor for error handling
cryptoApi.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('Crypto API Error:', error.response?.data || error.message);
    throw error;
  }
);

// Get available trading pairs
export const getCryptoPairs = async (): Promise<{
  pairs: CryptoPair[];
  total: number;
  timestamp: string;
}> => {
  const response = await cryptoApi.get('/pairs');
  return response.data;
};

// Get current ticker/quote for a pair
export const getCryptoTicker = async (pair: string): Promise<CryptoTicker> => {
  const response = await cryptoApi.get(`/ticker/${pair}`);
  return response.data;
};

// Get OHLC data for a pair
export const getCryptoOHLC = async (
  pair: string,
  interval: keyof typeof KRAKEN_INTERVALS = '1h',
  since?: number
): Promise<CryptoOHLC> => {
  const response = await cryptoApi.get(`/ohlc/${pair}`, {
    params: { 
      interval: KRAKEN_INTERVALS[interval],
      ...(since && { since })
    }
  });
  return response.data;
};

// Get recent trades for a pair
export const getCryptoTrades = async (
  pair: string,
  since?: string
): Promise<CryptoTrades> => {
  const response = await cryptoApi.get(`/trades/${pair}`, {
    params: { ...(since && { since }) }
  });
  return response.data;
};

// Get order book for a pair
export const getCryptoOrderBook = async (
  pair: string,
  count: number = 100
): Promise<CryptoOrderBook> => {
  const response = await cryptoApi.get(`/orderbook/${pair}`, {
    params: { count }
  });
  return response.data;
};

// Get spread data for a pair
export const getCryptoSpread = async (
  pair: string,
  since?: string
): Promise<CryptoSpread> => {
  const response = await cryptoApi.get(`/spread/${pair}`, {
    params: { ...(since && { since }) }
  });
  return response.data;
};

// Check crypto service health
export const checkCryptoServiceHealth = async () => {
  const response = await cryptoApi.get('/health');
  return response.data;
};

// Utility functions

// Format crypto pair name for display
export const formatPairName = (pair: string): string => {
  // Convert Kraken pair names to readable format
  const conversions: Record<string, string> = {
    'XXBTZUSD': 'BTC/USD',
    'XETHZUSD': 'ETH/USD',
    'ADAUSD': 'ADA/USD',
    'SOLUSD': 'SOL/USD',
    'DOTUSD': 'DOT/USD',
    'LINKUSD': 'LINK/USD',
    'MATICUSD': 'MATIC/USD',
    'AVAXUSD': 'AVAX/USD',
    'ATOMUSD': 'ATOM/USD',
    'ALGOUSD': 'ALGO/USD'
  };
  
  return conversions[pair] || pair;
};

// Format crypto price with appropriate decimals
export const formatCryptoPrice = (price: number, decimals: number = 2): string => {
  if (price >= 1000) {
    return price.toFixed(2);
  } else if (price >= 1) {
    return price.toFixed(4);
  } else if (price >= 0.01) {
    return price.toFixed(6);
  } else {
    return price.toFixed(8);
  }
};

// Format crypto volume
export const formatCryptoVolume = (volume: number): string => {
  if (volume >= 1e9) {
    return `${(volume / 1e9).toFixed(2)}B`;
  } else if (volume >= 1e6) {
    return `${(volume / 1e6).toFixed(2)}M`;
  } else if (volume >= 1e3) {
    return `${(volume / 1e3).toFixed(2)}K`;
  }
  return volume.toFixed(2);
};

// Get interval label for display
export const getIntervalLabel = (interval: keyof typeof KRAKEN_INTERVALS): string => {
  const labels: Record<keyof typeof KRAKEN_INTERVALS, string> = {
    '1m': '1 Min',
    '5m': '5 Min',
    '15m': '15 Min',
    '30m': '30 Min',
    '1h': '1 Hour',
    '4h': '4 Hours',
    '1d': '1 Day',
    '1w': '1 Week',
    '15d': '15 Days'
  };
  
  return labels[interval];
};

// Calculate number of candles to fetch based on interval
export const calculateCandleCount = (interval: keyof typeof KRAKEN_INTERVALS): number => {
  // Return appropriate number of candles for different intervals
  const counts: Record<keyof typeof KRAKEN_INTERVALS, number> = {
    '1m': 200,   // ~3.3 hours
    '5m': 200,   // ~16.7 hours
    '15m': 200,  // ~50 hours
    '30m': 200,  // ~100 hours
    '1h': 200,   // ~8.3 days
    '4h': 200,   // ~33 days
    '1d': 365,   // ~1 year
    '1w': 104,   // ~2 years
    '15d': 52    // ~2 years
  };
  
  return counts[interval];
};

export default cryptoApi;