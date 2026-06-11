"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchPaperBotBrain,
  runPaperBotBrainReflection,
  type PaperBotAgentDebate,
  type PaperBotAgentPlanHistoryItem,
  type PaperBotAgentTradeIntent,
  type PaperBotBrainMonitor,
  type PaperBotDryRunResult,
  type PaperBotIntent
} from "../../lib/paperBotApi";
import { money, pnlClass } from "./format";

type Props = {
  refreshKey?: number;
  onReflectionComplete?: () => void;
};

function policyLabel(key: string): string {
  return key.replace(/_/g, " ");
}

function universeLabel(source: string): string {
  if (source === "deploy_list_only") return "Deploy list only";
  if (source === "watchlist_and_deploy_list") return "Watchlist + deploy list";
  if (source === "quant_auto_agent") return "Quant auto-pick (multi-agent LangGraph)";
  if (source === "quant_auto") return "Quant auto-pick (rank strategies)";
  return source.replace(/_/g, " ");
}

function regimeBadgeClass(label: string | null | undefined): string {
  const r = String(label || "").toLowerCase();
  if (r === "risk_on") return "bg-mint/20 text-mint border-mint/30";
  if (r === "moderate") return "bg-amber-500/15 text-amber-100 border-amber-500/30";
  if (r === "cautious") return "bg-warn/15 text-warn border-warn/30";
  if (r === "closed") return "bg-white/10 text-white/50 border-white/15";
  return "bg-cyan-400/15 text-cyan-200 border-cyan-400/25";
}

function formatRegime(label: string | null | undefined): string {
  if (!label) return "—";
  return label.replace(/_/g, " ");
}

function IntentList({ intents, empty }: { intents: PaperBotIntent[]; empty: string }) {
  if (!intents.length) {
    return <p className="mt-2 text-xs text-white/45">{empty}</p>;
  }
  return (
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
              <span className="tabular-nums text-white/50">${intent.notionalUsd.toLocaleString()}</span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[11px] text-white/45">
            {intent.detail || intent.reason || "—"}
          </p>
        </li>
      ))}
    </ul>
  );
}

function AgentIntentChips({ intents }: { intents: PaperBotAgentTradeIntent[] }) {
  if (!intents.length) return <span className="text-white/40">None</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {intents.map((i, idx) => (
        <span
          key={`${i.symbol}-${idx}`}
          className={`rounded-full px-2 py-0.5 text-[10px] ${
            i.action === "buy"
              ? "bg-mint/15 text-mint"
              : i.action === "sell"
                ? "bg-warn/15 text-warn"
                : "bg-white/10 text-white/55"
          }`}
        >
          {String(i.action).toUpperCase()} {i.symbol}
        </span>
      ))}
    </div>
  );
}

