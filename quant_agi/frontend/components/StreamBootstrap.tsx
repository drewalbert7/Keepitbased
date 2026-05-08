"use client";

import { useEffect } from "react";
import { getQuantAgiBaseUrl } from "../lib/quantBase";
import {
  LatestPatch,
  MarketSymbolSnapshot,
  QuantEvent,
  QuantScorecard,
  QuantSuggestedPosition,
  RankMeta,
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
  const setSuggestions = useQuantStore((s) => s.setSuggestions);
  const setRankMeta = useQuantStore((s) => s.setRankMeta);
  const setScorecard = useQuantStore((s) => s.setScorecard);
  const setConnected = useQuantStore((s) => s.setConnected);

  useEffect(() => {
    hydrateMockData();
    let hasLiveData = false;

    const pullFeed = async () => {
      const base = getQuantAgiBaseUrl();
      try {
        const res = await fetch(`${base}/diag/terminal-feed?limit=20`, { cache: "no-store" });
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

        const marketRes = await fetch(
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

        const rankedRes = await fetch(`${base}/diag/market-universe-rank?top_n=25`, {
          cache: "no-store"
        });
        if (rankedRes.ok) {
          const rankedPayload = await rankedRes.json();
          const positions: QuantSuggestedPosition[] = Array.isArray(rankedPayload.positions)
            ? (rankedPayload.positions as Array<Partial<QuantSuggestedPosition>>).map((row) => ({
                symbol: String(row.symbol || ""),
                asset_type: row.asset_type === "crypto" ? ("crypto" as const) : ("stock" as const),
                score: typeof row.score === "number" ? row.score : 0,
                last_close: typeof row.last_close === "number" ? row.last_close : null,
                day_change_pct: typeof row.day_change_pct === "number" ? row.day_change_pct : null,
                momentum_20d_pct: typeof row.momentum_20d_pct === "number" ? row.momentum_20d_pct : 0,
                vol_20d_pct: typeof row.vol_20d_pct === "number" ? row.vol_20d_pct : 0,
                drawdown_60d_pct: typeof row.drawdown_60d_pct === "number" ? row.drawdown_60d_pct : 0,
                avg_dollar_vol_20d:
                  typeof row.avg_dollar_vol_20d === "number" ? row.avg_dollar_vol_20d : null,
                history_source: String(row.history_source || "unknown"),
                is_live_massive: Boolean(row.is_live_massive),
                as_of: typeof row.as_of === "string" ? row.as_of : null,
                why: Array.isArray(row.why) ? row.why.map((x) => String(x)) : [],
                position_hint: String(row.position_hint || "watch candidate")
              }))
            : [];
          setSuggestions(positions);

          const meta: RankMeta = {
            accepted_count: typeof rankedPayload.accepted_count === "number" ? rankedPayload.accepted_count : 0,
            excluded_count: typeof rankedPayload.excluded_count === "number" ? rankedPayload.excluded_count : 0,
            excluded_counts: {
              price_below_min:
                typeof rankedPayload?.excluded_counts?.price_below_min === "number"
                  ? rankedPayload.excluded_counts.price_below_min
                  : 0,
              liquidity_below_min:
                typeof rankedPayload?.excluded_counts?.liquidity_below_min === "number"
                  ? rankedPayload.excluded_counts.liquidity_below_min
                  : 0,
              insufficient_history:
                typeof rankedPayload?.excluded_counts?.insufficient_history === "number"
                  ? rankedPayload.excluded_counts.insufficient_history
                  : 0
            },
            min_price:
              typeof rankedPayload?.liquidity_gate?.min_price === "number"
                ? rankedPayload.liquidity_gate.min_price
                : 0,
            min_avg_dollar_vol_20d:
              typeof rankedPayload?.liquidity_gate?.min_avg_dollar_vol_20d === "number"
                ? rankedPayload.liquidity_gate.min_avg_dollar_vol_20d
                : 0
          };
          setRankMeta(meta);
        }

        const scorecardRes = await fetch(`${base}/diag/scorecard?window=60`, {
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
    setRankMeta,
    setScorecard,
    setSuggestions
  ]);

  return null;
}
