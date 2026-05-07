import axios from 'axios';

/** Non-sensitive flags from GET /api/health/config */
export type PublicHealthConfig = {
  opportunityTriggerMode?: string;
  opportunityOnSaleAtrMult?: number;
  opportunityOverreactionAtrMult?: number;
  opportunityOnSaleDropPct?: number;
  opportunityOverreactionDropPct?: number;
  opportunityVolSpikeMult?: number;
  opportunityDedupeTtlSec?: number;
  opportunityCapitulationAtr14Mult?: number;
  opportunityCapitulationAtr50Mult?: number;
  opportunityCapitulationFrom52wPct?: number;
  opportunityCapitulationFallback52wPct?: number;
  opportunityCapitulationMegaCapAthPct?: number;
  opportunityMegaCapSymbolCount?: number;
  opportunityCapitulationDedupeTtlSec?: number;
  opportunityShortTrendFilterEnabled?: boolean;
  opportunityShortTrendSmaDays?: number;
  opportunityAtrMinPctOfPrice?: number;
  dailyWatchlistDigestEnabled?: boolean;
  dailyWatchlistDigestCron?: string;
  smtpConfigured?: boolean;
  marketDataKeyPresent?: boolean;
};

export async function fetchPublicHealthConfig(): Promise<PublicHealthConfig | null> {
  try {
    const { data } = await axios.get<{ status?: string; config?: PublicHealthConfig }>('/health/config');
    return data?.config ?? null;
  } catch {
    return null;
  }
}
