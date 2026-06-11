"use client";

import { PAPER_BOT_DISARM_PHRASE, type PaperBotAccount, type PaperBotRuntime } from "../../lib/paperBotApi";

type Props = {
  account: PaperBotAccount;
  runtime: PaperBotRuntime;
  busy: boolean;
  turnOnOpen: boolean;
  confirmPhrase: string;
  resetOpen: boolean;
  onTurnOn: () => void;
  onTurnOff: () => void;
  onConfirmTurnOn: () => void;
  onCancelTurnOn: () => void;
  onConfirmPhraseChange: (v: string) => void;
  onRunNow: () => void;
  onResetClick: () => void;
  onConfirmReset: () => void;
  onCancelReset: () => void;
};

function statusStyles(status: PaperBotRuntime["status"]) {
  switch (status) {
    case "running":
      return {
        ring: "ring-mint/40",
        bg: "bg-mint/10",
        dot: "bg-mint animate-pulse",
        text: "text-mint"
      };
    case "waiting":
      return {
        ring: "ring-cyan-400/35",
        bg: "bg-cyan-500/10",
        dot: "bg-cyan-300",
        text: "text-cyan-200"
      };
    case "paused":
      return {
        ring: "ring-warn/35",
        bg: "bg-warn/10",
        dot: "bg-warn",
        text: "text-warn"
      };
    default:
      return {
        ring: "ring-white/15",
        bg: "bg-white/5",
        dot: "bg-white/35",
        text: "text-white/55"
      };
  }
}

export function BotStatusBar({
  account,
  runtime,
  busy,
  turnOnOpen,
  confirmPhrase,
  resetOpen,
  onTurnOn,
  onTurnOff,
  onConfirmTurnOn,
  onCancelTurnOn,
  onConfirmPhraseChange,
  onRunNow,
  onResetClick,
  onConfirmReset,
  onCancelReset
}: Props) {
  const styles = statusStyles(runtime.status);

  return (
    <div className={`mb-4 rounded-2xl border border-white/10 p-4 ring-1 ${styles.ring} ${styles.bg}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex h-3 w-3 rounded-full ${styles.dot}`} aria-hidden />
            <p className={`text-xl font-bold tracking-tight ${styles.text}`}>{runtime.label}</p>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                runtime.marketOpen ? "bg-mint/20 text-mint" : "bg-white/10 text-white/50"
              }`}
            >
              {runtime.marketOpen ? "Market open" : "Market closed"}
            </span>
          </div>
          <p className="mt-2 text-sm text-white/65">{runtime.detail}</p>
          <p className="mt-1 text-[11px] text-white/40">
            {runtime.lastAutoRunAt
              ? `Last auto check ${new Date(runtime.lastAutoRunAt).toLocaleString()}`
              : "No auto checks yet"}
            {runtime.schedulerEnabled
              ? ` · every ~${runtime.autoRunIntervalMinutes} min when on`
              : " · scheduler disabled on server"}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {runtime.botOn ? (
            <button
              type="button"
              disabled={busy}
              onClick={onTurnOff}
              className="rounded-xl border border-white/20 bg-black/30 px-5 py-2.5 text-sm font-semibold text-white hover:bg-black/45 disabled:opacity-50"
            >
              Bot OFF
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={onTurnOn}
              className="rounded-xl border border-mint/50 bg-mint/20 px-5 py-2.5 text-sm font-bold text-mint hover:bg-mint/30 disabled:opacity-50"
            >
              Bot ON
            </button>
          )}
          <button
            type="button"
            disabled={busy || !runtime.botOn}
            onClick={onRunNow}
            className="rounded-xl border border-neon/35 bg-neon/10 px-4 py-2.5 text-sm font-medium text-white hover:bg-neon/20 disabled:opacity-50"
            title={runtime.botOn ? "Force a policy check now" : "Turn the bot on first"}
          >
            Run now
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onResetClick}
            className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-100 hover:bg-rose-500/20 disabled:opacity-50"
          >
            Reset
          </button>
        </div>
      </div>

      {turnOnOpen ? (
        <div className="mt-4 rounded-xl border border-mint/30 bg-black/25 p-3">
          <p className="text-sm text-white/75">
            Type <strong className="font-mono text-mint">{PAPER_BOT_DISARM_PHRASE}</strong> to turn the
            bot on. Paper trades run automatically during US market hours only.
          </p>
          <input
            type="text"
            value={confirmPhrase}
            onChange={(e) => onConfirmPhraseChange(e.target.value)}
            className="mt-2 w-full max-w-md rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            placeholder={PAPER_BOT_DISARM_PHRASE}
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onConfirmTurnOn}
              className="rounded-lg border border-mint/40 bg-mint/15 px-3 py-1.5 text-xs font-semibold text-mint disabled:opacity-50"
            >
              Confirm Bot ON
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onCancelTurnOn}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {resetOpen ? (
        <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
          <p className="text-sm text-rose-100">
            Reset paper account to $10,000? Clears positions, trades, and snapshots. Bot turns{" "}
            <strong>OFF</strong>. <strong>24h promote cooldown</strong> applies after reset.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onConfirmReset}
              className="rounded-lg border border-rose-400/40 px-3 py-1.5 text-xs font-semibold text-rose-100 disabled:opacity-50"
            >
              Confirm reset
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onCancelReset}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-[10px] text-white/35">
        Paper simulation only · Policy v{account.policyVersion} ·{" "}
        {account.universeMode === "quant_auto_agent"
          ? "quant auto-pick (multi-agent)"
          : account.universeMode === "quant_auto"
            ? "quant auto-pick"
            : account.universeMode === "deploy_list_only" || account.tradeDeployListOnly
            ? "deploy list only"
            : "watchlist + deploy list"}
      </p>
    </div>
  );
}
