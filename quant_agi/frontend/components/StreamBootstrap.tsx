"use client";

import { useEffect } from "react";
import { getQuantAgiBaseUrl } from "../lib/quantBase";
import { quantAuthedFetch } from "../lib/quantAuth";
import {
  LatestPatch,
  MarketSymbolSnapshot,
  QuantEvent,
  QuantScorecard,
  useQuantStore
} from "../lib/store";

function randomEvent(index: number): QuantEvent {
  const states: Array<NonNullable<QuantEvent["state"]>> = ["proposed", "tested", "approved", "deployed", "rejected"];
  const typeByState: Record<NonNullable<QuantEvent["state"]>, QuantEvent["type"]> = {
    proposed: "code_update_proposed",
    tested: "experiment_run",
    approved: "promotion",
    deployed: "promotion",
    rejected: "risk"
  };
  const state = states[Math.floor(Math.random() * states.length)];
  return {
    id: `sim-${Date.now()}-${index}`,
    ts: new Date().toISOString(),
    type: typeByState[state],
    title: `Autoresearch cycle ${index}`,
    detail: "Synthetic stream event. Replace with SSE/WebSocket payload from Quant AGI backend.",
    state,
    commitSha: `exp-${Math.random().toString(16).slice(2, 9)}`,
    promptHash: Math.random().toString(16).slice(2, 10),
    sharpeDelta: Number((Math.random() * 0.25 - 0.05).toFixed(2)),
    drawdownDelta: Number((Math.random() * 1.4 - 0.8).toFixed(2))
  };
}

export function StreamBootstrap() {
  const hydrateMockData = useQuantStore((s) => s.hydrateMockData);
  const ingest = useQuantStore((s) => s.ingest);
  const replaceEvents = useQuantStore((s) => s.replaceEvents);
  const setLatestPatch = useQuantStore((s) => s.setLatestPatch);
  const setMarket = useQuantStore((s) => s.setMarket);
  const setScorecard = useQuantStore((s) => s.setScorecard);
  const setConnected = useQuantStore((s) => s.setConnected);

  useEffect(() => {
    hydrateMockData();
    let hasLiveData = false;

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

        const marketRes = await quantAuthedFetch(
          `${base}/diag/market-snapshot?symbols=AAPL,NVDA,MSFT,TSLA,SPY`,
          { cache: "no-store" }
        );
        if (marketRes.ok) {
          const marketPayload = await marketRes.json();
          const symbols: MarketSymbolSnapshot[] = Array.isArray(marketPayload.symbols)
            ? (marketPayload.symbols as Array<Partial<MarketSymbolSnapshot>>).map((row) => ({
                symbol: String(row.symbol || ""),
                asset_type: row.asset_type === "crypto" ? ("crypto" as const) : ("stock" as const),
                history_source: String(row.history_source || "unknown"),
                rows: typeof row.rows === "number" ? row.rows : 0,
                last_close: typeof row.last_close === "number" ? row.last_close : null,
                prev_close: typeof row.prev_close === "number" ? row.prev_close : null,
                pct_change: typeof row.pct_change === "number" ? row.pct_change : null,
                as_of: typeof row.as_of === "string" ? row.as_of : null,
                is_live_massive: Boolean(row.is_live_massive)
              }))
            : [];
          setMarket(symbols);
        }

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
        hasLiveData = true;
      } catch {
        setConnected(false);
        if (!hasLiveData) {
          ingest(randomEvent(Math.floor(Math.random() * 10_000)));
        }
      }
    };

    pullFeed();

    const id = setInterval(() => {
      pullFeed();
    }, 8000);

    return () => {
      clearInterval(id);
      setConnected(false);
    };
  }, [
    hydrateMockData,
    ingest,
    replaceEvents,
    setConnected,
    setLatestPatch,
    setMarket,
    setScorecard
  ]);

  return null;
}
