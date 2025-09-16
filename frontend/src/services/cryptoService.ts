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

// Kraken interval mapping (minutes) - TradingView compatible
export const KRAKEN_INTERVALS = {
  '1m': 1,
  '3m': 3,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '2h': 120,
  '4h': 240,
  '6h': 360,
  '8h': 480,
  '12h': 720,
  '1d': 1440,
  '3d': 4320,
  '1w': 10080,
  '2w': 20160,
  '1M': 43200 // Monthly (approximately 30 days)
} as const;

// Pair mapping for Kraken API (frontend display name → Kraken API name)
export const PAIR_MAPPING: Record<string, string> = {
  'BTC/USD': 'XXBTZUSD',
  'ETH/USD': 'XETHZUSD',
  'ADA/USD': 'ADAUSD',
  'SOL/USD': 'SOLUSD',
  'DOT/USD': 'DOTUSD',
  'LINK/USD': 'LINKUSD',
  'MATIC/USD': 'MATICUSD',
  'AVAX/USD': 'AVAXUSD',
  'ATOM/USD': 'ATOMUSD',
  'ALGO/USD': 'ALGOUSD',
  // Add reverse mapping for display
  'XXBTZUSD': 'BTC/USD',
  'XETHZUSD': 'ETH/USD'
};

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
  const limit = calculateCandleCount(interval);
  
  const response = await cryptoApi.get(`/ohlc/${pair}`, {
    params: { 
      interval: KRAKEN_INTERVALS[interval],
      limit,
      ...(since && { since })
    }
  });
  
  // Data is already in milliseconds from backend, no conversion needed
  const processedData = response.data.data.map((candle: CryptoCandle) => ({
    ...candle,
    time: candle.time // Use milliseconds directly
  }));
  
  return {
    ...response.data,
    data: processedData
  };
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

// Convert display pair name to Kraken API pair name
export const toKrakenPair = (displayPair: string): string => {
  return PAIR_MAPPING[displayPair] || displayPair;
};

// Convert Kraken API pair name to display name
export const formatPairName = (pair: string): string => {
  return PAIR_MAPPING[pair] || pair;
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

// Get interval label for display (TradingView style)
export const getIntervalLabel = (interval: keyof typeof KRAKEN_INTERVALS): string => {
  const labels: Record<keyof typeof KRAKEN_INTERVALS, string> = {
    '1m': '1',
    '3m': '3',
    '5m': '5',
    '15m': '15',
    '30m': '30',
    '1h': '60',
    '2h': '120',
    '4h': '240',
    '6h': '360',
    '8h': '480',
    '12h': '720',
    '1d': 'D',
    '3d': '3D',
    '1w': 'W',
    '2w': '2W',
    '1M': 'M'
  };
  
  return labels[interval];
};

// Calculate number of candles to fetch based on interval (TradingView style)
export const calculateCandleCount = (interval: keyof typeof KRAKEN_INTERVALS): number => {
  // Return appropriate number of candles for different intervals
  const counts: Record<keyof typeof KRAKEN_INTERVALS, number> = {
    '1m': 1440,  // 24 hours of 1-minute candles
    '3m': 480,   // 24 hours of 3-minute candles
    '5m': 288,   // 24 hours of 5-minute candles
    '15m': 96,   // 24 hours of 15-minute candles
    '30m': 48,   // 24 hours of 30-minute candles
    '1h': 168,   // 7 days of 1-hour candles
    '2h': 84,   // 7 days of 2-hour candles
    '4h': 42,   // 7 days of 4-hour candles
    '6h': 28,   // 7 days of 6-hour candles
    '8h': 21,   // 7 days of 8-hour candles
    '12h': 14,  // 7 days of 12-hour candles
    '1d': 365,  // 1 year of daily candles
    '3d': 122,  // 1 year of 3-day candles
    '1w': 52,   // 1 year of weekly candles
    '2w': 26,   // 1 year of bi-weekly candles
    '1M': 12    // 1 year of monthly candles
  };
  
  return counts[interval];
};

// Direct Kraken API proxy service for enhanced CORS handling
class KrakenProxyService {
  private api = axios.create({
    baseURL: `${API_BASE_URL}/crypto/proxy/0/public`,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Direct proxy to Kraken API endpoints
  async getTicker(pair: string = 'XBTUSD') {
    try {
      const response = await this.api.get('/Ticker', { params: { pair } });
      if (response.data.error && response.data.error.length > 0) {
        throw new Error(response.data.error.join(', '));
      }
      return response.data.result;
    } catch (error) {
      console.error('Kraken proxy ticker error:', error);
      throw error;
    }
  }

  async getOHLC(pair: string = 'XBTUSD', interval: number = 60, since?: number) {
    try {
      const params: any = { pair, interval };
      if (since) params.since = since;
      
      const response = await this.api.get('/OHLC', { params });
      if (response.data.error && response.data.error.length > 0) {
        throw new Error(response.data.error.join(', '));
      }
      
      const ohlcData = response.data.result[Object.keys(response.data.result)[0]] || [];
      
      // Convert timestamps from seconds to milliseconds
      return ohlcData.map((candle: any) => ({
        time: parseInt(candle[0]) * 1000,
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
        vwap: parseFloat(candle[5]),
        volume: parseFloat(candle[6]),
        trades: parseInt(candle[7])
      }));
    } catch (error) {
      console.error('Kraken proxy OHLC error:', error);
      throw error;
    }
  }

  async getTrades(pair: string, since?: string) {
    try {
      const params: any = { pair };
      if (since) params.since = since;
      
      const response = await this.api.get('/Trades', { params });
      if (response.data.error && response.data.error.length > 0) {
        throw new Error(response.data.error.join(', '));
      }
      
      const trades = response.data.result[Object.keys(response.data.result)[0]] || [];
      return trades.map((trade: any) => ({
        price: parseFloat(trade[0]),
        volume: parseFloat(trade[1]),
        time: parseFloat(trade[2]) * 1000,
        side: trade[3],
        type: trade[4],
        misc: trade[5]
      }));
    } catch (error) {
      console.error('Kraken proxy trades error:', error);
      throw error;
    }
  }
}

export const krakenProxyService = new KrakenProxyService();
export default cryptoApi;