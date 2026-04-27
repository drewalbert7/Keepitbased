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
}

export interface AgentOutputV1 {
  schemaVersion: 'v1';
  topCandidates: AgentCandidate[];
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

export const chatWithAgent = async (
  prompt: string,
  mode: 'recommend_only' | 'auto_apply_low_risk' = 'recommend_only',
  preferences?: AgentPreferences
): Promise<AgentChatResponse> => {
  const response = await axios.post<AgentChatResponse>('/agent/chat', { prompt, mode, preferences });
  return response.data;
};

export const applyAgentPlan = async (plan: AgentPlan): Promise<AgentApplyResponse> => {
  if (!plan.proposedAlert) {
    throw new Error('No proposed alert to apply');
  }
  const response = await axios.post<AgentApplyResponse>('/agent/apply', {
    proposedAlert: plan.proposedAlert
  });
  return response.data;
};
