import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { addWatchlistSymbol, searchWatchlistStocks, type StockSearchHit } from '../services/watchlistApi';

const DEBOUNCE_MS = 300;

type WatchlistStockSearchInputProps = {
  onSymbolAdded: () => void | Promise<void>;
  disabled?: boolean;
};

/**
 * Combobox: type a company name or ticker, pick a US listing, or enter a ticker and Add (server validates).
 */
export const WatchlistStockSearchInput: React.FC<WatchlistStockSearchInputProps> = ({
  onSymbolAdded,
  disabled = false
}) => {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<StockSearchHit[]>([]);
  const [searchAvailable, setSearchAvailable] = useState(true);
  const [highlight, setHighlight] = useState(0);
  const [adding, setAdding] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = 'watchlist-stock-search-listbox';

  const runSearch = useCallback(async (q: string) => {
    if (q.length < 1) {
      setHits([]);
      return;
    }
    setLoading(true);
    try {
      const data = await searchWatchlistStocks(q);
      setHits(data.results);
      setSearchAvailable(data.searchAvailable !== false);
      setHighlight(0);
    } catch {
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const q = value.trim();
    if (q.length < 1) {
      setHits([]);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      void runSearch(q);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [value, runSearch]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const doAdd = useCallback(
    async (raw: string) => {
      const sym = raw.trim();
      if (!sym || adding || disabled) return;
      setAdding(true);
      try {
        await addWatchlistSymbol(sym);
        toast.success(`${sym.toUpperCase()} added to your watchlist`);
        setValue('');
        setHits([]);
        setOpen(false);
        await onSymbolAdded();
      } catch (error: unknown) {
        const msg = axios.isAxiosError(error)
          ? String(error.response?.data?.message || '') || error.message
          : error instanceof Error
            ? error.message
            : 'Could not add symbol';
        toast.error(msg || 'Could not add symbol');
      } finally {
        setAdding(false);
      }
    },
    [adding, disabled, onSymbolAdded]
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open || hits.length === 0) {
      if (e.key === 'Enter') {
        e.preventDefault();
        void doAdd(value);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(hits.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = hits[highlight];
      if (row) void doAdd(row.ticker);
      else void doAdd(value);
    }
  };

  const showPanel =
    open &&
    (loading ||
      hits.length > 0 ||
      (searchAvailable && value.trim().length >= 2 && !loading));

  return (
    <div ref={rootRef} className="relative flex-1">
      <div className="flex gap-2 mt-1.5">
        <input
          type="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={showPanel}
          aria-controls={showPanel ? listId : undefined}
          aria-activedescendant={showPanel && hits[highlight] ? `${listId}-opt-${highlight}` : undefined}
          role="combobox"
          id="watchlist-stock-search-input"
          value={value}
          disabled={disabled || adding}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search company or ticker (e.g. Apple, MSFT)…"
          className="input-field flex-1 font-mono text-sm"
        />
        <button
          type="button"
          onClick={() => void doAdd(value)}
          disabled={adding || disabled || !value.trim()}
          className="btn-primary whitespace-nowrap px-5 disabled:opacity-50"
        >
          {adding ? 'Adding…' : 'Add'}
        </button>
      </div>

      {showPanel && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[min(280px,45vh)] overflow-y-auto rounded-lg border border-white/[0.1] bg-kib-card py-1 shadow-lg"
        >
          {loading && hits.length === 0 && (
            <li className="px-3 py-2 text-xs text-kib-muted">Searching…</li>
          )}
          {!loading &&
            hits.map((h, i) => (
              <li key={h.ticker} role="presentation">
                <button
                  type="button"
                  role="option"
                  id={`${listId}-opt-${i}`}
                  aria-selected={i === highlight}
                  className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-white/[0.06] ${
                    i === highlight ? 'bg-white/[0.08]' : ''
                  }`}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    void doAdd(h.ticker);
                  }}
                >
                  <span className="font-mono font-semibold text-kib-fg">{h.ticker}</span>
                  <span className="text-xs text-kib-muted line-clamp-2">{h.name}</span>
                  {h.primary_exchange ? (
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">{h.primary_exchange}</span>
                  ) : null}
                </button>
              </li>
            ))}
          {!loading && hits.length === 0 && value.trim().length >= 2 && (
            <li className="px-3 py-2 text-xs text-kib-muted">
              No matches — enter a valid US ticker and press Add (we verify against market data).
            </li>
          )}
        </ul>
      )}

      {!searchAvailable && (
        <p className="mt-1.5 text-[11px] text-amber-200/85">
          Live search needs market data configuration on the server. You can still type a ticker — additions are
          verified before saving.
        </p>
      )}
    </div>
  );
};
