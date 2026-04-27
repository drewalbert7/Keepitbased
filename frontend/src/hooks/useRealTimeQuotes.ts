import { useState, useEffect, useRef } from 'react';
import { QuoteData } from '../services/chartService';
import { getStockQuote } from '../services/chartService';

interface UseRealTimeQuotesProps {
  symbols: string[];
  onQuoteUpdate?: (quote: QuoteData) => void;
}

export const useRealTimeQuotes = ({ symbols, onQuoteUpdate }: UseRealTimeQuotesProps) => {
  const [quotes, setQuotes] = useState<Map<string, QuoteData>>(new Map());
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [pollingIntervalMs, setPollingIntervalMs] = useState<number>(10000);
  const timeoutRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const cancelledRef = useRef(false);
  const intervalRef = useRef(10000);
  const emptyPollCountRef = useRef(0);
  const tabHiddenRef = useRef(false);

  useEffect(() => {
    if (symbols.length === 0) return;
    cancelledRef.current = false;
    inFlightRef.current = false;
    emptyPollCountRef.current = 0;
    intervalRef.current = 10000;
    setConnectionStatus('connecting');

    const getIntervalForSource = (sourceUsed?: string) => {
      if (sourceUsed === 'snapshot') return 3000;
      if (sourceUsed === 'agg_minute') return 10000;
      return 60000;
    };

    const onVisibilityChange = () => {
      tabHiddenRef.current = document.visibilityState !== 'visible';
      if (!tabHiddenRef.current) {
        intervalRef.current = Math.max(3000, Math.min(intervalRef.current, 10000));
        scheduleNext(0);
      }
    };

    const clearTimer = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    const scheduleNext = (delayMs: number) => {
      clearTimer();
      if (cancelledRef.current) return;
      timeoutRef.current = window.setTimeout(() => {
        void pollQuotes();
      }, Math.max(2000, delayMs));
    };

    const pollQuotes = async (): Promise<void> => {
      if (cancelledRef.current || inFlightRef.current) return;
      if (tabHiddenRef.current) {
        intervalRef.current = 60000;
        setPollingIntervalMs(60000);
        scheduleNext(60000);
        return;
      }
      inFlightRef.current = true;
      try {
        const quoteResults = await Promise.all(
          symbols.map((symbol) => getStockQuote(symbol).catch(() => null))
        );

        if (cancelledRef.current) return;

        setQuotes((prevQuotes) => {
          const newQuotes = new Map(prevQuotes);
          quoteResults.forEach((quote) => {
            if (!quote) return;
            newQuotes.set(quote.symbol, quote);
            onQuoteUpdate?.(quote);
          });
          return newQuotes;
        });

        const firstAvailableQuote = quoteResults.find((q): q is QuoteData => q !== null);
        const nextInterval = getIntervalForSource(firstAvailableQuote?.sourceUsed);
        intervalRef.current = nextInterval;
        setPollingIntervalMs(nextInterval);
        if (firstAvailableQuote) {
          emptyPollCountRef.current = 0;
          setConnectionStatus('connected');
        } else {
          emptyPollCountRef.current += 1;
          if (emptyPollCountRef.current >= 3) {
            setConnectionStatus('disconnected');
          }
        }
      } catch (_error) {
        if (!cancelledRef.current) {
          setConnectionStatus('disconnected');
          intervalRef.current = 15000;
          setPollingIntervalMs(15000);
        }
      } finally {
        inFlightRef.current = false;
        scheduleNext(intervalRef.current);
      }
    };

    onVisibilityChange();
    window.addEventListener('visibilitychange', onVisibilityChange);
    void pollQuotes();

    return () => {
      cancelledRef.current = true;
      window.removeEventListener('visibilitychange', onVisibilityChange);
      clearTimer();
    };
  }, [symbols, onQuoteUpdate]);

  // Function to manually request latest quotes
  const refreshQuotes = async () => {
    const quoteResults = await Promise.all(
      symbols.map((symbol) => getStockQuote(symbol).catch(() => null))
    );

    setQuotes((prevQuotes) => {
      const newQuotes = new Map(prevQuotes);
      quoteResults.forEach((quote) => {
        if (quote) {
          newQuotes.set(quote.symbol, quote);
          onQuoteUpdate?.(quote);
        }
      });
      return newQuotes;
    });
  };

  return {
    quotes: Object.fromEntries(quotes),
    connectionStatus,
    refreshQuotes,
    pollingIntervalMs,
    isConnected: connectionStatus === 'connected'
  };
};