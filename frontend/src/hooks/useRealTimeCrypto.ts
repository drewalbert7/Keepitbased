import { useState, useEffect, useRef, useCallback } from 'react';
import { getCryptoWebSocketService, KrakenTicker, KrakenTrade, KrakenOHLC } from '../services/cryptoWebSocketService';
import { CryptoTicker, KRAKEN_INTERVALS } from '../services/cryptoService';

interface RealTimeCryptoOptions {
  pairs: string[];
  onTickerUpdate?: (ticker: CryptoTicker) => void;
  onTradeUpdate?: (trade: any) => void;
  onOHLCUpdate?: (ohlc: any) => void;
  enableTicker?: boolean;
  enableTrades?: boolean;
  enableOHLC?: boolean;
  ohlcInterval?: keyof typeof KRAKEN_INTERVALS;
}

interface RealTimeCryptoState {
  tickers: Record<string, CryptoTicker>;
  trades: Record<string, any[]>;
  ohlcData: Record<string, any>;
  connectionStatus: 'connecting' | 'open' | 'closing' | 'closed';
  isConnected: boolean;
  error: string | null;
}

export const useRealTimeCrypto = (options: RealTimeCryptoOptions) => {
  const {
    pairs,
    onTickerUpdate,
    onTradeUpdate,
    onOHLCUpdate,
    enableTicker = true,
    enableTrades = false,
    enableOHLC = true, // Changed default to true
    ohlcInterval = '1h'
  } = options;

  const [state, setState] = useState<RealTimeCryptoState>({
    tickers: {},
    trades: {},
    ohlcData: {},
    connectionStatus: 'closed',
    isConnected: false,
    error: null
  });

  const wsServiceRef = useRef(getCryptoWebSocketService());
  const previousPairsRef = useRef<string[]>([]);

  // Handle ticker updates
  const handleTickerUpdate = useCallback((krakenTicker: KrakenTicker) => {
    const ticker: CryptoTicker = {
      symbol: krakenTicker.symbol,
      price: parseFloat(krakenTicker.close[0]),
      open: parseFloat(krakenTicker.open[0]),
      high: parseFloat(krakenTicker.high[0]),
      low: parseFloat(krakenTicker.low[0]),
      volume: parseFloat(krakenTicker.volume[0]),
      vwap: parseFloat(krakenTicker.vwap[0]),
      trades: krakenTicker.trades[0],
      bid: parseFloat(krakenTicker.bid[0]),
      ask: parseFloat(krakenTicker.ask[0]),
      spread: parseFloat(krakenTicker.ask[0]) - parseFloat(krakenTicker.bid[0]),
      change: parseFloat(krakenTicker.close[0]) - parseFloat(krakenTicker.open[0]),
      changePercent: ((parseFloat(krakenTicker.close[0]) - parseFloat(krakenTicker.open[0])) / parseFloat(krakenTicker.open[0])) * 100,
      timestamp: new Date().toISOString()
    };

    setState(prev => ({
      ...prev,
      tickers: {
        ...prev.tickers,
        [krakenTicker.symbol]: ticker
      }
    }));

    onTickerUpdate?.(ticker);
  }, [onTickerUpdate]);

  // Handle trade updates
  const handleTradeUpdate = useCallback((krakenTrade: KrakenTrade) => {
    const trades = krakenTrade.trades.map(trade => ({
      price: parseFloat(trade[0]),
      volume: parseFloat(trade[1]),
      time: parseFloat(trade[2]),
      side: trade[3] as 'b' | 's',
      type: trade[4] as 'm' | 'l'
    }));

    setState(prev => ({
      ...prev,
      trades: {
        ...prev.trades,
        [krakenTrade.symbol]: trades
      }
    }));

    onTradeUpdate?.(krakenTrade);
  }, [onTradeUpdate]);

  // Handle OHLC updates
  const handleOHLCUpdate = useCallback((krakenOHLC: KrakenOHLC) => {
    const ohlc = {
      symbol: krakenOHLC.symbol,
      time: parseInt(krakenOHLC.ohlc[0]),
      endTime: parseInt(krakenOHLC.ohlc[1]),
      open: parseFloat(krakenOHLC.ohlc[2]),
      high: parseFloat(krakenOHLC.ohlc[3]),
      low: parseFloat(krakenOHLC.ohlc[4]),
      close: parseFloat(krakenOHLC.ohlc[5]),
      vwap: parseFloat(krakenOHLC.ohlc[6]),
      volume: Number(krakenOHLC.ohlc[7]),
      count: krakenOHLC.ohlc[8]
    };

    // Store OHLC data in state for potential use
    setState(prev => ({
      ...prev,
      ohlcData: {
        ...prev.ohlcData,
        [krakenOHLC.symbol]: ohlc
      }
    }));

    onOHLCUpdate?.(ohlc);
  }, [onOHLCUpdate]);

  // Handle connection events
  const handleConnect = useCallback(() => {
    setState(prev => ({
      ...prev,
      connectionStatus: 'open',
      isConnected: true,
      error: null
    }));
  }, []);

  const handleDisconnect = useCallback(() => {
    setState(prev => ({
      ...prev,
      connectionStatus: 'closed',
      isConnected: false
    }));
  }, []);

  const handleError = useCallback((error: Error) => {
    setState(prev => ({
      ...prev,
      error: error.message
    }));
  }, []);

  // Initialize WebSocket connection with better error handling
  useEffect(() => {
    const wsService = wsServiceRef.current;

    // Update callbacks
    wsService['callbacks'] = {
      onTicker: handleTickerUpdate,
      onTrade: handleTradeUpdate,
      onOHLC: handleOHLCUpdate,
      onConnect: handleConnect,
      onDisconnect: handleDisconnect,
      onError: handleError
    };

    // Connect if not already connected
    const initializeConnection = async () => {
      if (!wsService.isConnected()) {
        setState(prev => ({ ...prev, connectionStatus: 'connecting' }));
        try {
          await wsService.connect();
        } catch (error) {
          console.error('Failed to connect to WebSocket:', error);
          setState(prev => ({ 
            ...prev, 
            connectionStatus: 'closed',
            error: 'Failed to connect to WebSocket'
          }));
        }
      }
    };

    initializeConnection();

    return () => {
      // Don't disconnect on unmount as other components might be using it
      // wsService.disconnect();
    };
  }, [handleTickerUpdate, handleTradeUpdate, handleOHLCUpdate, handleConnect, handleDisconnect, handleError]);

  // Subscribe/unsubscribe to pairs with better error handling
  useEffect(() => {
    if (!pairs.length) return;

    const wsService = wsServiceRef.current;
    const previousPairs = previousPairsRef.current;

    // Wait for connection with timeout
    const waitForConnection = async () => {
      let attempts = 0;
      const maxAttempts = 30; // 30 * 100ms = 3 seconds

      while (!wsService.isConnected() && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      if (!wsService.isConnected()) {
        console.warn('WebSocket not connected after timeout, skipping subscriptions');
        return;
      }

      // Check rate limiting before subscribing
      if (wsService.isRateLimited()) {
        console.warn('WebSocket is rate limited, delaying subscriptions');
        setTimeout(() => waitForConnection(), 5000);
        return;
      }

      try {
        // Unsubscribe from previous pairs that are no longer needed
        const pairsToUnsubscribe = previousPairs.filter(pair => !pairs.includes(pair));
        if (pairsToUnsubscribe.length > 0) {
          if (enableTicker) {
            wsService.unsubscribe(pairsToUnsubscribe, 'ticker');
          }
          if (enableTrades) {
            wsService.unsubscribe(pairsToUnsubscribe, 'trade');
          }
          if (enableOHLC) {
            wsService.unsubscribe(pairsToUnsubscribe, 'ohlc', { interval: KRAKEN_INTERVALS[ohlcInterval] });
          }
        }

        // Subscribe to new pairs with error handling
        const newPairs = pairs.filter(pair => !previousPairs.includes(pair));
        if (newPairs.length > 0 || pairsToUnsubscribe.length > 0) {
          const pairsToSubscribe = newPairs.length > 0 ? newPairs : pairs;
          
          // Add delays between subscriptions to avoid overwhelming
          if (enableTicker) {
            await wsService.subscribeTicker(pairsToSubscribe);
          }
          if (enableTrades) {
            await new Promise(resolve => setTimeout(resolve, 500));
            await wsService.subscribeTrades(pairsToSubscribe);
          }
          if (enableOHLC) {
            await new Promise(resolve => setTimeout(resolve, 500));
            await wsService.subscribeOHLC(pairsToSubscribe, KRAKEN_INTERVALS[ohlcInterval]);
          }
        }

        previousPairsRef.current = [...pairs];
      } catch (error) {
        console.error('Error managing WebSocket subscriptions:', error);
        setState(prev => ({ 
          ...prev, 
          error: 'Failed to manage WebSocket subscriptions'
        }));
      }
    };

    waitForConnection().catch(console.error);
  }, [pairs, enableTicker, enableTrades, enableOHLC, ohlcInterval]);

  // Update connection status
  useEffect(() => {
    const wsService = wsServiceRef.current;
    const updateStatus = () => {
      const status = wsService.getConnectionStatus();
      const connected = wsService.isConnected();
      
      setState(prev => ({
        ...prev,
        connectionStatus: status,
        isConnected: connected
      }));
    };

    const interval = setInterval(updateStatus, 1000);
    updateStatus(); // Initial update

    return () => clearInterval(interval);
  }, []);

  // Methods to control subscriptions with async support
  const subscribeTicker = useCallback(async (pairsToSubscribe: string[]) => {
    try {
      await wsServiceRef.current.subscribeTicker(pairsToSubscribe);
    } catch (error) {
      console.error('Failed to subscribe to ticker:', error);
      setState(prev => ({ ...prev, error: 'Failed to subscribe to ticker data' }));
    }
  }, []);

  const subscribeTrades = useCallback(async (pairsToSubscribe: string[]) => {
    try {
      await wsServiceRef.current.subscribeTrades(pairsToSubscribe);
    } catch (error) {
      console.error('Failed to subscribe to trades:', error);
      setState(prev => ({ ...prev, error: 'Failed to subscribe to trade data' }));
    }
  }, []);

  const subscribeOHLC = useCallback(async (pairsToSubscribe: string[], interval?: number) => {
    try {
      await wsServiceRef.current.subscribeOHLC(pairsToSubscribe, interval);
    } catch (error) {
      console.error('Failed to subscribe to OHLC:', error);
      setState(prev => ({ ...prev, error: 'Failed to subscribe to OHLC data' }));
    }
  }, []);

  const unsubscribe = useCallback((pairsToUnsubscribe: string[], channelName: string, options?: any) => {
    try {
      wsServiceRef.current.unsubscribe(pairsToUnsubscribe, channelName, options);
    } catch (error) {
      console.error('Failed to unsubscribe:', error);
    }
  }, []);

  return {
    ...state,
    subscribeTicker,
    subscribeTrades,
    subscribeOHLC,
    unsubscribe,
    getTicker: (pair: string) => state.tickers[pair],
    getTrades: (pair: string) => state.trades[pair] || [],
    disconnect: () => wsServiceRef.current.disconnect(),
    connect: () => wsServiceRef.current.connect()
  };
};