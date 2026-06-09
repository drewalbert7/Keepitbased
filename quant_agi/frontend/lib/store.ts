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
  replaceEvents: (events: QuantEvent[]) => void;
  latestPatch: LatestPatch | null;
  setLatestPatch: (patch: LatestPatch | null) => void;
  scorecard: QuantScorecard | null;
  setScorecard: (scorecard: QuantScorecard | null) => void;
  setConnected: (v: boolean) => void;
};

export const useQuantStore = create<QuantState>((set) => ({
  events: [],
  connected: false,
  latestPatch: null,
  scorecard: null,
  setConnected: (v) => set({ connected: v }),
  replaceEvents: (events) => set({ events }),
  setLatestPatch: (patch) => set({ latestPatch: patch }),
  setScorecard: (scorecard) => set({ scorecard })
}));
