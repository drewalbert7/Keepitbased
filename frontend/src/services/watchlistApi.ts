import axios from 'axios';

export interface WatchlistResponse {
  symbols: string[];
  tokens: string[];
}

export async function fetchWatchlist(): Promise<WatchlistResponse> {
  const { data } = await axios.get<WatchlistResponse>('/watchlist');
  return data;
}

export async function addWatchlistSymbol(symbol: string): Promise<WatchlistResponse> {
  const { data } = await axios.post<WatchlistResponse>('/watchlist/symbols', { symbol });
  return data;
}

export async function removeWatchlistSymbol(symbol: string): Promise<WatchlistResponse> {
  const { data } = await axios.delete<WatchlistResponse>(
    `/watchlist/symbols/${encodeURIComponent(symbol)}`
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
