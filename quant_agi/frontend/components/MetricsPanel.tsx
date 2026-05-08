"use client";

import { useMemo } from "react";
import { useQuantStore } from "../lib/store";

export function MetricsPanel() {
  const events = useQuantStore((s) => s.events);
  const scorecard = useQuantStore((s) => s.scorecard);
  const rankMeta = useQuantStore((s) => s.rankMeta);

  const metrics = useMemo(() => {
    const tested = events.filter((e) => e.state === "tested" || e.type === "backtest_result");
    const sharpe = tested.map((e) => e.sharpeDelta ?? 0).reduce((a, b) => a + b, 0);
    const drawdown = tested.map((e) => e.drawdownDelta ?? 0).reduce((a, b) => a + b, 0);
    const deployed = events.filter((e) => e.state === "deployed").length;
    const rejected = events.filter((e) => e.state === "rejected").length;
    return { sharpe, drawdown, deployed, rejected };
  }, [events]);

  return (
    <section className="rounded-2xl border border-white/10 bg-panel/70 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/70">Impact and risk</h2>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border border-white/10 bg-panelAlt/70 p-3">
          <p className="text-white/60">Sharpe delta</p>
          <p className="text-xl font-semibold text-mint">{metrics.sharpe.toFixed(2)}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-panelAlt/70 p-3">
          <p className="text-white/60">Drawdown delta</p>
          <p className="text-xl font-semibold text-warn">{metrics.drawdown.toFixed(2)}%</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-panelAlt/70 p-3">
          <p className="text-white/60">Promoted</p>
          <p className="text-xl font-semibold text-white">{metrics.deployed}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-panelAlt/70 p-3">
          <p className="text-white/60">Rejected</p>
          <p className="text-xl font-semibold text-danger">{metrics.rejected}</p>
        </div>
      </div>
      {scorecard && (
        <div className="mt-3 rounded-xl border border-cyan-500/20 bg-black/20 p-3">
          <p className="mb-2 text-xs uppercase tracking-wider text-cyan-200/80">Canonical scorecard</p>
          <div className="grid grid-cols-2 gap-2 text-xs text-white/80">
            <p>Window: {scorecard.window}</p>
            <p>Tested: {scorecard.tested_experiments}</p>
            <p>Improved: {scorecard.improved_experiments}</p>
            <p>Promotion rate: {(scorecard.promotion_rate * 100).toFixed(1)}%</p>
            <p>Avg Sharpe d: {scorecard.avg_sharpe_delta.toFixed(3)}</p>
            <p>Avg Winrate d: {(scorecard.avg_winrate_delta * 100).toFixed(2)}pp</p>
          </div>
        </div>
      )}
      {rankMeta && (
        <p className="mt-3 text-xs text-white/60">
          Liquidity exclusions: {rankMeta.excluded_counts.liquidity_below_min} liquidity,{" "}
          {rankMeta.excluded_counts.price_below_min} price, {rankMeta.excluded_counts.insufficient_history} history.
        </p>
      )}
    </section>
  );
}
