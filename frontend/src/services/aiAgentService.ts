import axios from 'axios';
import { CreateAlertRequest } from '../types';

export interface AgentMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: string;
}

export interface AgentPlan {
  summary: string;
  riskNotes: string[];
  proposedAlert?: CreateAlertRequest;
}

export interface AgentScoringWeights {
  momentum: number;
  trend: number;
  liquidity: number;
  eventRiskPenalty: number;
}

export interface AgentPreferences {
  topN: number;
  confidenceFloor: number;
  maxPositionSizePct: number;
  watchlistOnly: boolean;
  scoringWeights: AgentScoringWeights;
}

export interface AgentLiveQuote {
  price: number;
  changePercent?: number;
  sourceUsed?: string;
}

export interface AgentCandidate {
  symbol: string;
  score: number;
  confidence: number;
  whyNow: string;
  riskFlags: string[];
  suggestedLimitBand: {
    min: number;
    max: number;
  };
  /** Present when LangGraph used live Node quotes. */
  liveQuote?: AgentLiveQuote;
}

const CRYPTO_SYMBOLS = new Set([
  'BTC',
  'ETH',
  'SOL',
  'DOGE',
  'XRP',
  'ADA',
  'AVAX',
  'DOT',
  'LINK',
  'LTC'
]);

/** Match backend `inferAssetType` for apply payloads. */
export const inferAlertAssetType = (symbol: string, prompt?: string): 'crypto' | 'stock' => {
  const s = symbol.toUpperCase();
  if (CRYPTO_SYMBOLS.has(s)) return 'crypto';
  const p = (prompt || '').toLowerCase();
  if (p.includes('crypto') && !p.includes('stock')) return 'crypto';
  return 'stock';
};

export interface AgentOutputV1 {
  schemaVersion: 'v1';
  topCandidates: AgentCandidate[];
  /** Python: `scan` vs educational `qa` path. */
  assistantPath?: 'scan' | 'qa';
  /** Python LangGraph optional internal alert create (server-side only). */
  internalAlertResult?: Record<string, unknown>;
}

export interface AgentChatResponse {
  mode: 'recommend_only' | 'auto_apply_low_risk';
  reply: string;
  plan: AgentPlan;
  output: AgentOutputV1;
  runMetadata?: {
    runId: string;
    nodeTimings: {
      langgraphInvokeMs: number;
      totalMs: number;
    };
    providerUsed: string;
    fallbackUsed: boolean;
    assistantIntentRequested?: string;
    assistantIntentResolved?: string;
    conversationTurns?: number;
  };
  preferencesUsed: AgentPreferences;
  policy: {
    decision: 'proposed' | 'approved' | 'rejected';
    autoApplied: boolean;
  };
  timestamp: string;
}

export interface AgentApplyResponse {
  message: string;
  alert: unknown;
  timestamp: string;
}

const extractSymbol = (text: string): string | null => {
  const match = text.toUpperCase().match(/\b[A-Z]{1,5}\b/);
  return match ? match[0] : null;
};

const extractThreshold = (text: string, fallback: number): number => {
  const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? Number(match[1]) : fallback;
};

export const buildAgentPlan = (prompt: string): AgentPlan => {
  const symbol = extractSymbol(prompt) || 'AAPL';
  const lower = prompt.toLowerCase();
  const assetType = lower.includes('crypto') ? 'crypto' : 'stock';

  const smallThreshold = extractThreshold(prompt, 5);
  const mediumThreshold = Math.max(smallThreshold + 2, 10);
  const largeThreshold = Math.max(mediumThreshold + 5, 15);

  const summary = `Prepared a ${assetType} alert strategy for ${symbol} using staged dip thresholds (${smallThreshold}%/${mediumThreshold}%/${largeThreshold}%).`;
  const riskNotes = [
    'Validate position size before enabling large-threshold alerts.',
    'Review liquidity and earnings/event calendar for this symbol.',
    'Use tighter thresholds when volatility is elevated intraday.'
  ];

  return {
    summary,
    riskNotes,
    proposedAlert: {
      symbol,
      assetType,
      smallThreshold,
      mediumThreshold,
      largeThreshold
    }
  };
};

export const createAgentReply = (prompt: string): string => {
  const plan = buildAgentPlan(prompt);
  const alertText = plan.proposedAlert
    ? `Draft alert: ${plan.proposedAlert.symbol} (${plan.proposedAlert.assetType}) with ${plan.proposedAlert.smallThreshold}% / ${plan.proposedAlert.mediumThreshold}% / ${plan.proposedAlert.largeThreshold}% thresholds.`
    : 'No alert draft was generated from this prompt.';

  return `${plan.summary}\n\n${alertText}\n\nNext step: review and apply this plan to your live alerts.`;
};

export type AssistantIntentMode = 'scan_rank' | 'ask_question' | 'smart';

