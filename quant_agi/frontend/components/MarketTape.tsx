"use client";

import { useState } from "react";
import { type RankStrategyId, type RuleBreakerBreakdownRow, useQuantStore } from "../lib/store";

function ruleBreakerBreakdown(factors: Record<string, unknown> | undefined): RuleBreakerBreakdownRow[] {
  if (!factors || factors.kind !== "rule_breaker_gardner") return [];
  const raw = factors.breakdown;
  if (!Array.isArray(raw)) return [];
  const out: RuleBreakerBreakdownRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const element_key = String(o.element_key ?? "");
    const book_criterion = String(o.book_criterion ?? "");
    const score_0_100 = typeof o.score_0_100 === "number" ? o.score_0_100 : Number(o.score_0_100);
    const weight = typeof o.weight === "number" ? o.weight : Number(o.weight);
    const weighted_contribution =
      typeof o.weighted_contribution === "number" ? o.weighted_contribution : Number(o.weighted_contribution);
    if (!element_key || !Number.isFinite(score_0_100)) continue;
    out.push({
      element_key,
      book_criterion,
      score_0_100,
      weight: Number.isFinite(weight) ? weight : 0,
      weighted_contribution: Number.isFinite(weighted_contribution) ? weighted_contribution : 0
    });
  }
  return out;
}

function pctClass(v: number | null) {
  if (v == null) return "text-white/60";
  if (v > 0) return "text-mint";
  if (v < 0) return "text-danger";
  return "text-white/60";
}

