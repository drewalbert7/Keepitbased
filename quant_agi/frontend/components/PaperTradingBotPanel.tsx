"use client";

import { useCallback, useEffect, useState } from "react";
import { AutoresearchDailyStrip } from "./bot/AutoresearchDailyStrip";
import { BotBrainPanel } from "./bot/BotBrainPanel";
import { BotImprovementLog } from "./bot/BotImprovementLog";
import { BotControls } from "./bot/BotControls";
import { BotHealthStrip } from "./bot/BotHealthStrip";
import { BotPerformanceChart } from "./bot/BotPerformanceChart";
import { BotPositionsTable } from "./bot/BotPositionsTable";
import { BotRulesInbox } from "./bot/BotRulesInbox";
import { BotStatusBar } from "./bot/BotStatusBar";
import { BotTradeBlotter } from "./bot/BotTradeBlotter";
import {
  approvePaperBotRule,
  clearPendingPaperBotRules,
  removePaperBotRule,
  fetchPaperBotState,
  setPaperBotRun,
  setPaperBotSettings,
  type PaperBotUniverseMode,
  resetPaperBotAccount,
  simulatePaperBotDay,
  submitPaperBotNote,
  type PaperBotState
} from "../lib/paperBotApi";
import { onAuthTokenReady } from "../lib/authBridge";
import { PaperBotSocketBridge } from "./PaperBotSocketBridge";

