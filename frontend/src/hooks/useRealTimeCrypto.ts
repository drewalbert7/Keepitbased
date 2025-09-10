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
    enableOHLC = false,
    ohlcInterval = '1h'
  } = options;

  const [state, setState] = useState<RealTimeCryptoState>({
    tickers: {},
    trades: {},
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

  // Initialize WebSocket connection
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
    if (!wsService.isConnected()) {
      setState(prev => ({ ...prev, connectionStatus: 'connecting' }));
      wsService.connect();
    }

    return () => {
      // Don't disconnect on unmount as other components might be using it
      // wsService.disconnect();
    };
  }, [handleTickerUpdate, handleTradeUpdate, handleOHLCUpdate, handleConnect, handleDisconnect, handleError]);

  // Subscribe/unsubscribe to pairs
  useEffect(() => {
    if (!pairs.length) return;

    const wsService = wsServiceRef.current;
    const previousPairs = previousPairsRef.current;

    // Wait for connection
    const waitForConnection = () => {
      if (!wsService.isConnected()) {
        setTimeout(waitForConnection, 100);
        return;
      }

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

      // Subscribe to new pairs
      const newPairs = pairs.filter(pair => !previousPairs.includes(pair));
      if (newPairs.length > 0 || pairsToUnsubscribe.length > 0) {
        const pairsToSubscribe = newPairs.length > 0 ? newPairs : pairs;
        
        if (enableTicker) {
          wsService.subscribeTicker(pairsToSubscribe);
        }
        if (enableTrades) {
          wsService.subscribeTrades(pairsToSubscribe);
        }
        if (enableOHLC) {
          wsService.subscribeOHLC(pairsToSubscribe, KRAKEN_INTERVALS[ohlcInterval]);
        }
      }

      previousPairsRef.current = [...pairs];
    };

    waitForConnection();
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

  // Methods to control subscriptions
  const subscribeTicker = useCallback((pairsToSubscribe: string[]) => {
    wsServiceRef.current.subscribeTicker(pairsToSubscribe);
  }, []);

  const subscribeTrades = useCallback((pairsToSubscribe: string[]) => {
    wsServiceRef.current.subscribeTrades(pairsToSubscribe);
  }, []);

  const subscribeOHLC = useCallback((pairsToSubscribe: string[], interval?: number) => {
    wsServiceRef.current.subscribeOHLC(pairsToSubscribe, interval);
  }, []);

  const unsubscribe = useCallback((pairsToUnsubscribe: string[], channelName: string, options?: any) => {
    wsServiceRef.current.unsubscribe(pairsToUnsubscribe, channelName, options);
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