async function addToWatchlist(symbol: string): Promise<void> {
  const res = await fetch("/api/watchlist/symbols", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ symbol, assetType: "stock" }),
    cache: "no-store"
  });
  if (!res.ok) {
    let message = `Failed to add ${symbol} (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // keep default
    }
    throw new Error(message);
  }
}

export function MarketTape() {
  const suggestions = useQuantStore((s) => s.suggestions);
  const rankMeta = useQuantStore((s) => s.rankMeta);
  const rankStrategyId = useQuantStore((s) => s.rankStrategyId);
  const setRankStrategyId = useQuantStore((s) => s.setRankStrategyId);
  const rankStrategyMeta = useQuantStore((s) => s.rankStrategyMeta);
  const [adding, setAdding] = useState<Record<string, boolean>>({});
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const onAdd = async (symbol: string) => {
    setError(null);
    setAdding((s) => ({ ...s, [symbol]: true }));
    try {
      await addToWatchlist(symbol);
      setAdded((s) => ({ ...s, [symbol]: true }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : `Failed to add ${symbol}`;
      setError(msg);
    } finally {
      setAdding((s) => ({ ...s, [symbol]: false }));
    }
  };

  const onStrategyChange = (id: RankStrategyId) => setRankStrategyId(id);

  return (
    <section className="rounded-2xl border border-white/10 bg-panel/70 p-3">
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-white/70">
            Quant AGI stock suggestions
          </h2>
          <p className="mt-1 text-[11px] text-white/50">
            {rankStrategyMeta?.label || "Preset strategy rank — educational tooling only"}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1">
          <button
            type="button"
            onClick={() => onStrategyChange("momentum_liquidity")}
            className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
              rankStrategyId === "momentum_liquidity"
                ? "border-cyan-500/70 bg-cyan-500/20 text-cyan-100"
                : "border-white/15 bg-black/25 text-white/70 hover:bg-white/5"
            }`}
          >
            Momentum / liquidity
          </button>
          <button
            type="button"
            onClick={() => onStrategyChange("photonics_chokepoint")}
            className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
              rankStrategyId === "photonics_chokepoint"
                ? "border-violet-500/70 bg-violet-500/20 text-violet-100"
                : "border-white/15 bg-black/25 text-white/70 hover:bg-white/5"
            }`}
          >
            AI photonics chokepoint
          </button>
          <button
            type="button"
            onClick={() => onStrategyChange("rule_breaker_gardner")}
            className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
              rankStrategyId === "rule_breaker_gardner"
                ? "border-amber-500/70 bg-amber-500/15 text-amber-100"
                : "border-white/15 bg-black/25 text-white/70 hover:bg-white/5"
            }`}
          >
            Rule Breaker (Gardner)
          </button>
        </div>
      </div>
      {rankStrategyMeta?.disclaimer && (
        <p className="mb-2 rounded-md border border-white/10 bg-black/30 p-2 text-[10px] leading-relaxed text-white/55">
          {rankStrategyMeta.disclaimer}
        </p>
      )}
      {rankMeta && (
        <div className="mb-2 grid gap-2 rounded-lg border border-white/10 bg-black/20 p-2 text-[11px] text-white/70 sm:grid-cols-2 xl:grid-cols-4">
          <p>
            Accepted: <span className="text-mint">{rankMeta.accepted_count}</span>
          </p>
          <p>
            Excluded: <span className="text-warn">{rankMeta.excluded_count}</span>
          </p>
          <p>
            Min price: <span className="text-cyan-200">${rankMeta.min_price.toFixed(2)}</span>
          </p>
          <p>
            Min ADV20:{" "}
            <span className="text-cyan-200">${Math.round(rankMeta.min_avg_dollar_vol_20d).toLocaleString()}</span>
          </p>
        </div>
      )}
      {error && <p className="mb-2 text-xs text-orange-300/90">{error}</p>}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {suggestions.length === 0 ? (
          <p className="text-xs text-white/60">Scanning broad stock universe and ranking candidates...</p>
        ) : (
          suggestions.slice(0, 9).map((row) => {
            const rbLegs = ruleBreakerBreakdown(row.strategy_factors);
            return (
              <article key={row.symbol} className="rounded-lg border border-white/10 bg-panelAlt/80 px-3 py-2">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-sm font-semibold text-white">{row.symbol}</p>
                <span className="text-[11px] text-cyan-300/90">Score {row.score.toFixed(2)}</span>
              </div>
              <p className="text-sm text-white/80">{row.last_close == null ? "--" : row.last_close.toFixed(2)}</p>
              <p className={`text-xs ${pctClass(row.day_change_pct)}`}>
                {row.day_change_pct == null
                  ? "--"
                  : `${row.day_change_pct >= 0 ? "+" : ""}${row.day_change_pct.toFixed(2)}%`}
              </p>
              <ul className="mt-2 space-y-1">
                {row.why.slice(0, 4).map((reason) => (
                  <li key={reason} className="text-[11px] leading-relaxed text-white/70">
                    {reason}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-cyan-200/70">
                ADV20 ${Math.round(row.avg_dollar_vol_20d ?? 0).toLocaleString()}
              </p>
              {rbLegs.length > 0 && (
                <ul className="mt-2 space-y-1.5 border-t border-white/10 pt-2">
                  <li className="text-[10px] font-semibold uppercase tracking-wide text-amber-200/85">
                    Gardner checklist — leg scores (0–100) × weight
                  </li>
                  {rbLegs.map((leg) => (
                    <li key={leg.element_key} className="text-[10px] leading-snug text-white/65">
                      <span className="font-medium text-white/80">
                        {leg.element_key.replace(/_/g, " ")}
                      </span>{" "}
                      <span className="text-cyan-200/90">{leg.score_0_100.toFixed(0)}</span>
                      <span className="text-white/40"> ×{(leg.weight * 100).toFixed(0)}% → </span>
                      <span className="text-mint/90">{leg.weighted_contribution.toFixed(2)}</span>
                      {leg.book_criterion ? (
                        <span className="mt-0.5 block pl-0 text-[9px] text-white/45">{leg.book_criterion}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[11px] text-white/45">{row.position_hint}</span>
                <button
                  type="button"
                  onClick={() => void onAdd(row.symbol)}
                  disabled={Boolean(adding[row.symbol] || added[row.symbol])}
                  className="rounded-md border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-medium text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {added[row.symbol] ? "Added" : adding[row.symbol] ? "Adding..." : "Add to watchlist"}
                </button>
              </div>
              <div className="mt-2 border-t border-white/10 pt-2 text-[11px] leading-relaxed text-white/65">
                Why Quant suggests this: {row.why[0] || "Composite rank from momentum, volatility, and drawdown."}
              </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
