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
