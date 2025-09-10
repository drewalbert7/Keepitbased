import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { QuoteData } from '../services/chartService';

interface PriceUpdate {
  symbol: string;
  price: number;
  change24h?: number;
  changePercent?: number;
  timestamp: number;
  type: string;
}

interface UseRealTimeQuotesProps {
  symbols: string[];
  onQuoteUpdate?: (quote: QuoteData) => void;
}

export const useRealTimeQuotes = ({ symbols, onQuoteUpdate }: UseRealTimeQuotesProps) => {
  const [quotes, setQuotes] = useState<Map<string, QuoteData>>(new Map());
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (symbols.length === 0) return;

    const socketUrl = process.env.REACT_APP_API_URL?.replace('/api', '') || 'http://localhost:3001';
    
    // Create socket connection
    const socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      upgrade: true,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to real-time quotes');
      setConnectionStatus('connected');
      
      // Subscribe to price updates for the specified symbols
      const symbolsWithType = symbols.map(symbol => `stock:${symbol}`);
      socket.emit('subscribe', symbolsWithType);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from real-time quotes');
      setConnectionStatus('disconnected');
    });

    socket.on('priceUpdate', (priceUpdates: PriceUpdate[]) => {
      console.log('Received price updates:', priceUpdates);
      
      setQuotes(prevQuotes => {
        const newQuotes = new Map(prevQuotes);
        
        priceUpdates.forEach(update => {
          if (update.type === 'stock' && symbols.includes(update.symbol)) {
            const quote: QuoteData = {
              symbol: update.symbol,
              price: update.price,
              open: update.price, // We don't have open price in real-time update
              high: update.price,
              low: update.price,
              volume: 0, // Volume not available in real-time update
              change: update.change24h || 0,
              changePercent: update.changePercent || 0,
              marketCap: 0,
              companyName: update.symbol,
              timestamp: new Date(update.timestamp).toISOString()
            };
            
            newQuotes.set(update.symbol, quote);
            
            // Call callback if provided
            if (onQuoteUpdate) {
              onQuoteUpdate(quote);
            }
          }
        });
        
        return newQuotes;
      });
    });

    socket.on('priceDrop', (dropData: any) => {
      console.log('Price drop alert:', dropData);
      // You can add toast notifications here for price drops
    });

    setConnectionStatus('connecting');

    // Cleanup function
    return () => {
      if (socket) {
        socket.emit('unsubscribe');
        socket.disconnect();
      }
      socketRef.current = null;
    };
  }, [symbols, onQuoteUpdate]);

  // Function to manually request latest quotes
  const refreshQuotes = async () => {
    // This would typically call the REST API to get latest quotes
    // for now, we rely on the real-time updates
    console.log('Refreshing quotes for symbols:', symbols);
  };

  return {
    quotes: Object.fromEntries(quotes),
    connectionStatus,
    refreshQuotes,
    isConnected: connectionStatus === 'connected'
  };
};