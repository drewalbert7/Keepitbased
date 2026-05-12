"use client";

import { create } from "zustand";

export type PromotionState = "proposed" | "tested" | "approved" | "deployed" | "rejected";

export type QuantEvent = {
  id: string;
  ts: string;
  type: "code_update_proposed" | "experiment_run" | "backtest_result" | "promotion" | "risk";
  title: string;
  detail: string;
  symbol?: string;
  model?: string;
  promptHash?: string;
  commitSha?: string;
  state?: PromotionState;
  sharpeDelta?: number;
  drawdownDelta?: number;
};

export type LatestPatch = {
  commitSha: string;
  createdAt?: string | null;
  patch: string;
  truncated?: boolean;
};

export type MarketSymbolSnapshot = {
  symbol: string;
  asset_type: "stock" | "crypto";
  history_source: string;
  rows: number;
  last_close: number | null;
  prev_close: number | null;
  pct_change: number | null;
  as_of: string | null;
  is_live_massive: boolean;
};

export type RankStrategyId = "momentum_liquidity" | "photonics_chokepoint" | "rule_breaker_gardner";

export type RuleBreakerBreakdownRow = {
  element_key: string;
  book_criterion: string;
  score_0_100: number;
  weight: number;
  weighted_contribution: number;
};

export type QuantSuggestedPosition = {
  symbol: string;
  asset_type: "stock" | "crypto";
  score: number;
  last_close: number | null;
  day_change_pct: number | null;
  momentum_20d_pct: number;
  vol_20d_pct: number;
  drawdown_60d_pct: number;
  avg_dollar_vol_20d?: number | null;
  history_source: string;
  is_live_massive: boolean;
  as_of: string | null;
  why: string[];
  position_hint: string;
  strategy_factors?: Record<string, unknown>;
};

export type RankMeta = {
  accepted_count: number;
  excluded_count: number;
  excluded_counts: {
    price_below_min: number;
    liquidity_below_min: number;
    insufficient_history: number;
  };
  min_price: number;
  min_avg_dollar_vol_20d: number;
};

export type RankStrategyMeta = {
  id: RankStrategyId;
  label: string;
  disclaimer: string;
};

export type QuantScorecard = {
  window: number;
  tested_experiments: number;
  improved_experiments: number;
  promotion_rate: number;
  avg_sharpe_delta: number;
  avg_winrate_delta: number;
};

type QuantState = {
  events: QuantEvent[];
  connected: boolean;
  mode: "paper" | "shadow" | "live";
  killSwitch: boolean;
  setConnected: (v: boolean) => void;
  setMode: (mode: "paper" | "shadow" | "live") => void;
  toggleKillSwitch: () => void;
  ingest: (e: QuantEvent) => void;
  replaceEvents: (events: QuantEvent[]) => void;
  latestPatch: LatestPatch | null;
  setLatestPatch: (patch: LatestPatch | null) => void;
  market: MarketSymbolSnapshot[];
  setMarket: (rows: MarketSymbolSnapshot[]) => void;
  suggestions: QuantSuggestedPosition[];
  setSuggestions: (rows: QuantSuggestedPosition[]) => void;
  rankMeta: RankMeta | null;
  setRankMeta: (meta: RankMeta | null) => void;
  scorecard: QuantScorecard | null;
  setScorecard: (scorecard: QuantScorecard | null) => void;
  rankStrategyId: RankStrategyId;
  setRankStrategyId: (id: RankStrategyId) => void;
  rankStrategyMeta: RankStrategyMeta | null;
  setRankStrategyMeta: (meta: RankStrategyMeta | null) => void;
  hydrateMockData: () => void;
};

const sampleEvents: QuantEvent[] = [
  {
    id: "evt-1",
    ts: new Date(Date.now() - 1000 * 60 * 40).toISOString(),
    type: "code_update_proposed",
    title: "Allocator cap retune",
    detail: "Candidate patch proposes tighter max notional in high-vol regime.",
    symbol: "BTCUSD",
    model: "grok-3",
    promptHash: "f7c921ac",
    commitSha: "exp-4a911c2",
    state: "proposed"
  },
  {
    id: "evt-2",
    ts: new Date(Date.now() - 1000 * 60 * 31).toISOString(),
    type: "experiment_run",
    title: "Nightly simulation completed",
    detail: "Walk-forward run across 90 sessions with spread stress test.",
    sharpeDelta: 0.18,
    drawdownDelta: -0.9,
    state: "tested"
  },
  {
    id: "evt-3",
    ts: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
    type: "promotion",
    title: "Patch approved",
    detail: "CI + policy checks green. Queued for shadow deployment.",
    commitSha: "exp-4a911c2",
    state: "approved"
  }
];

export const useQuantStore = create<QuantState>((set) => ({
  events: [],
  connected: false,
  mode: "paper",
  killSwitch: true,
  latestPatch: null,
  market: [],
  suggestions: [],
  rankMeta: null,
  scorecard: null,
  rankStrategyId: "momentum_liquidity",
  rankStrategyMeta: null,
  setConnected: (v) => set({ connected: v }),
  setMode: (mode) => set({ mode }),
  toggleKillSwitch: () => set((s) => ({ killSwitch: !s.killSwitch })),
  ingest: (event) =>
    set((s) => ({
      events: [event, ...s.events].slice(0, 80)
    })),
  replaceEvents: (events) => set({ events }),
  setLatestPatch: (patch) => set({ latestPatch: patch }),
  setMarket: (rows) => set({ market: rows }),
  setSuggestions: (rows) => set({ suggestions: rows }),
  setRankMeta: (rankMeta) => set({ rankMeta }),
  setScorecard: (scorecard) => set({ scorecard }),
  setRankStrategyId: (rankStrategyId) => set({ rankStrategyId }),
  setRankStrategyMeta: (rankStrategyMeta) => set({ rankStrategyMeta }),
  hydrateMockData: () => set({ events: sampleEvents })
}));

