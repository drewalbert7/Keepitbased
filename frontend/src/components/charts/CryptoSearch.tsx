import React, { useState, useEffect, useRef } from 'react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { getCryptoPairs, CryptoPair, POPULAR_CRYPTO_PAIRS, formatPairName } from '../../services/cryptoService';

interface CryptoSearchProps {
  onSelectPair: (pair: string) => void;
  currentPair: string;
}

export const CryptoSearch: React.FC<CryptoSearchProps> = ({ 
  onSelectPair, 
  currentPair 
}) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [pairs, setPairs] = useState<CryptoPair[]>([]);
  const [filteredPairs, setFilteredPairs] = useState<CryptoPair[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load crypto pairs on mount
  useEffect(() => {
    const loadPairs = async () => {
      setIsLoading(true);
      try {
        const response = await getCryptoPairs();
        setPairs(response.pairs);
        
        // Start with popular pairs
        const popularPairs = response.pairs.filter(pair => 
          POPULAR_CRYPTO_PAIRS.includes(pair.symbol)
        );
        setFilteredPairs(popularPairs);
      } catch (error) {
        console.error('Error loading crypto pairs:', error);
        // Fallback to popular pairs
        const fallbackPairs = POPULAR_CRYPTO_PAIRS.map(symbol => ({
          symbol,
          wsname: symbol,
          base: symbol.replace(/USD$|ZUSD$/, ''),
          quote: 'USD',
          displayName: formatPairName(symbol),
          lotSize: 8,
          priceDecimals: 8
        }));
        setPairs(fallbackPairs);
        setFilteredPairs(fallbackPairs);
      } finally {
        setIsLoading(false);
      }
    };

    loadPairs();
  }, []);

  // Filter pairs based on search query
  useEffect(() => {
    if (!query.trim()) {
      // Show popular pairs when no query
      const popularPairs = pairs.filter(pair => 
        POPULAR_CRYPTO_PAIRS.includes(pair.symbol)
      );
      setFilteredPairs(popularPairs);
      setSelectedIndex(0);
      return;
    }

    const filtered = pairs.filter(pair => {
      const searchTerm = query.toLowerCase();
      return (
        pair.symbol.toLowerCase().includes(searchTerm) ||
        pair.displayName.toLowerCase().includes(searchTerm) ||
        pair.base.toLowerCase().includes(searchTerm)
      );
    });

    setFilteredPairs(filtered);
    setSelectedIndex(0);
  }, [query, pairs]);

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev < filteredPairs.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev > 0 ? prev - 1 : filteredPairs.length - 1
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredPairs[selectedIndex]) {
          handleSelectPair(filteredPairs[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setQuery('');
        inputRef.current?.blur();
        break;
    }
  };

  const handleSelectPair = (pair: CryptoPair) => {
    onSelectPair(pair.symbol);
    setIsOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  const handleInputFocus = () => {
    setIsOpen(true);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    if (!isOpen) setIsOpen(true);
  };

  return (
    <div className="relative" ref={searchRef}>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <MagnifyingGlassIcon className="h-5 w-5 text-robinhood-gray-400" />
        </div>
        <input
          ref={inputRef}
          type="text"
          className="input-field pl-10"
          placeholder={`Search crypto pairs... (Current: ${formatPairName(currentPair)})`}
          value={query}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
        />
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full max-w-md bg-white border border-robinhood-gray-200 rounded-lg shadow-lg max-h-96 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-center text-robinhood-gray-500">
              <div className="animate-spin h-5 w-5 border-2 border-robinhood-green border-t-transparent rounded-full mx-auto mb-2"></div>
              Loading crypto pairs...
            </div>
          ) : filteredPairs.length === 0 ? (
            <div className="p-4 text-center text-robinhood-gray-500">
              No pairs found matching "{query}"
            </div>
          ) : (
            <>
              {!query && (
                <div className="p-3 border-b border-robinhood-gray-200">
                  <div className="text-xs font-semibold text-robinhood-gray-500 uppercase tracking-wide">
                    Popular Pairs
                  </div>
                </div>
              )}
              <div className="py-2">
                {filteredPairs.map((pair, index) => (
                  <button
                    key={pair.symbol}
                    className={`w-full px-4 py-3 text-left hover:bg-robinhood-gray-50 transition-colors ${
                      index === selectedIndex ? 'bg-robinhood-gray-50' : ''
                    } ${
                      pair.symbol === currentPair ? 'bg-green-50 border-r-2 border-robinhood-green' : ''
                    }`}
                    onClick={() => handleSelectPair(pair)}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-robinhood-gray-900">
                          {pair.displayName}
                        </div>
                        <div className="text-sm text-robinhood-gray-500">
                          {pair.base} / {pair.quote}
                        </div>
                      </div>
                      <div className="text-xs text-robinhood-gray-400">
                        {pair.symbol}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default CryptoSearch;