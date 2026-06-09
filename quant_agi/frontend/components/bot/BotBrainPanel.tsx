"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchPaperBotEvents,
  fetchPaperBotPolicySnapshot,
  runPaperBotDryRun,
  type PaperBotDryRunResult,
  type PaperBotEvent,
  type PaperBotPolicySnapshot
} from "../../lib/paperBotApi";

type Props = {
  refreshKey?: number;
};

function policyLabel(key: string): string {
  return key.replace(/_/g, " ");
}

export function BotBrainPanel({ refreshKey = 0 }: Props) {
  const [snapshot, setSnapshot] = useState<PaperBotPolicySnapshot | null>(null);
  const [dryRun, setDryRun] = useState<PaperBotDryRunResult | null>(null);
  const [events, setEvents] = useState<PaperBotEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [snap, dr, ev] = await Promise.all([
        fetchPaperBotPolicySnapshot(),
        runPaperBotDryRun(),
        fetchPaperBotEvents(12)
      ]);
      setSnapshot(snap);
      setDryRun(dr);
      setEvents(ev);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load bot brain");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (loading && !snapshot) {
    return (
      <div className="mb-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
        <p className="text-sm text-white/55">Loading bot brain…</p>
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div className="mb-4 rounded-xl border border-warn/30 bg-warn/10 p-3">
        <p className="text-sm text-warn">{error}</p>
      </div>
    );
  }

  if (!snapshot) return null;

  const intents = dryRun?.intents ?? [];

  return (
    <div className="mb-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-cyan-100">Bot brain</h3>
          <p className="mt-0.5 text-[11px] text-white/50">
            Deterministic policy + inputs — Grok proposes rules; engine decides intents.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-md border border-white/15 px-2.5 py-1 text-[11px] text-white/70 hover:bg-white/5 disabled:opacity-50"
        >
          Refresh brain
        </button>
      </div>

      <p className="mt-2 text-[10px] uppercase tracking-wide text-white/40">
        Precedence: {snapshot.precedence}
      </p>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-black/25 p-3">
          <p className="text-[10px] uppercase tracking-wide text-white/45">Active policy snapshot</p>
          <p className="mt-1 text-xs text-white/60">Policy v{snapshot.policyVersion}</p>
          <ul className="mt-2 space-y-1 text-xs text-white/80">
            {Object.entries(snapshot.mergedPolicy).map(([k, v]) => (
              <li key={k} className="flex justify-between gap-2">
                <span className="text-white/55">{policyLabel(k)}</span>
                <span className="tabular-nums font-medium">{v}</span>
              </li>
            ))}
          </ul>
          {snapshot.activeRules.length ? (
            <p className="mt-2 text-[11px] text-mint">
              {snapshot.activeRules.length} active rule(s) merged
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-white/45">No active rules — engine defaults only.</p>
          )}
        </div>

        <div className="rounded-lg border border-white/10 bg-black/25 p-3">
          <p className="text-[10px] uppercase tracking-wide text-white/45">Universe &amp; gates</p>
          <ul className="mt-2 space-y-1 text-xs text-white/75">
            <li>
              Universe: <span className="text-white">{snapshot.universe.source}</span> (
              {snapshot.universe.symbolCount} symbols)
            </li>
            <li>
              Kill switch:{" "}
              <span className={snapshot.gates.killSwitchArmed ? "text-warn" : "text-mint"}>
                {snapshot.gates.killSwitchArmed ? "Armed" : "Disarmed"}
              </span>
            </li>
            <li>
              Cash headroom:{" "}
              <span className="tabular-nums">${snapshot.gates.cashHeadroomUsd.toLocaleString()}</span>
            </li>
            <li>
              Open slots: {snapshot.gates.openPositions} / {snapshot.gates.maxOpenPositions}
            </li>
          </ul>
          {snapshot.universe.symbolsSample.length ? (
            <p className="mt-2 text-[11px] text-white/45">
              Sample: {snapshot.universe.symbolsSample.join(", ")}
            </p>
          ) : null}
        </div>
      </div>

      {snapshot.inputSignals.rankLeaders.length ? (
        <div className="mt-3 rounded-lg border border-white/10 bg-black/25 p-3">
          <p className="text-[10px] uppercase tracking-wide text-white/45">Rank leaders (input signals)</p>
          <div className="mt-2 flex flex-wrap gap-3">
            {snapshot.inputSignals.rankLeaders.map((block) => (
              <div key={block.strategy} className="min-w-[140px] text-xs">
                <p className="font-medium text-white/70">{block.strategy}</p>
                {block.leaders.length ? (
                  <ul className="mt-1 text-white/55">
                    {block.leaders.map((l) => (
                      <li key={`${block.strategy}-${l.symbol}`}>
                        {l.symbol}{" "}
                        <span className="text-white/40">({l.score.toFixed(0)})</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-white/40">Unavailable</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 rounded-lg border border-white/10 bg-black/25 p-3">
        <p className="text-[10px] uppercase tracking-wide text-white/45">Dry-run intents</p>
        {dryRun?.skipped && dryRun.reason ? (
          <p className="mt-2 text-xs text-warn">{dryRun.reason}</p>
        ) : null}
        {intents.length ? (
          <ul className="mt-2 space-y-2">
            {intents.map((intent, idx) => (
              <li
                key={`${intent.symbol || "block"}-${idx}`}
                className="rounded-md border border-white/10 bg-black/30 px-2.5 py-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="font-medium text-white">
                    {intent.symbol ? intent.symbol : "Policy"}{" "}
                    <span
                      className={
                        intent.action === "buy"
                          ? "text-mint"
                          : intent.action === "blocked"
                            ? "text-warn"
                            : "text-white/50"
                      }
                    >
                      · {intent.action}
                    </span>
                  </span>
                  {intent.notionalUsd != null ? (
                    <span className="tabular-nums text-white/50">
                      ${intent.notionalUsd.toLocaleString()}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[11px] text-white/45">
                  {intent.detail || intent.reason || "—"}
                  {intent.target_weight_pct != null ? ` · ~${intent.target_weight_pct}% weight` : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-white/45">No intents — check universe and gates above.</p>
        )}
      </div>

      {events.length ? (
        <div className="mt-3 rounded-lg border border-white/10 bg-black/25 p-3">
          <p className="text-[10px] uppercase tracking-wide text-white/45">Recent decisions log</p>
          <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto text-[11px] text-white/55">
            {events.map((ev) => (
              <li key={ev.id}>
                <span className="text-white/70">{ev.eventType}</span>
                {" · "}
                {new Date(ev.createdAt).toLocaleString()}
                {ev.payload?.reason ? ` — ${String(ev.payload.reason)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-3 text-[10px] leading-relaxed text-white/40">{snapshot.disclaimer}</p>
    </div>
  );
}
