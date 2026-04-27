import { useState, useEffect } from 'react';
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

  useEffect(() => {
    if (symbols.length === 0) return;
    let cancelled = false;
    let timeoutId: number | null = null;
    let currentIntervalMs = 10000;
    setConnectionStatus('connecting');

    const getIntervalForSource = (sourceUsed?: string) => {
      if (sourceUsed === 'snapshot') return 3000;
      if (sourceUsed === 'agg_minute') return 10000;
      return 60000;
    };

    const pollQuotes = async () => {
      try {
        const quoteResults = await Promise.all(
          symbols.map((symbol) => getStockQuote(symbol).catch(() => null))
        );

        if (cancelled) return;

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
        currentIntervalMs = nextInterval;
        setPollingIntervalMs(nextInterval);
        setConnectionStatus('connected');
      } catch (_error) {
        if (!cancelled) {
          setConnectionStatus('disconnected');
          setPollingIntervalMs(15000);
        }
      } finally {
        if (!cancelled) {
          timeoutId = window.setTimeout(() => {
            void pollQuotes();
          }, currentIntervalMs);
        }
      }
    };

    void pollQuotes();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
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