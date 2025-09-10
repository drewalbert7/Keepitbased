import React, { useState, useCallback, useEffect } from 'react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { debounce } from 'lodash';
import { searchStocks } from '../../services/chartService';

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
}

interface StockSearchProps {
  onSelectStock: (symbol: string) => void;
  currentSymbol?: string;
}

export const StockSearch: React.FC<StockSearchProps> = ({ onSelectStock, currentSymbol }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const debouncedSearch = useCallback(
    debounce(async (searchQuery: string) => {
      if (searchQuery.length < 2) {
        setResults([]);
        return;
      }

      setIsLoading(true);
      try {
        const searchResults = await searchStocks(searchQuery);
        setResults(searchResults.results || []);
      } catch (error) {
        console.error('Search failed:', error);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 300),
    []
  );

  useEffect(() => {
    debouncedSearch(query);
  }, [query, debouncedSearch]);

  const handleSelectStock = (symbol: string) => {
    onSelectStock(symbol);
    setQuery('');
    setIsOpen(false);
  };

  const popularStocks = [
    { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' },
    { symbol: 'GOOGL', name: 'Alphabet Inc.', exchange: 'NASDAQ' },
    { symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ' },
    { symbol: 'TSLA', name: 'Tesla Inc.', exchange: 'NASDAQ' },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', exchange: 'NASDAQ' },
    { symbol: 'META', name: 'Meta Platforms Inc.', exchange: 'NASDAQ' },
    { symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ' },
    { symbol: 'NFLX', name: 'Netflix Inc.', exchange: 'NASDAQ' },
  ];

  return (
    <div className="relative">
      <div className="relative">
        <input
          type="text"
          placeholder="Search stocks (e.g., AAPL, Tesla)..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
        <MagnifyingGlassIcon className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
        {isLoading && (
          <div className="absolute right-3 top-2.5">
            <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full"></div>
          </div>
        )}
      </div>

      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-10" 
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute z-20 w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg max-h-96 overflow-y-auto">
            {query.length >= 2 ? (
              results.length > 0 ? (
                <div>
                  <div className="px-4 py-2 text-sm text-gray-400 border-b border-gray-700">
                    Search Results
                  </div>
                  {results.map((stock) => (
                    <button
                      key={stock.symbol}
                      onClick={() => handleSelectStock(stock.symbol)}
                      className={`w-full px-4 py-3 text-left hover:bg-gray-700 transition-colors ${
                        currentSymbol === stock.symbol ? 'bg-blue-600' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-white font-semibold">{stock.symbol}</div>
                          <div className="text-gray-400 text-sm">{stock.name}</div>
                        </div>
                        <div className="text-gray-500 text-xs">{stock.exchange}</div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                !isLoading && (
                  <div className="px-4 py-8 text-center text-gray-400">
                    No stocks found for "{query}"
                  </div>
                )
              )
            ) : (
              <div>
                <div className="px-4 py-2 text-sm text-gray-400 border-b border-gray-700">
                  Popular Stocks
                </div>
                {popularStocks.map((stock) => (
                  <button
                    key={stock.symbol}
                    onClick={() => handleSelectStock(stock.symbol)}
                    className={`w-full px-4 py-3 text-left hover:bg-gray-700 transition-colors ${
                      currentSymbol === stock.symbol ? 'bg-blue-600' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-white font-semibold">{stock.symbol}</div>
                        <div className="text-gray-400 text-sm">{stock.name}</div>
                      </div>
                      <div className="text-gray-500 text-xs">{stock.exchange}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};