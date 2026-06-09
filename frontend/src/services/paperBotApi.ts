import axios from 'axios';

export interface PaperBotAccount {
  userId: number;
  startingCashUsd: number;
  cashUsd: number;
  equityUsd: number;
  dayPnlUsd: number;
  cumPnlUsd: number;
  openRiskPct: number;
  mode: 'paper' | 'shadow' | 'live';
  killSwitchArmed: boolean;
  tradeDeployListOnly: boolean;
  policyVersion: number;
  lastTradeAt: string | null;
  daysSinceLastTrade: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaperBotState {
  account: PaperBotAccount;
  positions: unknown[];
  recentTrades: unknown[];
  pendingRules: unknown[];
  snapshots: unknown[];
  whyNoTradesToday: string;
  autoresearch: unknown | null;
  disclaimer: string;
  phase: string;
}

export const PAPER_BOT_DISARM_PHRASE = 'ENABLE PAPER TRADES';

export async function fetchPaperBotState(): Promise<PaperBotState> {
  const { data } = await axios.get<PaperBotState>('/paper-bot/state');
  return data;
}

export async function setPaperBotKillSwitch(
  armed: boolean,
  confirmPhrase?: string
): Promise<PaperBotAccount> {
  const { data } = await axios.post<{ account: PaperBotAccount }>('/paper-bot/kill-switch', {
    armed,
    confirmPhrase
  });
  return data.account;
}

export async function setPaperBotSettings(settings: {
  tradeDeployListOnly: boolean;
}): Promise<PaperBotAccount> {
  const { data } = await axios.patch<{ account: PaperBotAccount }>('/paper-bot/settings', settings);
  return data.account;
}
