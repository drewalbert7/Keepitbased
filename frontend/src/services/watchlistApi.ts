import axios from 'axios';

export interface WatchlistResponse {
  symbols: string[];
  tokens: string[];
}

export async function fetchWatchlist(): Promise<WatchlistResponse> {
  const { data } = await axios.get<WatchlistResponse>('/watchlist');
  return data;
}

export type StockMarket = 'US' | 'TW';

export async function addWatchlistSymbol(
  symbol: string,
  assetType: 'stock' | 'crypto' = 'stock',
  options?: { stockMarket?: StockMarket }
): Promise<WatchlistResponse> {
  const { data } = await axios.post<WatchlistResponse>('/watchlist/symbols', {
    symbol,
    assetType,
    ...(assetType === 'stock' && options?.stockMarket ? { stockMarket: options.stockMarket } : {})
  });
  return data;
}

export async function removeWatchlistSymbol(
  symbol: string,
  assetType: 'stock' | 'crypto' = 'stock'
): Promise<WatchlistResponse> {
  const { data } = await axios.delete<WatchlistResponse>(
    `/watchlist/symbols/${encodeURIComponent(symbol)}`,
    { params: { assetType } }
  );
  return data;
}

export interface StockSearchHit {
  ticker: string;
  name: string;
  primary_exchange: string;
}

export interface StockSearchResponse {
  results: StockSearchHit[];
  searchAvailable: boolean;
}

/** Company / ticker search for the dashboard (US stocks via market data API) */
export async function searchWatchlistStocks(q: string): Promise<StockSearchResponse> {
  const { data } = await axios.get<StockSearchResponse>('/watchlist/stock-search', {
    params: { q: q.trim().slice(0, 64) }
  });
  return data;
}

export interface TwStockSearchHit {
  code: string;
  name: string;
  exchange: string;
  alertSymbol: string;
  /** e.g. FOCI when matched via English alias map */
  matchedAlias?: string | null;
}

export interface TwStockSearchResponse {
  results: TwStockSearchHit[];
  searchAvailable: boolean;
  reason?: string;
}

/** Taiwan (TWSE) company / numeric code search via iTick */
export async function searchWatchlistTwStocks(q: string): Promise<TwStockSearchResponse> {
  const { data } = await axios.get<TwStockSearchResponse>('/watchlist/tw-stock-search', {
    params: { q: q.trim().slice(0, 32) }
  });
  return data;
}

export function isTwStockSymbol(symbol: string): boolean {
  return /^TW:\d{4,6}$/i.test(String(symbol || '').trim());
}
