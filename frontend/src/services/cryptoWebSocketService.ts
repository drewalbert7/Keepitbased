// Kraken WebSocket Service for real-time crypto data
export interface KrakenTicker {
  symbol: string;
  ask: [string, string, string]; // [price, wholeLot, lotVolume]
  bid: [string, string, string]; // [price, wholeLot, lotVolume]
  close: [string, string]; // [price, lotVolume]
  volume: [string, string]; // [today, 24h]
  vwap: [string, string]; // [today, 24h]
  trades: [number, number]; // [today, 24h]
  low: [string, string]; // [today, 24h]
  high: [string, string]; // [today, 24h]
  open: [string, string]; // [today, 24h]
}

export interface KrakenTrade {
  symbol: string;
  trades: Array<[string, string, string, string, string]>; // [price, volume, time, side, orderType]
}

export interface KrakenOHLC {
  symbol: string;
  ohlc: [string, string, string, string, string, string, string, number, string]; // [time, etime, open, high, low, close, vwap, volume, count]
}

export interface KrakenBook {
  symbol: string;
  asks?: Array<[string, string, string]>; // [price, volume, timestamp]
  bids?: Array<[string, string, string]>; // [price, volume, timestamp]
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
  private ws: WebSocket | null = null;
  private callbacks: CryptoWebSocketCallbacks = {};
  private subscriptions: Set<string> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectInterval = 5000; // 5 seconds
  private isManuallyDisconnected = false;
  private pingInterval: NodeJS.Timeout | null = null;

  private readonly WS_URL = 'wss://ws.kraken.com';

  constructor(callbacks?: CryptoWebSocketCallbacks) {
    this.callbacks = callbacks || {};
  }

  connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected');
      return;
    }

    this.isManuallyDisconnected = false;
    this.ws = new WebSocket(this.WS_URL);

    this.ws.onopen = () => {
      console.log('Kraken WebSocket connected');
      this.reconnectAttempts = 0;
      this.callbacks.onConnect?.();
      
      // Start ping interval to keep connection alive
      this.startPingInterval();
      
      // Resubscribe to any previous subscriptions
      this.resubscribe();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
        this.callbacks.onError?.(error as Error);
      }
    };

    this.ws.onclose = (event) => {
      console.log('Kraken WebSocket disconnected:', event.code, event.reason);
      this.stopPingInterval();
      this.callbacks.onDisconnect?.();
      
      if (!this.isManuallyDisconnected && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnect();
      }
    };

    this.ws.onerror = (event) => {
      console.error('Kraken WebSocket error:', event);
      const error = new Error('WebSocket connection error');
      this.callbacks.onError?.(error);
    };
  }

  disconnect(): void {
    this.isManuallyDisconnected = true;
    this.stopPingInterval();
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.subscriptions.clear();
  }

  private reconnect(): void {
    this.reconnectAttempts++;
    console.log(`Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connect();
    }, this.reconnectInterval);
  }

  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          event: 'ping',
          reqid: Date.now()
        }));
      }
    }, 30000); // Ping every 30 seconds
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private resubscribe(): void {
    Array.from(this.subscriptions).forEach((subscription) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(subscription);
      }
    });
  }

  private handleMessage(data: any): void {
    // Handle system status messages
    if (data.event === 'systemStatus') {
      console.log('Kraken system status:', data);
      return;
    }

    // Handle subscription status
    if (data.event === 'subscriptionStatus') {
      console.log('Subscription status:', data);
      return;
    }

    // Handle pong
    if (data.event === 'pong') {
      return;
    }

    // Handle heartbeat
    if (data.event === 'heartbeat') {
      return;
    }

    // Handle channel data
    if (Array.isArray(data) && data.length >= 4) {
      const channelID = data[0];
      const messageData = data[1];
      const channelName = data[2];
      const symbol = data[3];

      switch (channelName) {
        case 'ticker':
          this.handleTickerUpdate(symbol, messageData);
          break;
        case 'trade':
          this.handleTradeUpdate(symbol, messageData);
          break;
        case 'ohlc-1':
        case 'ohlc-5':
        case 'ohlc-15':
        case 'ohlc-30':
        case 'ohlc-60':
        case 'ohlc-240':
        case 'ohlc-1440':
        case 'ohlc-10080':
        case 'ohlc-21600':
          this.handleOHLCUpdate(symbol, messageData);
          break;
        case 'book-10':
        case 'book-25':
        case 'book-100':
        case 'book-500':
        case 'book-1000':
          this.handleBookUpdate(symbol, messageData);
          break;
      }
    }
  }

  private handleTickerUpdate(symbol: string, data: any): void {
    const ticker: KrakenTicker = {
      symbol,
      ask: data.a,
      bid: data.b,
      close: data.c,
      volume: data.v,
      vwap: data.p,
      trades: data.t,
      low: data.l,
      high: data.h,
      open: data.o
    };
    
    this.callbacks.onTicker?.(ticker);
  }

  private handleTradeUpdate(symbol: string, data: any): void {
    const trade: KrakenTrade = {
      symbol,
      trades: data
    };
    
    this.callbacks.onTrade?.(trade);
  }

  private handleOHLCUpdate(symbol: string, data: any): void {
    const ohlc: KrakenOHLC = {
      symbol,
      ohlc: data
    };
    
    this.callbacks.onOHLC?.(ohlc);
  }

  private handleBookUpdate(symbol: string, data: any): void {
    const book: KrakenBook = {
      symbol,
      asks: data.as || data.a,
      bids: data.bs || data.b
    };
    
    this.callbacks.onBook?.(book);
  }

  // Subscribe to ticker updates
  subscribeTicker(pairs: string[]): void {
    const subscription = JSON.stringify({
      event: 'subscribe',
      pair: pairs,
      subscription: { name: 'ticker' }
    });

    this.subscriptions.add(subscription);
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(subscription);
    }
  }

  // Subscribe to trade updates
  subscribeTrades(pairs: string[]): void {
    const subscription = JSON.stringify({
      event: 'subscribe',
      pair: pairs,
      subscription: { name: 'trade' }
    });

    this.subscriptions.add(subscription);
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(subscription);
    }
  }

  // Subscribe to OHLC updates
  subscribeOHLC(pairs: string[], interval: number = 60): void {
    const subscription = JSON.stringify({
      event: 'subscribe',
      pair: pairs,
      subscription: { 
        name: 'ohlc',
        interval: interval
      }
    });

    this.subscriptions.add(subscription);
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(subscription);
    }
  }

  // Subscribe to order book updates
  subscribeOrderBook(pairs: string[], depth: number = 10): void {
    const subscription = JSON.stringify({
      event: 'subscribe',
      pair: pairs,
      subscription: { 
        name: 'book',
        depth: depth
      }
    });

    this.subscriptions.add(subscription);
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(subscription);
    }
  }

  // Unsubscribe from a channel
  unsubscribe(pairs: string[], channelName: string, options?: any): void {
    const subscription = JSON.stringify({
      event: 'unsubscribe',
      pair: pairs,
      subscription: { 
        name: channelName,
        ...options
      }
    });

    // Remove from subscriptions
    this.subscriptions.forEach((sub) => {
      try {
        const parsed = JSON.parse(sub);
        if (parsed.subscription?.name === channelName && 
            JSON.stringify(parsed.pair?.sort()) === JSON.stringify(pairs?.sort())) {
          this.subscriptions.delete(sub);
        }
      } catch (error) {
        // Ignore parsing errors
      }
    });
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(subscription);
    }
  }

  // Get connection status
  getConnectionStatus(): 'connecting' | 'open' | 'closing' | 'closed' {
    if (!this.ws) return 'closed';
    
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting';
      case WebSocket.OPEN:
        return 'open';
      case WebSocket.CLOSING:
        return 'closing';
      case WebSocket.CLOSED:
        return 'closed';
      default:
        return 'closed';
    }
  }

  // Check if connected
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Export singleton instance
let cryptoWsInstance: CryptoWebSocketService | null = null;

export const getCryptoWebSocketService = (callbacks?: CryptoWebSocketCallbacks): CryptoWebSocketService => {
  if (!cryptoWsInstance) {
    cryptoWsInstance = new CryptoWebSocketService(callbacks);
  } else if (callbacks) {
    // Update callbacks if provided
    cryptoWsInstance['callbacks'] = { ...cryptoWsInstance['callbacks'], ...callbacks };
  }
  
  return cryptoWsInstance;
};

export default CryptoWebSocketService;