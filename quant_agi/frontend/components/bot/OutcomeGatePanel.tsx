"use client";

import type {
  PaperBotLearningCoachingDirectives,
  PaperBotLearningMemory,
  PaperBotOutcomeGate
} from "../../lib/paperBotApi";

type Props = {
  priorGate: PaperBotOutcomeGate | null | undefined;
  memory: PaperBotLearningMemory | null | undefined;
  progress?: { windowTrades: number; tradesSinceBaseline: number } | null;
};

function gateStatusLabel(status: string | undefined): string {
  switch (String(status || "").toLowerCase()) {
    case "passed":
      return "Passed — tightening allowed";
    case "failed":
      return "Failed — kept softer coaching";
    case "pending":
      return "Pending — measuring trades";
    case "insufficient_data":
      return "First cycle — no prior data";
    default:
      return status ? String(status) : "No gate yet";
  }
}

function gateStatusClass(status: string | undefined): string {
  switch (String(status || "").toLowerCase()) {
    case "passed":
      return "border-emerald-500/35 bg-emerald-500/10 text-emerald-100";
    case "failed":
      return "border-rose-500/35 bg-rose-500/10 text-rose-100";
    case "pending":
      return "border-amber-500/35 bg-amber-500/10 text-amber-100";
    default:
      return "border-white/15 bg-black/20 text-white/70";
  }
}

function fmtUsd(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function metricNum(row: PaperBotOutcomeGate["baseline"], snake: string, camel: string): number | undefined {
  if (!row) return undefined;
  const raw = row[snake as keyof typeof row] ?? row[camel as keyof typeof row];
  return typeof raw === "number" ? raw : undefined;
}

function DirectiveChip({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/75">
      {label}: {value}
    </span>
  );
}

function DirectivesBlock({
  title,
  tone,
  directives
}: {
  title: string;
  tone: "proposed" | "effective";
  directives?: PaperBotLearningCoachingDirectives | null;
}) {
  if (!directives) return null;
  const border = tone === "effective" ? "border-emerald-500/25 bg-emerald-500/5" : "border-violet-500/25 bg-violet-500/5";
  return (
    <div className={`rounded-md border ${border} p-2`}>
      <p className="text-[10px] uppercase tracking-wide text-white/50">{title}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <DirectiveChip label="regime" value={directives.regime_bias} />
        <DirectiveChip label="entries" value={directives.entry_posture} />
        <DirectiveChip label="exits" value={directives.exit_posture} />
      </div>
    </div>
  );
}

export function OutcomeGatePanel({ priorGate, memory, progress }: Props) {
  const measurement = memory?.outcome_gate;
  const proposed = memory?.proposed_directives;
  const effective = memory?.effective_directives || memory?.coaching_directives;
  const showDirectives =
    proposed &&
    effective &&
    (proposed.entry_posture !== effective.entry_posture ||
      proposed.exit_posture !== effective.exit_posture ||
      proposed.regime_bias !== effective.regime_bias);

  const priorStatus = priorGate?.status;
  const windowTrades = progress?.windowTrades ?? measurement?.window_trades ?? priorGate?.window_trades;
  const tradesSince =
    progress?.tradesSinceBaseline ?? measurement?.trades_since_baseline ?? priorGate?.trades_since_baseline;

  const tradeProgress =
    typeof windowTrades === "number" && typeof tradesSince === "number"
      ? `${tradesSince}/${windowTrades} paper trades`
      : typeof windowTrades === "number"
        ? `Target: ${windowTrades} paper trades before re-evaluating`
        : null;

  const delta = priorGate?.delta;
  const deltaPnl = delta?.cum_pnl_usd;

  if (!priorGate && !measurement && !effective) {
    return (
      <div className="mt-3 rounded-md border border-white/10 bg-black/15 p-2.5">
        <p className="text-[10px] uppercase tracking-wide text-white/45">Outcome gate</p>
        <p className="mt-1 text-[11px] leading-relaxed text-white/55">
          Run a learning cycle to record coaching. The gate measures the next batch of paper trades before
          allowing tighter behavior.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-cyan-500/25 bg-cyan-500/5 p-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-cyan-200/80">Outcome gate</p>
          <p className="mt-0.5 text-[11px] text-white/50">
            Rank tape stays primary — coaching only tightens if the last cycle improved paper metrics.
          </p>
        </div>
        {priorStatus ? (
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${gateStatusClass(priorStatus)}`}
          >
            {gateStatusLabel(priorStatus)}
          </span>
        ) : null}
      </div>

      {priorGate?.message ? (
        <p className="mt-2 text-xs leading-relaxed text-white/75">{priorGate.message}</p>
      ) : measurement?.message ? (
        <p className="mt-2 text-xs leading-relaxed text-white/75">{measurement.message}</p>
      ) : null}

      {measurement?.apply_note ? (
        <p className="mt-2 rounded border border-amber-500/25 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100/90">
          {measurement.apply_note}
        </p>
      ) : null}

      {tradeProgress ? (
        <p className="mt-2 text-[11px] tabular-nums text-cyan-100/90">{tradeProgress}</p>
      ) : null}

      {priorStatus === "passed" || priorStatus === "failed" ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <div className="rounded border border-white/10 bg-black/20 px-2 py-1.5">
            <p className="text-[10px] text-white/45">Δ P&amp;L since baseline</p>
            <p
              className={`text-sm font-medium tabular-nums ${
                (deltaPnl ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"
              }`}
            >
              {fmtUsd(deltaPnl)}
            </p>
          </div>
          <div className="rounded border border-white/10 bg-black/20 px-2 py-1.5">
            <p className="text-[10px] text-white/45">Δ Sharpe proxy</p>
            <p className="text-sm font-medium tabular-nums text-white/85">
              {delta?.sharpe_proxy != null ? delta.sharpe_proxy.toFixed(3) : "—"}
            </p>
          </div>
          <div className="rounded border border-white/10 bg-black/20 px-2 py-1.5">
            <p className="text-[10px] text-white/45">Trades in window</p>
            <p className="text-sm font-medium tabular-nums text-white/85">
              {priorGate?.trades_since_baseline ?? delta?.trade_count ?? "—"}
            </p>
          </div>
        </div>
      ) : null}

      {priorGate?.baseline ? (
        <p className="mt-2 text-[10px] text-white/40">
          Baseline equity P&amp;L snapshot: {fmtUsd(metricNum(priorGate.baseline, "cum_pnl_usd", "cumPnlUsd"))}
          {priorGate.evaluated_at ? ` · evaluated ${new Date(priorGate.evaluated_at).toLocaleString()}` : ""}
        </p>
      ) : null}

      {showDirectives ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <DirectivesBlock title="Proposed coaching" tone="proposed" directives={proposed} />
          <DirectivesBlock title="Effective (plan-tick uses)" tone="effective" directives={effective} />
        </div>
      ) : effective ? (
        <div className="mt-3">
          <DirectivesBlock title="Effective coaching (plan-tick)" tone="effective" directives={effective} />
        </div>
      ) : null}

      {memory?.signal_hierarchy ? (
        <p className="mt-2 text-[10px] text-white/40">
          Signals: rank {memory.signal_hierarchy.rank || "primary"} · coach {memory.signal_hierarchy.coach || "overlay"}{" "}
          · X {memory.signal_hierarchy.x_whisper || "whisper"}
        </p>
      ) : null}
    </div>
  );
}
