"use client";

import { useEffect } from "react";
import { getQuantAgiBaseUrl } from "../lib/quantBase";
import { quantAuthedFetch } from "../lib/quantAuth";
import { LatestPatch, QuantEvent, QuantScorecard, useQuantStore } from "../lib/store";

export function StreamBootstrap() {
  const replaceEvents = useQuantStore((s) => s.replaceEvents);
  const setLatestPatch = useQuantStore((s) => s.setLatestPatch);
  const setScorecard = useQuantStore((s) => s.setScorecard);
  const setConnected = useQuantStore((s) => s.setConnected);

  useEffect(() => {
    const pullFeed = async () => {
      const base = getQuantAgiBaseUrl();
      try {
        const res = await quantAuthedFetch(`${base}/diag/terminal-feed?limit=20`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        const events = Array.isArray(payload.events)
          ? (payload.events as Array<Partial<QuantEvent>>).map((e, idx) => ({
              id: String(e.id || `live-${idx}`),
              ts: typeof e.ts === "string" ? e.ts : new Date().toISOString(),
              type: (e.type as QuantEvent["type"]) || "experiment_run",
              title: String(e.title || "Autoresearch event"),
              detail: String(e.detail || ""),
              commitSha: e.commitSha,
              state: e.state,
              sharpeDelta: typeof e.sharpeDelta === "number" ? e.sharpeDelta : undefined,
              drawdownDelta: typeof e.drawdownDelta === "number" ? e.drawdownDelta : undefined
            }))
          : [];
        replaceEvents(events);
        setLatestPatch((payload.latestPatch ?? null) as LatestPatch | null);

        const scorecardRes = await quantAuthedFetch(`${base}/diag/scorecard?window=60`, {
          cache: "no-store"
        });
        if (scorecardRes.ok) {
          const scorePayload = await scorecardRes.json();
          const scorecard: QuantScorecard = {
            window: typeof scorePayload.window === "number" ? scorePayload.window : 60,
            tested_experiments:
              typeof scorePayload.tested_experiments === "number" ? scorePayload.tested_experiments : 0,
            improved_experiments:
              typeof scorePayload.improved_experiments === "number" ? scorePayload.improved_experiments : 0,
            promotion_rate: typeof scorePayload.promotion_rate === "number" ? scorePayload.promotion_rate : 0,
            avg_sharpe_delta:
              typeof scorePayload.avg_sharpe_delta === "number" ? scorePayload.avg_sharpe_delta : 0,
            avg_winrate_delta:
              typeof scorePayload.avg_winrate_delta === "number" ? scorePayload.avg_winrate_delta : 0
          };
          setScorecard(scorecard);
        }

        setConnected(true);
      } catch {
        setConnected(false);
        replaceEvents([]);
        setLatestPatch(null);
        setScorecard(null);
      }
    };

    void pullFeed();
    const id = setInterval(() => void pullFeed(), 8000);
    return () => {
      clearInterval(id);
      setConnected(false);
    };
  }, [replaceEvents, setConnected, setLatestPatch, setScorecard]);

  return null;
}
