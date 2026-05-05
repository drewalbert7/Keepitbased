import axios from 'axios';

/** Persisted when Grok dip-insight completes for this signal (same DB row as deterministic flags). */
export interface OpportunityAiAssessment {
  schemaVersion?: string;
  verdict?: string | null;
  confidence?: number | null;
  reasoning?: string | null;
  situationSummary?: string | null;
  suggestedTranchePct?: number | null;
  ruleConfluenceScore?: number | null;
  emailSent?: boolean;
  emailSuppressReason?: string | null;
  riskNotes?: string[] | null;
}

export interface OpportunitySignalRow {
  id: number;
  symbol: string;
  asset_type: 'crypto' | 'stock';
  flags: string[];
  reasons: string[];
  vs_baseline_pct: number | null;
  price: string | number;
  created_at: string;
  ai_assessment?: OpportunityAiAssessment | null;
}

export async function fetchOpportunitySignals(limit = 50): Promise<OpportunitySignalRow[]> {
  const { data } = await axios.get<{ signals: OpportunitySignalRow[] }>('/opportunity-signals', {
    params: { limit }
  });
  return data.signals || [];
}
