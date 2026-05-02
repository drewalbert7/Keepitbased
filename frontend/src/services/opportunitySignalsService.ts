import axios from 'axios';

export interface OpportunitySignalRow {
  id: number;
  symbol: string;
  asset_type: 'crypto' | 'stock';
  flags: string[];
  reasons: string[];
  vs_baseline_pct: number | null;
  price: string | number;
  created_at: string;
}

export async function fetchOpportunitySignals(limit = 50): Promise<OpportunitySignalRow[]> {
  const { data } = await axios.get<{ signals: OpportunitySignalRow[] }>('/opportunity-signals', {
    params: { limit }
  });
  return data.signals || [];
}
