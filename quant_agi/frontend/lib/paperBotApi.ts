import { getKeepItBasedJwt } from "./quantAuth";

export const PAPER_BOT_DISARM_PHRASE = "ENABLE PAPER TRADES";

export interface PaperBotAccount {
  userId: number;
  startingCashUsd: number;
  cashUsd: number;
  equityUsd: number;
  dayPnlUsd: number;
  cumPnlUsd: number;
  openRiskPct: number;
  mode: "paper" | "shadow" | "live";
  killSwitchArmed: boolean;
  tradeDeployListOnly: boolean;
  policyVersion: number;
  lastTradeAt: string | null;
  daysSinceLastTrade: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaperBotPosition {
  symbol: string;
  assetType: string;
  quantity: number;
  avgCostUsd: number;
  lastPriceUsd: number | null;
  marketValueUsd: number;
  unrealizedPnlUsd: number;
}

export interface PaperBotTrade {
  id: number;
  symbol: string;
  assetType: string;
  side: "buy" | "sell";
  quantity: number;
  priceUsd: number;
  notionalUsd: number;
  reasonTags: string[];
  reasonJson?: Record<string, unknown>;
  policyVersion: number;
  createdAt: string;
}

export interface PaperBotSnapshot {
  snapshotDate: string;
  equityUsd: number;
  cashUsd: number;
  dayPnlUsd: number;
  cumPnlUsd: number;
}

export interface PaperBotRule {
  id: number;
  source: "user" | "bot_suggested" | "autoresearch";
  status: "pending" | "active" | "dismissed";
  ruleText: string;
  ruleJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PaperBotState {
  account: PaperBotAccount;
  positions: PaperBotPosition[];
  recentTrades: PaperBotTrade[];
  pendingRules: PaperBotRule[];
  activeRules: PaperBotRule[];
  snapshots: PaperBotSnapshot[];
  whyNoTradesToday: string | null;
  autoresearch: unknown | null;
  disclaimer: string;
  phase: string;
  runDay?: { skipped: boolean; reason?: string; fillCount?: number };
}

export interface PaperBotPolicySnapshot {
  policyVersion: number;
  precedence: string;
  mergedPolicy: Record<string, number>;
  activeRules: PaperBotRule[];
  gates: {
    killSwitchArmed: boolean;
    tradeDeployListOnly: boolean;
    cashUsd: number;
    cashHeadroomUsd: number;
    openPositions: number;
    maxOpenPositions: number;
  };
  universe: {
    source: string;
    symbolCount: number;
    symbolsSample: string[];
  };
  inputSignals: {
    rankLeaders: Array<{
      strategy: string;
      leaders: Array<{ symbol: string; score: number }>;
      error?: string;
    }>;
    regimeLabel: string | null;
  };
  disclaimer: string;
}

export interface PaperBotIntent {
  symbol?: string;
  action: "buy" | "skip" | "blocked";
  side?: string;
  reason?: string;
  detail?: string;
  quantity?: number;
  priceUsd?: number;
  notionalUsd?: number;
  target_weight_pct?: number;
  reason_tags?: string[];
  reason_json?: Record<string, unknown>;
}

export interface PaperBotDryRunResult {
  skipped: boolean;
  reason: string | null;
  intents: PaperBotIntent[];
  fills: unknown[];
  policyVersion: number;
  appliedPolicy: Record<string, number>;
}

export interface PaperBotEvent {
  id: number;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type PaperBotSummary = Pick<
  PaperBotAccount,
  "mode" | "killSwitchArmed" | "equityUsd" | "cashUsd" | "tradeDeployListOnly"
> & { phase: string };

function normalizePaperBotState(raw: Partial<PaperBotState>): PaperBotState {
  return {
    account: raw.account as PaperBotAccount,
    positions: Array.isArray(raw.positions) ? raw.positions : [],
    recentTrades: Array.isArray(raw.recentTrades) ? raw.recentTrades : [],
    pendingRules: Array.isArray(raw.pendingRules) ? raw.pendingRules : [],
    activeRules: Array.isArray(raw.activeRules) ? raw.activeRules : [],
    snapshots: Array.isArray(raw.snapshots) ? raw.snapshots : [],
    whyNoTradesToday: raw.whyNoTradesToday ?? null,
    autoresearch: raw.autoresearch ?? null,
    disclaimer:
      raw.disclaimer ??
      "Educational paper simulation only — not investment advice. No brokerage orders are placed.",
    phase: raw.phase ?? "3-autoresearch",
    runDay: raw.runDay
  };
}

function apiBase(): string {
  if (typeof window === "undefined") return "/api";
  const { protocol, hostname } = window.location;
  if (hostname === "app.keepitbased.com" || hostname === "localhost") {
    return `${protocol}//${hostname}/api`;
  }
  return "/api";
}

async function paperBotFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getKeepItBasedJwt();
  if (!token) {
    throw new Error("Sign in on the main app to use Quant AGI Bot.");
  }

  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {})
    },
    credentials: "same-origin",
    cache: "no-store"
  });

  let data: { message?: string } = {};
  try {
    data = (await res.json()) as { message?: string };
  } catch {
    /* non-json */
  }

  if (!res.ok) {
    throw new Error(data.message || `Request failed (${res.status})`);
  }

  return data as T;
}