export function PaperTradingBotPanel({ embed = false }: { embed?: boolean }) {
  const [state, setState] = useState<PaperBotState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [turnOnOpen, setTurnOnOpen] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [brainRefresh, setBrainRefresh] = useState(0);
  const [resetOpen, setResetOpen] = useState(false);
  const [socketLive, setSocketLive] = useState(false);

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

  const onSocketUpdate = useCallback(
    (payload: { hint?: string | null }) => {
      void load();
      bumpBrain();
      if (payload.hint) setStatus(payload.hint);
    },
    [load]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return onAuthTokenReady(() => {
      setLoading(true);
      void load();
    });
  }, [load]);

  useEffect(() => {
    if (!state?.botRuntime?.botOn) return undefined;
    const id = window.setInterval(() => void load(), 60000);
    return () => window.clearInterval(id);
  }, [load, state?.botRuntime?.botOn]);

  const account = state?.account;
  const runtime = state?.botRuntime;

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
          setStatus(`Run now — ${next.runDay?.fillCount ?? 0} fill(s)`);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Run now failed"))
      .finally(() => setBusy(false));
  };

  const onConfirmTurnOn = () => {
    setBusy(true);
    setStatus(null);
    void setPaperBotRun(true, confirmPhrase)
      .then(({ account: updated, botRuntime }) => {
        setState((s) => (s ? { ...s, account: updated, botRuntime } : s));
        setTurnOnOpen(false);
        setConfirmPhrase("");
        setStatus(botRuntime.marketOpen ? "Bot ON — trading during market hours" : "Bot ON — waiting for market open");
        return load();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not turn bot on"))
      .finally(() => setBusy(false));
  };

  const onTurnOff = () => {
    setBusy(true);
    setStatus(null);
    void setPaperBotRun(false)
      .then(({ account: updated, botRuntime }) => {
        setState((s) => (s ? { ...s, account: updated, botRuntime } : s));
        setStatus("Bot OFF");
        return load();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not turn bot off"))
      .finally(() => setBusy(false));
  };

  const onConfirmReset = () => {
    setBusy(true);
    setStatus(null);
    void resetPaperBotAccount()
      .then((next) => {
        setState(next);
        setResetOpen(false);
        bumpBrain();
        setStatus("Paper account reset — bot is OFF");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Reset failed"))
      .finally(() => setBusy(false));
  };

  const dashboardHref = "/dashboard";

  return (
    <section
      id="quant-agi-bot"
      className="scroll-mt-4 rounded-2xl border border-violet-500/30 bg-panel/80 p-4 sm:p-5 backdrop-blur"
    >
      <PaperBotSocketBridge onUpdate={onSocketUpdate} onConnected={setSocketLive} />
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-violet-300/80">Zone B</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-white sm:text-xl">Quant AGI Bot</h2>
            <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-200">
              Paper · simulated fills
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                socketLive ? "bg-mint/20 text-mint" : "bg-white/10 text-white/45"
              }`}
            >
              {socketLive ? "Live feed" : "Polling"}
            </span>
          </div>
          <p className="mt-1 text-sm text-white/55">
            Auto-trades during US market hours when <strong className="text-white/75">Bot ON</strong> · your
            symbols or <strong className="text-white/75">quant auto-pick</strong> · $10k paper capital
          </p>
          <p className="mt-1 text-[11px] text-white/45">
            Deploy list &amp; watchlist on{" "}
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
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || busy}
          className="shrink-0 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

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
                Sign in on the dashboard so the bot can load your paper account and auto-run during market
                hours.
              </p>
            </div>
          ) : null}
        </div>
      ) : account && state && runtime ? (
        <>
          <BotStatusBar
            account={account}
            runtime={runtime}
            busy={busy}
            turnOnOpen={turnOnOpen}
            confirmPhrase={confirmPhrase}
            resetOpen={resetOpen}
            onTurnOn={() => setTurnOnOpen(true)}
            onTurnOff={onTurnOff}
            onConfirmTurnOn={onConfirmTurnOn}
            onCancelTurnOn={() => {
              setTurnOnOpen(false);
              setConfirmPhrase("");
            }}
            onConfirmPhraseChange={setConfirmPhrase}
            onRunNow={onSimulateDay}
            onResetClick={() => setResetOpen(true)}
            onConfirmReset={onConfirmReset}
            onCancelReset={() => setResetOpen(false)}
          />

          <BotHealthStrip account={account} />

          <div className="mb-4">
            <h3 className="mb-2 text-sm font-semibold text-white/80">Equity curve</h3>
            <BotPerformanceChart snapshots={state.snapshots} />
          </div>

          <div className="mb-4 grid gap-3 lg:grid-cols-2">
            <BotPositionsTable positions={state.positions} />
            <BotTradeBlotter trades={state.recentTrades} />
          </div>

          <BotControls
            account={account}
            busy={busy}
            onUniverseModeChange={(mode: PaperBotUniverseMode) => {
              setBusy(true);
              void setPaperBotSettings({ universeMode: mode })
                .then((updated) => {
                  setState((s) => (s ? { ...s, account: updated } : s));
                  bumpBrain();
                  setStatus(
                    mode === "quant_auto_agent"
                      ? "Quant multi-agent enabled — LangGraph plans entries/exits each tick"
                      : mode === "quant_auto"
                        ? "Quant auto-pick enabled — bot will rank and trade top scores"
                        : mode === "deploy_list_only"
                        ? "Universe limited to deploy list"
                        : "Universe: watchlist + deploy list"
                  );
                })
                .catch((e) => setError(e instanceof Error ? e.message : "Could not update universe"))
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
            onRemove={(ruleId) => {
              setBusy(true);
              void removePaperBotRule(ruleId)
                .then((next) => {
                  setState(next);
                  bumpBrain();
                  setStatus("Rule removed");
                })
                .catch((e) => setError(e instanceof Error ? e.message : "Could not remove rule"))
                .finally(() => setBusy(false));
            }}
            onClearPending={() => {
              setBusy(true);
              void clearPendingPaperBotRules()
                .then((next) => {
                  setState(next);
                  bumpBrain();
                  setStatus("All pending rules removed");
                })
                .catch((e) => setError(e instanceof Error ? e.message : "Could not clear pending rules"))
                .finally(() => setBusy(false));
            }}
          />

          <BotBrainPanel
            refreshKey={brainRefresh}
            onReflectionComplete={() => {
              bumpBrain();
              void load();
            }}
          />

          <BotImprovementLog refreshKey={brainRefresh} />

          {state.whyNoTradesToday ? (
            <p className="mb-4 rounded-md border border-white/10 bg-panelAlt/40 px-3 py-2 text-xs text-white/55">
              <span className="font-medium text-white/80">Why no trades today? </span>
              {state.whyNoTradesToday}
            </p>
          ) : null}

          <AutoresearchDailyStrip refreshKey={brainRefresh} />

          <p className="mt-3 border-t border-white/10 pt-3 text-[11px] leading-relaxed text-white/45">
            {state.disclaimer}
          </p>
        </>
      ) : null}
    </section>
  );
}
