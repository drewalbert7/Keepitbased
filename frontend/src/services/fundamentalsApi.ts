import axios from 'axios';

/** Response shape from `GET /api/fundamentals/:symbol` → python-service normalization. */
export interface StockFundamentals {
  symbol: string;
  companyName?: string;
  currency?: string | null;
  marketCap?: number | null;
  enterpriseValue?: number | null;
  enterpriseToRevenue?: number | null;
  enterpriseToEbitda?: number | null;
  trailingPE?: number | null;
  forwardPE?: number | null;
  priceToSalesTrailing12Months?: number | null;
  priceToBook?: number | null;
  grossMargins?: number | null;
  operatingMargins?: number | null;
  profitMargins?: number | null;
  revenueGrowth?: number | null;
  earningsGrowth?: number | null;
  returnOnEquity?: number | null;
  debtToEquity?: number | null;
  totalRevenue?: number | null;
  totalCash?: number | null;
  totalDebt?: number | null;
  freeCashflow?: number | null;
  ebitda?: number | null;
  sector?: string | null;
  industry?: string | null;
  timestamp?: string;
  /** Error payloads from upstream */
  message?: string;
  detail?: string;
}

export function secIssuerBrowseUrl(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  const params = new URLSearchParams({
    action: 'getcompany',
    ticker: t,
    owner: 'exclude',
    count: '40'
  });
  return `https://www.sec.gov/cgi-bin/browse-edgar?${params.toString()}`;
}

export async function fetchStockFundamentals(symbol: string): Promise<StockFundamentals> {
  const sym = symbol.trim().toUpperCase();
  const { data } = await axios.get<StockFundamentals>(`/fundamentals/${encodeURIComponent(sym)}`);
  return data;
}