export async function fetchPaperBotSummary(): Promise<PaperBotSummary | null> {
  try {
    const state = await fetchPaperBotState();
    return {
      mode: state.account.mode,
      killSwitchArmed: state.account.killSwitchArmed,
      equityUsd: state.account.equityUsd,
      cashUsd: state.account.cashUsd,
      tradeDeployListOnly: state.account.tradeDeployListOnly,
      phase: state.phase
    };
  } catch {
    return null;
  }
}

export async function fetchPaperBotState(): Promise<PaperBotState> {
  const data = await paperBotFetch<Partial<PaperBotState>>("/paper-bot/state");
  return normalizePaperBotState(data);
}

export async function setPaperBotKillSwitch(
  armed: boolean,
  confirmPhrase?: string
): Promise<PaperBotAccount> {
  const data = await paperBotFetch<{ account: PaperBotAccount }>("/paper-bot/kill-switch", {
    method: "POST",
    body: JSON.stringify({ armed, confirmPhrase })
  });
  return data.account;
}

export async function setPaperBotSettings(settings: {
  tradeDeployListOnly: boolean;
}): Promise<PaperBotAccount> {
  const data = await paperBotFetch<{ account: PaperBotAccount }>("/paper-bot/settings", {
    method: "PATCH",
    body: JSON.stringify(settings)
  });
  return data.account;
}

export async function simulatePaperBotDay(): Promise<PaperBotState> {
  const data = await paperBotFetch<Partial<PaperBotState>>("/paper-bot/simulate-day", {
    method: "POST",
    body: "{}"
  });
  return normalizePaperBotState(data);
}

export async function submitPaperBotNote(note: string): Promise<PaperBotState> {
  const data = await paperBotFetch<Partial<PaperBotState>>("/paper-bot/notes", {
    method: "POST",
    body: JSON.stringify({ note })
  });
  return normalizePaperBotState(data);
}

export async function approvePaperBotRule(ruleId: number): Promise<PaperBotState> {
  const data = await paperBotFetch<Partial<PaperBotState>>(`/paper-bot/rules/${ruleId}/approve`, {
    method: "POST",
    body: "{}"
  });
  return normalizePaperBotState(data);
}

export async function dismissPaperBotRule(ruleId: number): Promise<PaperBotState> {
  const data = await paperBotFetch<Partial<PaperBotState>>(`/paper-bot/rules/${ruleId}/dismiss`, {
    method: "POST",
    body: "{}"
  });
  return normalizePaperBotState(data);
}

export async function fetchPaperBotPolicySnapshot(): Promise<PaperBotPolicySnapshot> {
  return paperBotFetch<PaperBotPolicySnapshot>("/paper-bot/policy-snapshot");
}

