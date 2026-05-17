import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { addWatchlistSymbol, searchWatchlistTwStocks, type TwStockSearchHit } from '../services/watchlistApi';

const DEBOUNCE_MS = 300;

type WatchlistTwStockSearchInputProps = {
  onSymbolAdded: () => void | Promise<void>;
  disabled?: boolean;
};

/**
 * Combobox for Taiwan (TWSE) listings — numeric codes via iTick (e.g. 2330 TSMC).
 */
export const WatchlistTwStockSearchInput: React.FC<WatchlistTwStockSearchInputProps> = ({
  onSymbolAdded,
  disabled = false
}) => {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<TwStockSearchHit[]>([]);
  const [searchAvailable, setSearchAvailable] = useState(true);
  const [highlight, setHighlight] = useState(0);
  const [adding, setAdding] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = 'watchlist-tw-stock-search-listbox';

  const runSearch = useCallback(async (q: string) => {
    if (q.length < 1) {
      setHits([]);
      return;
    }
    setLoading(true);
    try {
      const data = await searchWatchlistTwStocks(q);
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
        await addWatchlistSymbol(sym, 'stock', { stockMarket: 'TW' });
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
      if (row) void doAdd(row.code);
      else void doAdd(value);
    }
  };

  const showPanel =
    open &&
    (loading ||
      hits.length > 0 ||
      (searchAvailable && value.trim().length >= 2 && !loading));

  return (
    <div ref={rootRef} className="relative w-full">
      <div className="flex min-h-[44px] w-full overflow-hidden rounded-xl border border-white/[0.12] bg-[#0a0d12] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-[box-shadow,border-color] focus-within:border-[#58a6ff]/85 focus-within:ring-2 focus-within:ring-[#58a6ff]/22">
        <div className="relative flex min-w-0 flex-1 items-center">
          <MagnifyingGlassIcon
            className="pointer-events-none absolute left-3 h-4 w-4 shrink-0 text-kib-muted"
            aria-hidden
          />
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
            id="watchlist-tw-stock-search-input"
            value={value}
            disabled={disabled || adding}
            onChange={(e) => {
              setValue(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Code, name, or alias (e.g. 2330, FOCI)…"
            className="min-w-0 flex-1 border-0 bg-transparent py-2.5 pl-9 pr-2 text-sm font-mono text-kib-fg placeholder:text-kib-muted/80 focus:outline-none focus:ring-0 disabled:opacity-50"
          />
        </div>
        <div className="w-px shrink-0 self-stretch bg-white/[0.08]" aria-hidden />
        <button
          type="button"
          onClick={() => void doAdd(value)}
          disabled={adding || disabled || !value.trim()}
          className="shrink-0 px-4 text-sm font-semibold text-kib-fg transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40 sm:px-5"
        >
          {adding ? '…' : 'Add'}
        </button>
      </div>

      {showPanel && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-[min(280px,45vh)] overflow-y-auto rounded-xl border border-white/[0.1] bg-kib-card py-1 shadow-xl ring-1 ring-black/40"
        >
          {loading && hits.length === 0 && (
            <li className="px-3 py-2 text-xs text-kib-muted">Searching…</li>
          )}
          {!loading &&
            hits.map((h, i) => (
              <li key={h.alertSymbol} role="presentation">
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
                    void doAdd(h.code);
                  }}
                >
                  <span className="font-mono font-semibold text-kib-fg">
                    {h.alertSymbol}
                    {h.matchedAlias ? (
                      <span className="ml-1.5 font-normal text-kib-muted">({h.matchedAlias})</span>
                    ) : null}
                  </span>
                  <span className="text-xs text-kib-muted line-clamp-2">
                    {h.name || 'Taiwan listing'}
                  </span>
                  {h.exchange ? (
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">{h.exchange}</span>
                  ) : null}
                </button>
              </li>
            ))}
          {!loading && hits.length === 0 && value.trim().length >= 2 && (
            <li className="px-3 py-2 text-xs text-kib-muted">
              No matches — enter a 4–6 digit TWSE code and press Add.
            </li>
          )}
        </ul>
      )}

      {!searchAvailable && (
        <p className="mt-1.5 text-[11px] text-amber-200/85">
          Live search needs ITICK_API_TOKEN on the server. You can still type a code — additions are
          verified before saving.
        </p>
      )}
    </div>
  );
};
