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
  private reconnectInterval = 2000; // 2 seconds base
  private isManuallyDisconnected = false;
  private pingInterval: NodeJS.Timeout | null = null;
  private connectionTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastHeartbeat = 0;
  private lastMessageTime = 0;
  private messageRate = 0;
  private messageCount = 0;
  private lastRateReset = 0;
  private connectionPromise: Promise<void> | null = null;
  private pendingSubscriptions: Array<{type: string, pairs: string[], options?: any}> = [];
  private isRateLimited = false;
  private rateLimitReset = 0;

  private readonly WS_URL = 'wss://ws.kraken.com';
  private readonly CONNECTION_TIMEOUT = 10000; // 10 seconds
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
  private readonly MAX_MESSAGE_RATE = 50; // messages per second (more conservative)
  private readonly BACKOFF_MULTIPLIER = 1.3;
  private readonly MAX_BACKOFF = 30000; // 30 seconds max backoff
  private readonly RATE_LIMIT_THRESHOLD = 40; // Start rate limiting at 40 msg/sec
  private readonly RATE_LIMIT_COOLDOWN = 5000; // 5 seconds cooldown

  constructor(callbacks?: CryptoWebSocketCallbacks) {
    this.callbacks = callbacks || {};
    
    // Add default error handler if none provided
    if (!this.callbacks.onError) {
      this.callbacks.onError = (error: Error) => {
        console.error('WebSocket error:', error);
        // Attempt to reconnect automatically
        this.handleConnectionError(error);
      };
    }
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected');
      return;
    }

    // If there's already a connection attempt in progress, wait for it
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.isManuallyDisconnected = false;
    console.log(`Connecting to Kraken WebSocket at ${this.WS_URL}...`);
    
    // Clear any existing timeouts
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
    }
    
    this.connectionPromise = new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.WS_URL);
        
        // Set connection timeout
        this.connectionTimeout = setTimeout(() => {
          if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
            console.error('WebSocket connection timeout');
            this.ws.close();
            this.handleConnectionError(new Error('Connection timeout'));
            reject(new Error('Connection timeout'));
          }
        }, this.CONNECTION_TIMEOUT);
        
        // Store resolve/reject for connection completion
        (this.ws as any)._resolve = resolve;
        (this.ws as any)._reject = reject;
        
      } catch (error) {
        console.error('Failed to create WebSocket:', error);
        this.handleConnectionError(error as Error);
        reject(error);
      }
    });

    try {
      await this.connectionPromise;
    } finally {
      this.connectionPromise = null;
    }
  }

    this.ws.onopen = () => {
      console.log('✅ Kraken WebSocket connected successfully');
      this.resetConnectionState();
      
      // Clear connection timeout
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
      
      // Resolve connection promise
      if ((this.ws as any)._resolve) {
        (this.ws as any)._resolve();
        delete (this.ws as any)._resolve;
      }
      
      this.callbacks.onConnect?.();
      
      // Start ping interval to keep connection alive
      this.startPingInterval();
      
      // Start heartbeat monitoring
      this.startHeartbeatMonitoring();
      
      // Resubscribe to any previous subscriptions with delay to avoid overwhelming
      setTimeout(() => {
        this.resubscribe();
        this.processPendingSubscriptions();
      }, 1000);
    };

    this.ws.onmessage = (event) => {
      try {
        // Update message tracking
        this.lastMessageTime = Date.now();
        this.updateMessageRate();
        
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
        this.callbacks.onError?.(error as Error);
      }
    };

    this.ws.onclose = (event) => {
      console.log(`❌ Kraken WebSocket disconnected: Code ${event.code}, Reason: ${event.reason || 'Unknown'}`);
      this.stopPingInterval();
      this.callbacks.onDisconnect?.();
      
      // Log specific close codes for debugging
      if (event.code === 1006) {
        console.error('WebSocket connection was closed abnormally');
      } else if (event.code === 1000) {
        console.log('WebSocket closed normally');
      }
      
      if (!this.isManuallyDisconnected && this.reconnectAttempts < this.maxReconnectAttempts) {
        console.log('🔄 Will attempt to reconnect...');
        this.reconnect();
      } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('❌ Max reconnection attempts reached');
      }
    };

    this.ws.onerror = (event) => {
      console.error('❌ Kraken WebSocket error:', event);
      const error = new Error(`WebSocket connection error: ${event instanceof ErrorEvent ? event.message : 'Unknown error'}`);
      
      // Reject connection promise if it exists
      if ((this.ws as any)._reject) {
        (this.ws as any)._reject(error);
        delete (this.ws as any)._reject;
      }
      
      this.handleConnectionError(error);
    };
  }

  disconnect(): void {
    this.isManuallyDisconnected = true;
    
    // Clear all timeouts and intervals
    this.stopPingInterval();
    this.stopHeartbeatMonitoring();
    
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.subscriptions.clear();
  }

  private handleConnectionError(error: Error): void {
    console.error('WebSocket connection error:', error);
    this.callbacks.onError?.(error);
  }

  private startHeartbeatMonitoring(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastHeartbeat = now - this.lastHeartbeat;
      const timeSinceLastMessage = now - this.lastMessageTime;
      
      // Check for heartbeat timeout
      if (timeSinceLastHeartbeat > this.HEARTBEAT_INTERVAL * 2) {
        console.warn('WebSocket heartbeat timeout, reconnecting...');
        this.reconnect();
      }
      
      // Check for message timeout (more aggressive check)
      if (timeSinceLastMessage > this.HEARTBEAT_INTERVAL * 3) {
        console.warn('WebSocket message timeout, reconnecting...');
        this.reconnect();
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  private stopHeartbeatMonitoring(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private updateMessageRate(): void {
    const now = Date.now();
    this.messageCount++;
    
    // Reset rate counter every second
    if (now - this.lastRateReset >= 1000) {
      this.messageRate = this.messageCount;
      this.messageCount = 0;
      this.lastRateReset = now;
      
      // Implement rate limiting
      if (this.messageRate > this.RATE_LIMIT_THRESHOLD) {
        if (!this.isRateLimited) {
          this.isRateLimited = true;
          this.rateLimitReset = now + this.RATE_LIMIT_COOLDOWN;
          console.warn(`Rate limiting activated: ${this.messageRate} messages/sec`);
        }
      } else if (this.isRateLimited && now > this.rateLimitReset) {
        this.isRateLimited = false;
        console.log('Rate limiting deactivated');
      }
      
      // Warn if message rate is too high
      if (this.messageRate > this.MAX_MESSAGE_RATE) {
        console.warn(`High message rate detected: ${this.messageRate} messages/sec`);
      }
    }
  }

  private reconnect(): void {
    this.reconnectAttempts++;
    
    // Calculate exponential backoff with jitter
    const baseDelay = this.reconnectInterval * Math.pow(this.BACKOFF_MULTIPLIER, this.reconnectAttempts - 1);
    const jitter = Math.random() * 1000; // Add up to 1 second of jitter
    const backoffTime = Math.min(baseDelay + jitter, this.MAX_BACKOFF);
    
    console.log(`Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${Math.round(backoffTime)}ms`);
    
    // Implement circuit breaker pattern
    if (this.reconnectAttempts > this.maxReconnectAttempts / 2) {
      console.warn(`High reconnection attempts detected. Current backoff: ${Math.round(backoffTime)}ms`);
    }
    
    setTimeout(() => {
      if (!this.isManuallyDisconnected) {
        this.connect();
      }
    }, backoffTime);
  }

  private resetConnectionState(): void {
    this.reconnectAttempts = 0;
    this.lastHeartbeat = Date.now();
    this.lastMessageTime = Date.now();
    this.messageRate = 0;
    this.messageCount = 0;
    this.lastRateReset = Date.now();
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
    // Update heartbeat timestamp
    this.lastHeartbeat = Date.now();

    // Handle system status messages
    if (data.event === 'systemStatus') {
      console.log(`🔍 Kraken system status: ${data.status} - ${data.version || 'Unknown version'}`);
      return;
    }

    // Handle subscription status
    if (data.event === 'subscriptionStatus') {
      const status = data.status === 'subscribed' ? '✅' : data.status === 'error' ? '❌' : '⏳';
      console.log(`${status} Subscription ${data.status}: ${data.pair} (${data.subscription?.name || 'Unknown'})`);
      if (data.status === 'error') {
        console.error('Subscription error:', data.errorMessage || data.reqid);
      }
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

    // Handle channel data with rate limiting
    if (Array.isArray(data) && data.length >= 4) {
      const channelID = data[0];
      const messageData = data[1];
      const channelName = data[2];
      const symbol = data[3];

      // Implement message rate limiting for high-frequency channels
      if (channelName === 'trade' && this.messageRate > this.MAX_MESSAGE_RATE * 0.8) {
        // Skip some trade updates if rate is too high
        if (Math.random() > 0.3) return; // Only process 30% of trades when rate is high
      }

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
          // Limit order book updates to prevent overwhelming
          if (this.messageRate < this.MAX_MESSAGE_RATE * 0.6) {
            this.handleBookUpdate(symbol, messageData);
          }
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

  // Subscribe to ticker updates with conservative limits
  async subscribeTicker(pairs: string[]): Promise<void> {
    // Ensure connection before subscribing
    if (!this.isConnected()) {
      try {
        await this.connect();
      } catch (error) {
        console.error('Failed to connect for ticker subscription:', error);
        this.pendingSubscriptions.push({ type: 'ticker', pairs });
        return;
      }
    }

    // Conservative limit to prevent connection issues
    const limitedPairs = pairs.slice(0, 3);
    
    if (limitedPairs.length !== pairs.length) {
      console.warn(`Limited ticker subscription from ${pairs.length} to ${limitedPairs.length} pairs to avoid disconnects`);
    }
    
    const subscription = JSON.stringify({
      event: 'subscribe',
      pair: limitedPairs,
      subscription: { name: 'ticker' }
    });

    this.subscriptions.add(subscription);
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Add delay before sending subscription to avoid overwhelming
      setTimeout(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws?.send(subscription);
        }
      }, 500);
    }
  }

  // Subscribe to trade updates with limits
  subscribeTrades(pairs: string[]): void {
    // Limit trade pairs to prevent flooding
    const limitedPairs = pairs.slice(0, 3);
    
    if (limitedPairs.length !== pairs.length) {
      console.warn(`Limited trade subscription from ${pairs.length} to ${limitedPairs.length} pairs`);
    }
    
    const subscription = JSON.stringify({
      event: 'subscribe',
      pair: limitedPairs,
      subscription: { name: 'trade' }
    });

    this.subscriptions.add(subscription);
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      setTimeout(() => {
        this.ws?.send(subscription);
      }, 1000);
    }
  }

  // Subscribe to OHLC updates with conservative approach
  async subscribeOHLC(pairs: string[], interval: number = 60): Promise<void> {
    // Ensure connection before subscribing
    if (!this.isConnected()) {
      try {
        await this.connect();
      } catch (error) {
        console.error('Failed to connect for OHLC subscription:', error);
        this.pendingSubscriptions.push({ type: 'ohlc', pairs, options: { interval } });
        return;
      }
    }

    // Limit OHLC pairs and be conservative
    const limitedPairs = pairs.slice(0, 1);
    
    if (limitedPairs.length !== pairs.length) {
      console.warn(`Limited OHLC subscription from ${pairs.length} to ${limitedPairs.length} pairs`);
    }
    
    const subscription = JSON.stringify({
      event: 'subscribe',
      pair: limitedPairs,
      subscription: { 
        name: 'ohlc',
        interval: interval
      }
    });

    this.subscriptions.add(subscription);
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      setTimeout(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws?.send(subscription);
        }
      }, 1500);
    }
  }

  // Subscribe to order book updates with very conservative limits
  subscribeOrderBook(pairs: string[], depth: number = 10): void {
    // Very conservative limits for order book
    const limitedPairs = pairs.slice(0, 1);
    const limitedDepth = Math.min(depth, 10); // Max depth 10
    
    if (limitedPairs.length !== pairs.length) {
      console.warn(`Limited order book subscription from ${pairs.length} to ${limitedPairs.length} pair`);
    }
    
    const subscription = JSON.stringify({
      event: 'subscribe',
      pair: limitedPairs,
      subscription: { 
        name: 'book',
        depth: limitedDepth
      }
    });

    this.subscriptions.add(subscription);
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      setTimeout(() => {
        this.ws?.send(subscription);
      }, 2000);
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

  // Process pending subscriptions after connection
  private processPendingSubscriptions(): void {
    if (!this.pendingSubscriptions.length) return;

    console.log(`Processing ${this.pendingSubscriptions.length} pending subscriptions`);
    
    const pending = [...this.pendingSubscriptions];
    this.pendingSubscriptions = [];

    // Process subscriptions with delays to avoid overwhelming
    pending.forEach((sub, index) => {
      setTimeout(() => {
        switch (sub.type) {
          case 'ticker':
            this.subscribeTicker(sub.pairs);
            break;
          case 'ohlc':
            this.subscribeOHLC(sub.pairs, sub.options?.interval);
            break;
          case 'trade':
            this.subscribeTrades(sub.pairs);
            break;
        }
      }, index * 1000); // 1 second delay between each subscription
    });
  }

  // Check if currently rate limited
  isRateLimited(): boolean {
    if (this.isRateLimited && Date.now() > this.rateLimitReset) {
      this.isRateLimited = false;
    }
    return this.isRateLimited;
  }

  // Get current message rate
  getMessageRate(): number {
    return this.messageRate;
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