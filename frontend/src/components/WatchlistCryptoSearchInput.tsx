import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { addWatchlistSymbol } from '../services/watchlistApi';
import {
  getCryptoPairs,
  type CryptoPair,
  POPULAR_CRYPTO_PAIRS,
  formatPairName
} from '../services/cryptoService';

type Props = {
  onSymbolAdded: () => void | Promise<void>;
  disabled?: boolean;
};

/**
 * Add a crypto base (e.g. BTC) — same Main watchlist as stocks; Polygon pair derived as X:BTCUSD.
 */
export const WatchlistCryptoSearchInput: React.FC<Props> = ({
  onSymbolAdded,
  disabled = false
}) => {
  const [pairs, setPairs] = useState<CryptoPair[]>([]);
  const [filtered, setFiltered] = useState<CryptoPair[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = 'watchlist-crypto-search-listbox';

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await getCryptoPairs();
        if (cancelled) return;
        setPairs(res.pairs);
      } catch {
        if (!cancelled) setPairs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!pairs.length && !loading) return;
    if (!q) {
      setFiltered(pairs.filter((p) => POPULAR_CRYPTO_PAIRS.includes(p.symbol)).slice(0, 24));
      return;
    }
    setFiltered(
      pairs.filter(
        (p) =>
          p.symbol.toLowerCase().includes(q) ||
          String(p.displayName || '').toLowerCase().includes(q) ||
          String(p.base || '').toLowerCase().includes(q)
      ).slice(0, 48)
    );
    setHighlight(0);
  }, [query, pairs, loading]);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  const cryptoBaseFromPair = (p: CryptoPair): string => {
    const fromBase = String(p.base || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (fromBase.length >= 2) return fromBase;
    let s = String(p.symbol || '')
      .trim()
      .toUpperCase()
      .replace(/^X:/, '');
    s = s.replace(/USDT?$/, '').replace(/USD$/, '').replace(/[^A-Z0-9]/g, '');
    return s;
  };

  const doAddPair = useCallback(
    async (p: CryptoPair) => {
      const base = cryptoBaseFromPair(p);
      if (!base || adding || disabled) return;
      setAdding(true);
      try {
        await addWatchlistSymbol(base, 'crypto');
        toast.success(`${base} added to watchlist (crypto)`);
        setQuery('');
        setOpen(false);
        await onSymbolAdded();
      } catch (error: unknown) {
        const msg = axios.isAxiosError(error)
          ? String(error.response?.data?.message || '') || error.message
          : error instanceof Error
            ? error.message
            : 'Could not add crypto';
        toast.error(msg || 'Could not add crypto');
      } finally {
        setAdding(false);
      }
    },
    [adding, disabled, onSymbolAdded]
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((i) => (filtered.length ? (i + 1) % filtered.length : 0));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((i) => (filtered.length ? (i - 1 + filtered.length) % filtered.length : 0));
    }
    if (e.key === 'Enter' && filtered[highlight]) {
      e.preventDefault();
      void doAddPair(filtered[highlight]);
    }
  };

  const inputId = 'watchlist-crypto-search-input';

  return (
    <div ref={rootRef} className="relative mt-2">
      <input
        id={inputId}
        type="text"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        placeholder={
          loading
            ? 'Loading crypto pairs…'
            : `Search Polygon crypto (popular: ${POPULAR_CRYPTO_PAIRS.slice(0, 4).join(', ')})`
        }
        className="input-field w-full mt-1"
        value={query}
        onChange={(ev) => {
          setQuery(ev.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && filtered.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-labelledby={inputId}
          className="absolute z-40 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-kib-line bg-kib-raise shadow-lg"
        >
          {filtered.map((p, i) => (
            <li key={p.symbol} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                disabled={disabled || adding}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                  i === highlight ? 'bg-white/[0.08]' : ''
                } hover:bg-white/[0.06]`}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  void doAddPair(p);
                }}
              >
                <span className="font-mono font-semibold text-kib-fg">{cryptoBaseFromPair(p)}</span>
                <span className="flex-1 truncate text-kib-muted">{formatPairName(p.symbol)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
