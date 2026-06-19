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
  autoRunEnabled: boolean;
  lastAutoRunAt: string | null;
  tradeDeployListOnly: boolean;
  universeMode?: PaperBotUniverseMode;
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

export type PaperBotUniverseMode = "curated" | "deploy_list_only" | "quant_auto" | "quant_auto_agent";

export type PaperBotRuntimeStatus = "off" | "running" | "waiting" | "paused";

export interface PaperBotRuntime {
  status: PaperBotRuntimeStatus;
  label: string;
  detail: string;
  botOn: boolean;
  autoRunEnabled: boolean;
  marketOpen: boolean;
  lastAutoRunAt: string | null;
  autoRunIntervalMinutes: number;
  schedulerEnabled: boolean;
}

export interface PaperBotState {
  account: PaperBotAccount;
  botRuntime?: PaperBotRuntime;
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
    universeMode?: PaperBotUniverseMode;
    agentModeEnabled?: boolean;
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

export interface PaperBotAgentDebate {
  symbol: string;
  bull_score?: number;
  bear_score?: number;
  verdict?: string;
  bull_case?: string;
  bear_case?: string;
  summary?: string;
  source?: string;
}

export interface PaperBotAgentTradeIntent {
  action: string;
  symbol?: string;
  urgency?: number;
  reason?: string;
  rationale?: string;
  source?: string;
}

export interface PaperBotDryRunResult {
  skipped: boolean;
  reason: string | null;
  intents: PaperBotIntent[];
  fills: unknown[];
  policyVersion: number;
  appliedPolicy: Record<string, number>;
  agentPlan?: Record<string, unknown> | null;
  regimeLabel?: string | null;
  grokUsed?: boolean;
  debateSummary?: string | null;
  debateResults?: PaperBotAgentDebate[];
  tradeIntents?: PaperBotAgentTradeIntent[];
}

export interface PaperBotAgentPlanHistoryItem {
  id: number;
  createdAt: string;
  regimeLabel?: string | null;
  grokUsed?: boolean;
  rationale?: string | null;
  tradeIntents?: PaperBotAgentTradeIntent[];
  debateSummary?: string | null;
  skipped?: boolean;
}

export interface PaperBotBrainReflection {
  id: number;
  createdAt: string;
  payload: {
    summary?: string;
    insights?: Record<string, unknown>;
    proposalCount?: number;
    grokUsed?: boolean;
  };
}

export interface PaperBotBrainMonitor {
  snapshot: PaperBotPolicySnapshot;
  dryRun: PaperBotDryRunResult;
  agentPlanHistory: PaperBotAgentPlanHistoryItem[];
  lastReflection: PaperBotBrainReflection | null;
  brainPendingRules: PaperBotRule[];
  performance: {
    cumPnlUsd: number;
    agentPlanTicks: number;
    agentTaggedFills: number;
    universeMode: PaperBotUniverseMode;
    tradeCount: number;
    sharpeProxy: number;
    maxDrawdownPct: number;
  };
  disclaimer: string;
}

export interface PaperBotEvent {
  id: number;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface PaperBotShadowOrder {
  id: number;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  priceUsd: number;
  notionalUsd: number;
  reasonTags: string[];
  fillNamespace: string | null;
  killSwitchArmedAtRun: boolean;
  policyVersion?: number;
  createdAt: string;
}

export interface PaperBotShadowPreviewResult {
  skipped: boolean;
  reason: string | null;
  assumedDisarmed: boolean;
  killSwitchArmedAtRun: boolean;
  orders: Array<{
    symbol: string;
    side: string;
    quantity: number;
    priceUsd: number;
    notionalUsd: number;
  }>;
  skippedIntents: PaperBotIntent[];
  orderCount: number;
  policyVersion: number;
  appliedPolicy: Record<string, number>;
}

export type PaperBotSummary = Pick<
  PaperBotAccount,
  "mode" | "killSwitchArmed" | "equityUsd" | "cashUsd" | "tradeDeployListOnly"
> & { phase: string };

function normalizePaperBotState(raw: Partial<PaperBotState>): PaperBotState {
  const account = raw.account as PaperBotAccount;
  return {
    account: {
      ...account,
      autoRunEnabled: account?.autoRunEnabled ?? false,
      lastAutoRunAt: account?.lastAutoRunAt ?? null,
      universeMode:
        account?.universeMode ??
        (account?.tradeDeployListOnly ? "deploy_list_only" : "curated")
    },
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
    phase: raw.phase ?? "4a-autorun",
    botRuntime: (raw.botRuntime as PaperBotRuntime | undefined) ?? DEFAULT_BOT_RUNTIME,
    runDay: raw.runDay
  };
}

const DEFAULT_BOT_RUNTIME: PaperBotRuntime = {
  status: "off",
  label: "Bot OFF",
  detail: "Turn the bot on to run policy automatically during US market hours.",
  botOn: false,
  autoRunEnabled: false,
  marketOpen: false,
  lastAutoRunAt: null,
  autoRunIntervalMinutes: 15,
  schedulerEnabled: true
};

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

export async function setPaperBotRun(
  on: boolean,
  confirmPhrase?: string
): Promise<{ account: PaperBotAccount; botRuntime: PaperBotRuntime }> {
  return paperBotFetch<{ account: PaperBotAccount; botRuntime: PaperBotRuntime }>("/paper-bot/bot-run", {
    method: "POST",
    body: JSON.stringify({ on, confirmPhrase })
  });
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
  tradeDeployListOnly?: boolean;
  universeMode?: PaperBotUniverseMode;
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
  return removePaperBotRule(ruleId);
}

export async function removePaperBotRule(ruleId: number): Promise<PaperBotState> {
  const data = await paperBotFetch<Partial<PaperBotState>>(`/paper-bot/rules/${ruleId}/remove`, {
    method: "POST",
    body: "{}"
  });
  return normalizePaperBotState(data);
}

export async function clearPendingPaperBotRules(): Promise<PaperBotState> {
  const data = await paperBotFetch<Partial<PaperBotState>>("/paper-bot/rules/pending/clear", {
    method: "POST",
    body: "{}"
  });
  return normalizePaperBotState(data);
}

export async function fetchPaperBotPolicySnapshot(): Promise<PaperBotPolicySnapshot> {
  return paperBotFetch<PaperBotPolicySnapshot>("/paper-bot/policy-snapshot");
}

export async function fetchPaperBotBrain(): Promise<PaperBotBrainMonitor> {
  return paperBotFetch<PaperBotBrainMonitor>("/paper-bot/brain");
}

export async function runPaperBotBrainReflection(): Promise<PaperBotBrainMonitor> {
  return paperBotFetch<PaperBotBrainMonitor>("/paper-bot/brain/reflect", {
    method: "POST",
    body: "{}"
  });
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

export async function fetchPaperBotImprovementEvents(limit = 25): Promise<PaperBotEvent[]> {
  const data = await paperBotFetch<{ events: PaperBotEvent[] }>(
    `/paper-bot/events?limit=${limit}&scope=improvement`
  );
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

export interface PaperBotLearningSource {
  title: string;
  url: string;
  snippet?: string;
  source_type?: string;
  query?: string;
}

export interface PaperBotLearningLesson {
  title: string;
  detail?: string;
  source_titles?: string[];
}

export interface PaperBotLearningCoachingDirectives {
  regime_bias?: string;
  entry_posture?: string;
  exit_posture?: string;
  priority_themes?: string[];
  avoid?: string[];
  trusted_symbols?: string[];
}

export interface PaperBotOutcomeGateMetrics {
  cum_pnl_usd?: number;
  cumPnlUsd?: number;
  sharpe_proxy?: number;
  sharpeProxy?: number;
  max_drawdown_pct?: number;
  maxDrawdownPct?: number;
  trade_count?: number;
  tradeCount?: number;
  recorded_at?: string;
}

export interface PaperBotOutcomeGateDelta {
  cum_pnl_usd?: number;
  sharpe_proxy?: number;
  max_drawdown_pct?: number;
  trade_count?: number;
}

/** Evaluation of prior coaching cycle, or current measurement window metadata. */
export interface PaperBotOutcomeGate {
  status: "passed" | "failed" | "pending" | "insufficient_data" | string;
  window_trades?: number;
  trades_since_baseline?: number;
  message?: string | null;
  baseline?: PaperBotOutcomeGateMetrics | null;
  after?: PaperBotOutcomeGateMetrics | null;
  delta?: PaperBotOutcomeGateDelta | null;
  evaluated_at?: string | null;
  apply_note?: string | null;
  previous_cycle?: PaperBotOutcomeGate | null;
}

export interface PaperBotTrustedXTrader {
  id: number;
  xUserId: string;
  username: string;
  label: string;
  createdAt: string;
}

export interface PaperBotXTrustedMeta {
  configured: boolean;
  xSearchOnly?: boolean;
  accounts: Array<{ id?: string; username?: string; label?: string }>;
  tickerBuzz: Array<{ symbol: string; mentions: number }>;
  trustedSymbols: string[];
  warning?: string | null;
}

export interface PaperBotLearningMemory {
  updated_at?: string;
  source?: string;
  summary?: string | null;
  lessons?: PaperBotLearningLesson[];
  agent_hints?: string[];
  coaching_directives?: PaperBotLearningCoachingDirectives;
  proposed_directives?: PaperBotLearningCoachingDirectives;
  effective_directives?: PaperBotLearningCoachingDirectives;
  outcome_gate?: PaperBotOutcomeGate;
  signal_hierarchy?: { rank?: string; coach?: string; x_whisper?: string };
  research_queries?: string[];
  source_count?: number;
  grok_used?: boolean;
}

export interface PaperBotLearningEventPayload {
  summary?: string | null;
  lessons?: PaperBotLearningLesson[];
  agentHints?: string[];
  coachingDirectives?: PaperBotLearningCoachingDirectives;
  trustedSymbols?: string[];
  trustedXAccounts?: Array<{ username?: string; label?: string }>;
  learningMemoryUpdatedAt?: string | null;
  sources?: PaperBotLearningSource[];
  researchQueries?: string[];
  proposalCount?: number;
  grokUsed?: boolean;
  source?: string;
  autoApprovedRuleIds?: number[];
  capabilities?: Record<string, boolean>;
}

export interface PaperBotLearningLatest {
  metrics: PaperBotMetrics;
  nightlyContext: PaperBotNightlyContext;
  capabilities: {
    arxiv?: boolean;
    x?: boolean;
    x_search?: boolean;
    x_monitor?: boolean;
  };
  lastLearning: {
    id: number;
    eventType: string;
    payload: PaperBotLearningEventPayload;
    createdAt: string;
  } | null;
  learningPendingRules: PaperBotRule[];
  activeLearningMemory: PaperBotLearningMemory | null;
  /** Prior coaching cycle evaluation (passed / failed / pending / insufficient_data). */
  outcomeGate: PaperBotOutcomeGate | null;
  /** Live progress toward the next outcome measurement window. */
  outcomeProgress: { windowTrades: number; tradesSinceBaseline: number } | null;
  xTrusted: PaperBotXTrustedMeta;
  trustedTraders: PaperBotTrustedXTrader[];
  maxTrustedTraders: number;
  autoLearning: {
    schedulerEnabled: boolean;
    runsWhenBotOn: boolean;
    autoApproveTightening: boolean;
    intervalHours: number;
    lastAutoLearningAt: string | null;
    marketOpen: boolean;
    botOn: boolean;
  };
  asOf: string;
  disclaimer: string;
}

export async function fetchPaperBotLearningLatest(): Promise<PaperBotLearningLatest> {
  return paperBotFetch<PaperBotLearningLatest>("/paper-bot/learning/latest");
}

export async function runPaperBotLearningCycle(): Promise<PaperBotLearningLatest> {
  return paperBotFetch<PaperBotLearningLatest>("/paper-bot/learning/run", {
    method: "POST",
    body: "{}"
  });
}

export async function addPaperBotTrustedTrader(body: {
  username: string;
  label?: string;
}): Promise<PaperBotTrustedXTrader> {
  const data = await paperBotFetch<{ trader: PaperBotTrustedXTrader }>("/paper-bot/learning/trusted-traders", {
    method: "POST",
    body: JSON.stringify(body)
  });
  return data.trader;
}

export async function removePaperBotTrustedTrader(id: number): Promise<void> {
  await paperBotFetch<{ ok: boolean }>(`/paper-bot/learning/trusted-traders/${id}`, {
    method: "DELETE"
  });
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

export async function runPaperBotShadowPreview(): Promise<PaperBotShadowPreviewResult> {
  return paperBotFetch<PaperBotShadowPreviewResult>("/paper-bot/shadow-run", {
    method: "POST",
    body: "{}"
  });
}

export async function fetchPaperBotShadowOrders(limit = 15): Promise<PaperBotShadowOrder[]> {
  const data = await paperBotFetch<{ orders: PaperBotShadowOrder[] }>(
    `/paper-bot/shadow-orders?limit=${limit}`
  );
  return Array.isArray(data.orders) ? data.orders : [];
}
