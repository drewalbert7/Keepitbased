"use client";

import { useCallback, useEffect, useState } from "react";
import { AutoresearchDailyStrip } from "./bot/AutoresearchDailyStrip";
import { BotBrainPanel } from "./bot/BotBrainPanel";
import { BotControls } from "./bot/BotControls";
import { BotHealthStrip } from "./bot/BotHealthStrip";
import { BotPerformanceChart } from "./bot/BotPerformanceChart";
import { BotPositionsTable } from "./bot/BotPositionsTable";
import { BotRulesInbox } from "./bot/BotRulesInbox";
import { BotTradeBlotter } from "./bot/BotTradeBlotter";
import {
  approvePaperBotRule,
  dismissPaperBotRule,
  fetchPaperBotState,
  setPaperBotKillSwitch,
  setPaperBotSettings,
  resetPaperBotAccount,
  simulatePaperBotDay,
  submitPaperBotNote,
  type PaperBotState
} from "../lib/paperBotApi";
import { onAuthTokenReady } from "../lib/authBridge";

export function PaperTradingBotPanel({ embed = false }: { embed?: boolean }) {
  const [state, setState] = useState<PaperBotState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [disarmOpen, setDisarmOpen] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [brainRefresh, setBrainRefresh] = useState(0);
  const [resetOpen, setResetOpen] = useState(false);

  const bumpBrain = () => setBrainRefresh((n) => n + 1);

  const load = useCallback(async () => {
    setError(null);
    try {
      setState(await fetchPaperBotState());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Quant AGI Bot");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return onAuthTokenReady(() => {
      setLoading(true);
      void load();
    });
  }, [load]);

  const account = state?.account;

  const onToggleKillSwitch = () => {
    if (!account) return;
    if (account.killSwitchArmed) {
      setDisarmOpen(true);
      return;
    }
    setBusy(true);
    setStatus(null);
    void setPaperBotKillSwitch(true)
      .then((updated) => {
        setState((s) => (s ? { ...s, account: updated } : s));
        setStatus("Kill switch armed — paper trades paused");
        return load();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not update kill switch"))
      .finally(() => setBusy(false));
  };

  const onConfirmDisarm = () => {
    setBusy(true);
    setStatus(null);
    void setPaperBotKillSwitch(false, confirmPhrase)
      .then((updated) => {
        setState((s) => (s ? { ...s, account: updated } : s));
        setDisarmOpen(false);
        setConfirmPhrase("");
        setStatus("Kill switch disarmed — run Simulate day to test fills");
        return load();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not disarm kill switch"))
      .finally(() => setBusy(false));
  };

  const onSimulateDay = () => {
    setBusy(true);
    setStatus(null);
    void simulatePaperBotDay()
      .then((next) => {
        setState(next);
        bumpBrain();
        if (next.runDay?.skipped) {
          setStatus(next.runDay.reason || "Run-day skipped");
        } else {
          setStatus(`Simulated day — ${next.runDay?.fillCount ?? 0} fill(s)`);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Simulate day failed"))
      .finally(() => setBusy(false));
  };

  const dashboardHref = "/dashboard";

  return (
    <section
      id="quant-agi-bot"
      className="scroll-mt-4 rounded-2xl border border-violet-500/30 bg-panel/80 p-4 sm:p-5 backdrop-blur"
    >
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-violet-300/80">Zone B</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-white sm:text-xl">Quant AGI Bot</h2>
            <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-200">
              Paper · simulated fills
            </span>
            {state?.phase ? (
              <span className="text-[10px] uppercase tracking-wide text-white/45">{state.phase}</span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-white/55">
            $10,000 simulated capital · deploy-list universe · all bot controls live here
          </p>
          <p className="mt-1 text-[11px] text-white/45">
            Edit deploy list and watchlist on{" "}
            <a
              href={dashboardHref}
              target={embed ? "_top" : undefined}
              rel={embed ? "noopener noreferrer" : undefined}
              className="text-neon underline-offset-2 hover:underline"
            >
              dashboard
            </a>
            .
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={onSimulateDay}
            disabled={loading || busy || account?.killSwitchArmed}
            className="rounded-lg border border-neon/40 bg-neon/15 px-3 py-1.5 text-xs font-medium text-white hover:bg-neon/25 disabled:opacity-50"
            title={account?.killSwitchArmed ? "Disarm kill switch first" : "Run paper policy for today"}
          >
            Simulate day
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || busy}
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setResetOpen(true)}
            disabled={loading || busy}
            className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
          >
            Reset account
          </button>
        </div>
      </div>

      {resetOpen ? (
        <div className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
          <p className="text-sm text-rose-100">
            Reset paper account to $10,000? Clears positions, trades, and snapshots. Active rules stay;
            pending rules are dismissed. <strong>24h promote cooldown</strong> applies after reset.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setStatus(null);
                void resetPaperBotAccount()
                  .then((next) => {
                    setState(next);
                    setResetOpen(false);
                    bumpBrain();
                    setStatus("Paper account reset — kill switch re-armed");
                  })
                  .catch((e) => setError(e instanceof Error ? e.message : "Reset failed"))
                  .finally(() => setBusy(false));
              }}
              className="rounded-lg border border-rose-400/40 px-3 py-1.5 text-xs text-white disabled:opacity-50"
            >
              Confirm reset
            </button>
            <button
              type="button"
              onClick={() => setResetOpen(false)}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {status ? <p className="mb-3 text-xs text-mint">{status}</p> : null}

      {loading && !account ? (
        <p className="text-sm text-white/50">Loading paper account…</p>
      ) : error ? (
        <div className="space-y-3">
          <p className="text-sm text-warn">{error}</p>
          {error.includes("Sign in") ? (
            <div className="rounded-xl border border-dashed border-white/15 bg-black/25 p-4 text-xs text-white/55">
              <p className="font-medium text-white/75">Waiting for dashboard session…</p>
              <p className="mt-2">
                Zone B includes equity/cash health strip, kill switch, Grok rules inbox, equity chart,
                positions, and trade blotter once your login token reaches this terminal.
              </p>
              <p className="mt-2">
                If this persists,{" "}
                <a
                  href={dashboardHref}
                  target={embed ? "_top" : undefined}
                  rel={embed ? "noopener noreferrer" : undefined}
                  className="text-neon underline-offset-2 hover:underline"
                >
                  open dashboard
                </a>{" "}
                and return to Quant AGI, or{" "}
                <a
                  href="/login"
                  target={embed ? "_top" : undefined}
                  rel={embed ? "noopener noreferrer" : undefined}
                  className="text-neon underline-offset-2 hover:underline"
                >
                  sign in again
                </a>
                .
              </p>
            </div>
          ) : null}
        </div>
      ) : account && state ? (
        <>
          <BotHealthStrip account={account} />
          <BotControls
            account={account}
            busy={busy}
            disarmOpen={disarmOpen}
            confirmPhrase={confirmPhrase}
            onConfirmPhraseChange={setConfirmPhrase}
            onToggleKillSwitch={onToggleKillSwitch}
            onConfirmDisarm={onConfirmDisarm}
            onCancelDisarm={() => {
              setDisarmOpen(false);
              setConfirmPhrase("");
            }}
            onToggleDeployListOnly={() => {
              if (!account) return;
              setBusy(true);
              void setPaperBotSettings({ tradeDeployListOnly: !account.tradeDeployListOnly })
                .then((updated) => setState((s) => (s ? { ...s, account: updated } : s)))
                .catch((e) => setError(e instanceof Error ? e.message : "Could not update setting"))
                .finally(() => setBusy(false));
            }}
          />

          <BotRulesInbox
            pendingRules={state.pendingRules}
            activeRules={state.activeRules}
            busy={busy}
            onSubmitNote={(note) => {
              setBusy(true);
              setStatus(null);
              void submitPaperBotNote(note)
                .then((next) => {
                  setState(next);
                  bumpBrain();
                  setStatus(`Grok proposed ${next.pendingRules.length} rule(s) — review below`);
                })
                .catch((e) => setError(e instanceof Error ? e.message : "Could not send note"))
                .finally(() => setBusy(false));
            }}
            onApprove={(ruleId) => {
              setBusy(true);
              void approvePaperBotRule(ruleId)
                .then((next) => {
                  setState(next);
                  bumpBrain();
                  setStatus("Rule approved — policy version bumped");
                })
                .catch((e) => setError(e instanceof Error ? e.message : "Could not approve rule"))
                .finally(() => setBusy(false));
            }}
            onDismiss={(ruleId) => {
              setBusy(true);
              void dismissPaperBotRule(ruleId)
                .then((next) => {
                  setState(next);
                  bumpBrain();
                })
                .catch((e) => setError(e instanceof Error ? e.message : "Could not dismiss rule"))
                .finally(() => setBusy(false));
            }}
          />

          <BotBrainPanel refreshKey={brainRefresh} />

          <div className="mb-4">
            <h3 className="mb-2 text-sm font-semibold text-white/80">Equity curve</h3>
            <BotPerformanceChart snapshots={state.snapshots} />
          </div>

          <div className="mb-4 grid gap-3 lg:grid-cols-2">
            <BotPositionsTable positions={state.positions} />
            <BotTradeBlotter trades={state.recentTrades} />
          </div>

          {state.whyNoTradesToday ? (
            <p className="mb-4 rounded-md border border-white/10 bg-panelAlt/40 px-3 py-2 text-xs text-white/55">
              <span className="font-medium text-white/80">Why no trades today? </span>
              {state.whyNoTradesToday}
            </p>
          ) : null}

          <AutoresearchDailyStrip refreshKey={brainRefresh} />

          <p className="mt-3 border-t border-white/10 pt-3 text-[11px] leading-relaxed text-white/45">
            {state.disclaimer} Policy v{account.policyVersion}.
          </p>
        </>
      ) : null}
    </section>
  );
}
