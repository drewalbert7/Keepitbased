"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchPaperBotAutoresearchLatest,
  type PaperBotAutoresearchLatest
} from "../../lib/paperBotApi";
import { AutoresearchPromoteButton } from "./AutoresearchPromoteButton";

type Props = {
  refreshKey?: number;
};

function fmtUsd(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtDelta(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(3)}`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const hrs = Math.floor(ms / (60 * 60 * 1000));
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function gateActual(gateId: string, actual: number): string {
  if (gateId === "max_drawdown") return fmtPct(actual);
  if (gateId === "sharpe_holdout" || gateId === "walk_forward") return fmtDelta(actual);
  if (gateId === "reset_cooldown") return actual ? "active" : "clear";
  return String(actual);
}

export function AutoresearchDailyStrip({ refreshKey = 0 }: Props) {
  const [data, setData] = useState<PaperBotAutoresearchLatest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const next = await fetchPaperBotAutoresearchLatest();
      setData(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load autoresearch summary");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (loading && !data) {
    return (
      <div className="rounded-xl border border-white/10 bg-panelAlt/40 p-3">
        <p className="text-xs text-white/50">Loading autoresearch strip…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl border border-warn/30 bg-warn/10 p-3">
        <p className="text-xs text-warn">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const {
    metrics,
    nightlyContext,
    walkForward,
    promotion,
    latestExperiment,
    autoresearchScorecard,
    latestPatch
  } = data;
  const pnlPositive = metrics.cumPnlUsd >= 0;

  return (
    <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-violet-100">Karpathy autoresearch</h3>
          <p className="mt-0.5 text-[11px] text-white/50">
            Nightly paper P&amp;L → Grok proposals. Knobs become rules; code patches need your approve.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded border border-white/15 px-2 py-0.5 text-[10px] text-white/60 hover:border-white/30 hover:text-white/80"
        >
          Refresh
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border border-white/10 bg-black/20 px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-white/45">Paper equity</p>
          <p className="text-sm font-medium text-white">${metrics.equityUsd.toLocaleString()}</p>
        </div>
        <div className="rounded-md border border-white/10 bg-black/20 px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-white/45">Cum P&amp;L</p>
          <p className={`text-sm font-medium ${pnlPositive ? "text-emerald-300" : "text-rose-300"}`}>
            {fmtUsd(metrics.cumPnlUsd)}
          </p>
        </div>
        <div className="rounded-md border border-white/10 bg-black/20 px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-white/45">Win-rate days</p>
          <p className="text-sm font-medium text-white">
            {((nightlyContext?.winRateDays ?? 0) * 100).toFixed(0)}% · {metrics.tradeCount} fills
          </p>
        </div>
        <div className="rounded-md border border-white/10 bg-black/20 px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-white/45">Walk-forward Δ</p>
          <p className="text-sm font-medium text-white">
            {walkForward ? fmtDelta(walkForward.avgHoldoutSharpeDelta) : "—"}
            {walkForward ? ` (${walkForward.symbolsEvaluated} sym)` : ""}
          </p>
        </div>
      </div>

      {nightlyContext?.worstDay ? (
        <p className="mt-2 text-[11px] text-white/50">
          Worst day: {String(nightlyContext.worstDay.snapshotDate).slice(0, 10)} ·{" "}
          {fmtUsd(nightlyContext.worstDay.dayPnlUsd)}
          {nightlyContext?.symbolsTraded?.length ? (
            <>
              {" "}
              · traded:{" "}
              {nightlyContext.symbolsTraded
                .slice(0, 5)
                .map((s) => s.symbol)
                .join(", ")}
            </>
          ) : null}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-white/55">Latest nightly run:</span>
        {latestExperiment ? (
          <>
            <span
              className={`rounded px-1.5 py-0.5 font-medium ${
                latestExperiment.improved
                  ? "bg-emerald-500/20 text-emerald-200"
                  : "bg-white/10 text-white/65"
              }`}
            >
              {latestExperiment.improved ? "improved" : "rejected"}
            </span>
            <span className="text-white/70">{latestExperiment.branch}</span>
            <span className="text-white/50">Sharpe Δ {fmtDelta(latestExperiment.sharpeDelta)}</span>
            {latestExperiment.createdAt ? (
              <span className="text-white/40">{timeAgo(latestExperiment.createdAt)}</span>
            ) : null}
          </>
        ) : (
          <span className="text-white/45">No autoresearch runs yet</span>
        )}
      </div>

      {autoresearchScorecard ? (
        <p className="mt-1 text-[11px] text-white/45">
          Window: {autoresearchScorecard.testedExperiments} tested ·{" "}
          {autoresearchScorecard.improvedExperiments} improved · avg Sharpe Δ{" "}
          {fmtDelta(autoresearchScorecard.avgSharpeDelta)}
        </p>
      ) : null}

      {latestPatch?.patchPreview ? (
        <div className="mt-3 rounded-md border border-white/10 bg-black/25 p-2">
          <p className="text-[10px] uppercase tracking-wide text-white/45">Diff preview</p>
          <pre className="mt-1 max-h-28 overflow-auto text-[10px] text-white/70">
            {latestPatch.patchPreview}
          </pre>
          <a
            href="#autoresearch-diff"
            className="mt-1 inline-block text-[11px] text-neon underline-offset-2 hover:underline"
          >
            Full diff in ops →
          </a>
        </div>
      ) : null}

      <div className="mt-3 rounded-md border border-white/10 bg-black/15 p-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-white/75">
            Promotion gates{" "}
            <span className={promotion.promotionReady ? "text-emerald-300" : "text-amber-200"}>
              {promotion.passedCount}/{promotion.totalCount}
            </span>
            {promotion.promotionReady ? " · ready" : ""}
          </p>
          <a
            href="#autoresearch-ops"
            className="text-[11px] text-neon underline-offset-2 hover:underline"
          >
            View full ops →
          </a>
        </div>
        <ul className="mt-2 space-y-1">
          {promotion.gates.map((gate) => (
            <li key={gate.id} className="flex items-start gap-2 text-[11px] text-white/60">
              <span className={gate.pass ? "text-emerald-400" : "text-white/35"} aria-hidden>
                {gate.pass ? "✓" : "○"}
              </span>
              <span className={gate.pass ? "text-white/75" : ""}>{gate.label}</span>
              <span className="ml-auto tabular-nums text-white/45">
                {gateActual(gate.id, gate.actual)}
              </span>
            </li>
          ))}
        </ul>
        <AutoresearchPromoteButton data={data} onPromoted={() => void load()} />
      </div>
    </div>
  );
}