export interface ChatWithAgentOptions {
  assistantIntent?: AssistantIntentMode;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export const chatWithAgent = async (
  prompt: string,
  mode: 'recommend_only' | 'auto_apply_low_risk' = 'recommend_only',
  preferences?: AgentPreferences,
  options?: ChatWithAgentOptions
): Promise<AgentChatResponse> => {
  const payload: Record<string, unknown> = { prompt, mode, preferences };
  if (options?.assistantIntent) {
    payload.assistantIntent = options.assistantIntent;
  }
  if (options?.conversationHistory?.length) {
    payload.conversationHistory = options.conversationHistory;
  }
  const response = await axios.post<AgentChatResponse>('/agent/chat', payload);
  return response.data;
};

export interface AgentAuditEvent {
  id: number;
  action: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface AgentAuditPage {
  events: AgentAuditEvent[];
  nextBeforeId: number | null;
  hasMore: boolean;
}

export async function fetchAgentAudit(params?: {
  limit?: number;
  /** Keyset: exclusive upper bound on row id (next page). */
  beforeId?: number;
  /** Prefix filter on `action` (e.g. `internal`, `agent_apply`). */
  action?: string;
}): Promise<AgentAuditPage> {
  const { data } = await axios.get<{
    events: AgentAuditEvent[];
    nextBeforeId: number | null;
    hasMore: boolean;
  }>('/agent/audit', {
    params: {
      limit: params?.limit ?? 25,
      beforeId: params?.beforeId,
      action: params?.action
    }
  });
  return {
    events: data.events || [],
    nextBeforeId: data.nextBeforeId ?? null,
    hasMore: Boolean(data.hasMore)
  };
}

export const applyAgentPlan = async (plan: AgentPlan): Promise<AgentApplyResponse> => {
  if (!plan.proposedAlert) {
    throw new Error('No proposed alert to apply');
  }
  const response = await axios.post<AgentApplyResponse>('/agent/apply', {
    proposedAlert: plan.proposedAlert
  });
  return response.data;
};

export interface WatchlistSizing {
  phase: string;
  tierLabel: string;
  suggestedPortfolioPct: number;
  rationale: string;
}

export interface WatchlistContextItem {
  alertId: number;
  symbol: string;
  assetType: string;
  active: boolean;
  /** On capital deploy list (broker execution later) */
  onDeployList?: boolean;
  thresholds: { small: number; medium: number; large: number };
  baselinePrice: number | null;
  currentPrice: number | null;
  /** Session / snapshot change % from quote provider when available */
  dayChangePct: number | null;
  /** Same snapshot: absolute $ change when available */
  dayChangeAbs: number | null;
  quoteAgeSec: number | null;
  priceUnavailableReason: string | null;
  dropPctFromBaseline: number | null;
  nextThresholdGap: { next: string; pctRemaining: number } | null;
  sizing: WatchlistSizing;
  /** Polygon day session (regular) when cached */
  dayHigh?: number | null;
  dayLow?: number | null;
  volume?: number | null;
  prevClose?: number | null;
  /** Trailing ~252 sessions from daily aggregates when market data available */
  week52High?: number | null;
  week52Low?: number | null;
  /** Regular-session open (e.g. Polygon `day.o`, Binance `openPrice`) */
  dayOpen?: number | null;
  /** Session volume-weighted average price when vendor provides it (e.g. Polygon `day.vw`) */
  sessionVwap?: number | null;
  /** Best bid (e.g. snapshot `lastQuote.p`) */
  bidPrice?: number | null;
  /** Best ask (e.g. snapshot `lastQuote.P`) */
  askPrice?: number | null;
  /** Redis quote payload source tag (`polygon_snapshot`, `binance_24h`, …) */
  quoteSourceUsed?: string | null;
  /** Taiwan listing: English ticker alias (e.g. TSMC for TW:2330) */
  englishAlias?: string | null;
  stockMarket?: 'TW' | 'US' | null;
}

export interface WatchlistContextResponse {
  generatedAt: string;
  maxPositionPct: number;
  policyNote: string;
  items: WatchlistContextItem[];
}

export async function fetchAgentWatchlistContext(maxPositionPct: number): Promise<WatchlistContextResponse> {
  const { data } = await axios.get<WatchlistContextResponse>('/agent/watchlist-context', {
    params: { maxPositionPct }
  });
  return data;
}

export interface XPulseTweet {
  id: string;
  createdAt: string;
  text: string;
  authorUsername: string | null;
  authorName: string | null;
  monitorLabel?: string;
  monitorUsername?: string;
  cashtags: string[];
}

export interface XPulseTickerBuzz {
  symbol: string;
  mentions: number;
}

export interface XPulseResponse {
  configured: boolean;
  warning: string | null;
  accounts: Array<{ id: string; username: string; label: string }>;
  tweets: XPulseTweet[];
  tickerBuzz: XPulseTickerBuzz[];
  fetchedAt: string;
  cached?: boolean;
}

export async function fetchXPulse(): Promise<XPulseResponse> {
  const { data } = await axios.get<XPulseResponse>('/social/x-pulse');
  return data;
}