function DebatePanel({ debates, summary }: { debates: PaperBotAgentDebate[]; summary?: string | null }) {
  if (!debates.length && !summary) return null;
  return (
    <div className="mt-3 rounded-lg border border-violet-400/20 bg-violet-400/5 p-3">
      <p className="text-[10px] uppercase tracking-wide text-violet-200/80">Candidate debate (top 3)</p>
      {summary ? <p className="mt-1 text-[11px] text-white/55">{summary}</p> : null}
      {debates.length ? (
        <ul className="mt-2 space-y-2">
          {debates.map((d) => (
            <li key={d.symbol} className="rounded-md border border-white/10 bg-black/25 px-2.5 py-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-white">{d.symbol}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${
                    d.verdict === "enter"
                      ? "bg-mint/15 text-mint"
                      : d.verdict === "avoid"
                        ? "bg-warn/15 text-warn"
                        : "bg-white/10 text-white/55"
                  }`}
                >
                  {d.verdict || "wait"}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-white/45">
                Bull {d.bull_score ?? "—"} vs bear {d.bear_score ?? "—"}
                {d.summary ? ` · ${d.summary}` : ""}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PlanHistoryRow({ item }: { item: PaperBotAgentPlanHistoryItem }) {
  const p = item as PaperBotAgentPlanHistoryItem & {
    payload?: Record<string, unknown>;
  };
  const regime = item.regimeLabel ?? (p.payload?.regimeLabel as string | undefined);
  const intents =
    item.tradeIntents ??
    (Array.isArray(p.payload?.tradeIntents) ? (p.payload.tradeIntents as PaperBotAgentTradeIntent[]) : []);
  return (
    <li className="rounded-md border border-white/10 bg-black/25 px-2.5 py-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-white/70">{new Date(item.createdAt).toLocaleString()}</span>
        {regime ? (
          <span className={`rounded-full border px-2 py-0.5 text-[10px] ${regimeBadgeClass(regime)}`}>
            {formatRegime(regime)}
          </span>
        ) : null}
      </div>
      <div className="mt-1.5">
        <AgentIntentChips intents={intents} />
      </div>
      {item.rationale || (p.payload?.rationale as string) ? (
        <p className="mt-1 text-[11px] text-white/45 line-clamp-2">
          {item.rationale || String(p.payload?.rationale)}
        </p>
      ) : null}
    </li>
  );
}

function mapPlanHistory(
  raw: Array<{ id: number; createdAt: string; payload?: Record<string, unknown> }>
): PaperBotAgentPlanHistoryItem[] {
  return raw.map((e) => ({
    id: e.id,
    createdAt: e.createdAt,
    regimeLabel: (e.payload?.regimeLabel as string) ?? null,
    grokUsed: Boolean(e.payload?.grokUsed),
    rationale: (e.payload?.rationale as string) ?? null,
    tradeIntents: Array.isArray(e.payload?.tradeIntents)
      ? (e.payload.tradeIntents as PaperBotAgentTradeIntent[])
      : [],
    debateSummary:
      (e.payload?.plan as Record<string, unknown> | undefined)?.debate_summary?.toString() ?? null,
    skipped: Boolean(e.payload?.skipped)
  }));
}

export function BotBrainPanel({ refreshKey = 0, onReflectionComplete }: Props) {
  const [brain, setBrain] = useState<PaperBotBrainMonitor | null>(null);
  const [loading, setLoading] = useState(true);
  const [reflecting, setReflecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await fetchPaperBotBrain();
      setBrain({
        ...data,
        agentPlanHistory: mapPlanHistory(
          data.agentPlanHistory as Array<{
            id: number;
            createdAt: string;
            payload?: Record<string, unknown>;
          }>
        )
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load bot brain");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const onReflect = () => {
    setReflecting(true);
    setError(null);
    void runPaperBotBrainReflection()
      .then((data) => {
        setBrain({
          ...data,
          agentPlanHistory: mapPlanHistory(
            data.agentPlanHistory as Array<{
              id: number;
              createdAt: string;
              payload?: Record<string, unknown>;
            }>
          )
        });
        onReflectionComplete?.();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Brain reflection failed"))
      .finally(() => setReflecting(false));
  };

  if (loading && !brain) {
    return (
      <div className="mb-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
        <p className="text-sm text-white/55">Loading bot brain…</p>
      </div>
    );
  }

  if (error && !brain) {
    return (
      <div className="mb-4 rounded-xl border border-warn/30 bg-warn/10 p-3">
        <p className="text-sm text-warn">{error}</p>
      </div>
    );
  }

  if (!brain) return null;

  const { snapshot, dryRun, agentPlanHistory, lastReflection, brainPendingRules, performance } = brain;
  const regime = dryRun.regimeLabel || snapshot.inputSignals.regimeLabel;
  const agentMode = snapshot.gates.agentModeEnabled || performance.universeMode === "quant_auto_agent";
  const planHistory = agentPlanHistory;

  return (
    <div className="mb-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-cyan-100">Bot brain</h3>
          <p className="mt-0.5 text-[11px] text-white/50">
            Monitor regime, agent debate, dry-run intents, and reflection-driven improvements.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {regime ? (
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase ${regimeBadgeClass(regime)}`}>
              Regime: {formatRegime(regime)}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || reflecting}
            className="rounded-md border border-white/15 px-2.5 py-1 text-[11px] text-white/70 hover:bg-white/5 disabled:opacity-50"
          >
            Refresh brain
          </button>
        </div>
      </div>

      {error ? <p className="mt-2 text-xs text-warn">{error}</p> : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-white/10 bg-black/25 px-2.5 py-2">
          <p className="text-[10px] uppercase text-white/40">Agent ticks</p>
          <p className="text-lg font-semibold tabular-nums text-white">{performance.agentPlanTicks}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/25 px-2.5 py-2">
          <p className="text-[10px] uppercase text-white/40">Agent fills</p>
          <p className="text-lg font-semibold tabular-nums text-white">{performance.agentTaggedFills}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/25 px-2.5 py-2">
          <p className="text-[10px] uppercase text-white/40">Paper P&amp;L</p>
          <p className={`text-lg font-semibold tabular-nums ${pnlClass(performance.cumPnlUsd)}`}>
            {performance.cumPnlUsd >= 0 ? "+" : ""}
            {money(performance.cumPnlUsd)}
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/25 px-2.5 py-2">
          <p className="text-[10px] uppercase text-white/40">Brain proposals</p>
          <p className="text-lg font-semibold tabular-nums text-white">{brainPendingRules.length}</p>
        </div>
      </div>

      <p className="mt-2 text-[10px] uppercase tracking-wide text-white/40">
        Precedence: {snapshot.precedence}
      </p>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-black/25 p-3">
          <p className="text-[10px] uppercase tracking-wide text-white/45">Active policy snapshot</p>
          <p className="mt-1 text-xs text-white/60">
            Policy v{snapshot.policyVersion} · {universeLabel(snapshot.universe.source)}
            {agentMode ? " · multi-agent ON" : ""}
          </p>
          <ul className="mt-2 space-y-1 text-xs text-white/80">
            {Object.entries(snapshot.mergedPolicy).map(([k, v]) => (
              <li key={k} className="flex justify-between gap-2">
                <span className="text-white/55">{policyLabel(k)}</span>
                <span className="tabular-nums font-medium">{v}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/25 p-3">
          <p className="text-[10px] uppercase tracking-wide text-white/45">Universe &amp; gates</p>
          <ul className="mt-2 space-y-1 text-xs text-white/75">
            <li>
              Universe: <span className="text-white">{universeLabel(snapshot.universe.source)}</span> (
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
            <li>
              Grok this tick:{" "}
              <span className={dryRun.grokUsed ? "text-mint" : "text-white/50"}>
                {dryRun.grokUsed ? "Yes" : "Rules fallback"}
              </span>
            </li>
          </ul>
        </div>
      </div>

      <DebatePanel debates={dryRun.debateResults || []} summary={dryRun.debateSummary} />

      <div className="mt-3 rounded-lg border border-white/10 bg-black/25 p-3">
        <p className="text-[10px] uppercase tracking-wide text-white/45">
          Dry-run intents {agentMode ? "(multi-agent execution path)" : ""}
        </p>
        {dryRun.skipped && dryRun.reason ? (
          <p className="mt-2 text-xs text-warn">{dryRun.reason}</p>
        ) : null}
        {agentMode && (dryRun.tradeIntents?.length ?? 0) > 0 ? (
          <div className="mt-2">
            <p className="text-[11px] text-white/50">Agent trade intents (pre-policy)</p>
            <div className="mt-1">
              <AgentIntentChips intents={dryRun.tradeIntents || []} />
            </div>
          </div>
        ) : null}
        <IntentList intents={dryRun.intents} empty="No intents — check universe and gates above." />
      </div>

      {planHistory.length ? (
        <div className="mt-3 rounded-lg border border-white/10 bg-black/25 p-3">
          <p className="text-[10px] uppercase tracking-wide text-white/45">Recent agent plan ticks</p>
          <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">
            {planHistory.slice(0, 6).map((item) => (
              <PlanHistoryRow key={item.id} item={item} />
            ))}
          </ul>
        </div>
      ) : agentMode ? (
        <p className="mt-3 text-xs text-white/45">
          No agent plan ticks yet — turn the bot on or run now to populate the brain log.
        </p>
      ) : null}

      <div className="mt-3 rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-cyan-200/80">Brain reflection</p>
            <p className="mt-1 text-[11px] text-white/55">
              Analyze agent ticks + paper fills; proposals land in the rules inbox for your approval.
            </p>
          </div>
          <button
            type="button"
            onClick={onReflect}
            disabled={reflecting || loading}
            className="shrink-0 rounded-md border border-cyan-400/40 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-medium text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-50"
          >
            {reflecting ? "Reflecting…" : "Run brain reflection"}
          </button>
        </div>
        {lastReflection?.payload?.summary ? (
          <p className="mt-2 text-xs text-white/75">{String(lastReflection.payload.summary)}</p>
        ) : (
          <p className="mt-2 text-xs text-white/45">
            No reflection yet — run after a few agent ticks or fills for tailored suggestions.
          </p>
        )}
        {brainPendingRules.length ? (
          <p className="mt-2 text-[11px] text-mint">
            {brainPendingRules.length} brain proposal(s) waiting in the rules inbox below.
          </p>
        ) : null}
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-white/40">{brain.disclaimer}</p>
    </div>
  );
}