export async function runPaperBotDryRun(): Promise<PaperBotDryRunResult> {
  return paperBotFetch<PaperBotDryRunResult>("/paper-bot/dry-run", {
    method: "POST",
    body: "{}"
  });
}

export async function fetchPaperBotEvents(limit = 15): Promise<PaperBotEvent[]> {
  const data = await paperBotFetch<{ events: PaperBotEvent[] }>(`/paper-bot/events?limit=${limit}`);
  return Array.isArray(data.events) ? data.events : [];
}

export interface PaperBotMetrics {
  startingCashUsd: number;
  equityUsd: number;
  cumPnlUsd: number;
  paperDays: number;
  tradeCount: number;
  sharpeProxy: number;
  sharpe7d: number;
  sharpeHoldout5dDelta: number;
  maxDrawdownPct: number;
}

export interface PaperBotPromotionGate {
  id: string;
  label: string;
  pass: boolean;
  actual: number;
  required: number;
}

export interface PaperBotPromotionStatus {
  gates: PaperBotPromotionGate[];
  passedCount: number;
  totalCount: number;
  promotionReady: boolean;
}

export interface PaperBotAutoresearchExperiment {
  id: number;
  branch: string;
  commitSha: string | null;
  improved: boolean;
  sharpeDelta: number | null;
  rejectionReason: string | null;
  createdAt: string | null;
}

export interface PaperBotAutoresearchScorecard {
  testedExperiments: number;
  improvedExperiments: number;
  promotionRate: number;
  avgSharpeDelta: number;
}

export interface PaperBotNightlyContext {
  equityUsd: number;
  cumPnlUsd: number;
  paperDays: number;
  tradeCount: number;
  winRateDays: number;
  worstDay: { snapshotDate: string; dayPnlUsd: number } | null;
  symbolsTraded: Array<{ symbol: string; fills: number }>;
  topReasonTags: Array<{ tag: string; count: number }>;
}

export interface PaperBotWalkForward {
  symbolsRequested: number;
  symbolsEvaluated: number;
  holdoutDays: number;
  avgHoldoutSharpeDelta: number;
  pass: boolean;
  reason: string | null;
  perSymbol: Array<Record<string, unknown>>;
}

export interface PaperBotResetCooldown {
  blocked: boolean;
  hoursRemaining: number;
}

export interface PaperBotPatchPreview {
  commitSha: string | null;
  createdAt: string | null;
  patchPreview: string;
  truncated: boolean;
}

export interface PaperBotAutoresearchLatest {
  metrics: PaperBotMetrics;
  nightlyContext: PaperBotNightlyContext;
  walkForward: PaperBotWalkForward | null;
  resetCooldown: PaperBotResetCooldown;
  promotion: PaperBotPromotionStatus;
  latestExperiment: PaperBotAutoresearchExperiment | null;
  autoresearchScorecard: PaperBotAutoresearchScorecard | null;
  latestPatch: PaperBotPatchPreview | null;
  asOf: string;
}

export interface PaperBotPromoteResult {
  ok: boolean;
  sourceSha: string;
  promotedSha: string;
  branch: string;
  files: string[];
  promotion: PaperBotPromotionStatus;
}

export async function fetchPaperBotAutoresearchLatest(): Promise<PaperBotAutoresearchLatest> {
  return paperBotFetch<PaperBotAutoresearchLatest>("/paper-bot/autoresearch/latest");
}

export async function promotePaperBotAutoresearchPatch(body: {
  commitSha: string;
  experimentId?: number;
}): Promise<PaperBotPromoteResult> {
  return paperBotFetch<PaperBotPromoteResult>("/paper-bot/autoresearch/promote", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function resetPaperBotAccount(): Promise<PaperBotState> {
  const data = await paperBotFetch<Partial<PaperBotState>>("/paper-bot/reset", {
    method: "POST",
    body: "{}"
  });
  return normalizePaperBotState(data);
}
