// Deprecated direct exchange WebSocket service.
// We keep this compatibility wrapper so existing hooks compile,
// but live updates are sourced via backend APIs/polling.

export interface KrakenTicker {
  symbol: string;
  ask: [string, string, string];
  bid: [string, string, string];
  close: [string, string];
  volume: [string, string];
  vwap: [string, string];
  trades: [number, number];
  low: [string, string];
  high: [string, string];
  open: [string, string];
}

export interface KrakenTrade {
  symbol: string;
  trades: Array<[string, string, string, string, string]>;
}

export interface KrakenOHLC {
  symbol: string;
  ohlc: [string, string, string, string, string, string, string, number, string];
}

export interface KrakenBook {
  symbol: string;
  asks?: Array<[string, string, string]>;
  bids?: Array<[string, string, string]>;
}

export interface CryptoWebSocketCallbacks {
  onTicker?: (ticker: KrakenTicker) => void;
  onTrade?: (trade: KrakenTrade) => void;
  onOHLC?: (ohlc: KrakenOHLC) => void;
  onBook?: (book: KrakenBook) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

export class CryptoWebSocketService {
  public callbacks: CryptoWebSocketCallbacks = {};
  private connected = false;

  constructor(callbacks?: CryptoWebSocketCallbacks) {
    this.callbacks = callbacks || {};
  }

  async connect(): Promise<void> {
    // Keep compatibility with callers that expect async connect.
    this.connected = true;
    this.callbacks.onConnect?.();
  }

  disconnect(): void {
    this.connected = false;
    this.callbacks.onDisconnect?.();
  }

  isConnected(): boolean {
    return this.connected;
  }

  isRateLimited(): boolean {
    return false;
  }

  getConnectionStatus(): 'connecting' | 'open' | 'closing' | 'closed' {
    return this.connected ? 'open' : 'closed';
  }

  async subscribeTicker(_pairs: string[]): Promise<void> {
    return;
  }

  async subscribeTrades(_pairs: string[]): Promise<void> {
    return;
  }

  async subscribeOHLC(_pairs: string[], _interval: number = 60): Promise<void> {
    return;
  }

  subscribeOrderBook(_pairs: string[], _depth: number = 10): void {
    return;
  }

  unsubscribe(_pairs: string[], _channelName: string, _options?: any): void {
    return;
  }
}

let cryptoWsInstance: CryptoWebSocketService | null = null;

export const getCryptoWebSocketService = (callbacks?: CryptoWebSocketCallbacks): CryptoWebSocketService => {
  if (!cryptoWsInstance) {
    cryptoWsInstance = new CryptoWebSocketService(callbacks);
  } else if (callbacks) {
    cryptoWsInstance.callbacks = { ...cryptoWsInstance.callbacks, ...callbacks };
  }

  return cryptoWsInstance;
};

export default CryptoWebSocketService;
