import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  fetchPaperBotState,
  PAPER_BOT_DISARM_PHRASE,
  setPaperBotKillSwitch,
  setPaperBotSettings,
  type PaperBotState
} from '../services/paperBotApi';

function money(v: number): string {
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function pnlClass(v: number): string {
  if (v > 0) return 'text-emerald-400';
  if (v < 0) return 'text-red-400';
  return 'text-kib-muted';
}

export const PaperTradingBotPanel: React.FC = () => {
  const [state, setState] = useState<PaperBotState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disarmOpen, setDisarmOpen] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const next = await fetchPaperBotState();
      setState(next);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not load paper bot';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const account = state?.account;

  const onToggleKillSwitch = async () => {
    if (!account) return;
    if (account.killSwitchArmed) {
      setDisarmOpen(true);
      return;
    }
    setBusy(true);
    try {
      const updated = await setPaperBotKillSwitch(true);
      setState((s) => (s ? { ...s, account: updated } : s));
      toast.success('Kill switch armed — paper trades paused');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update kill switch');
    } finally {
      setBusy(false);
    }
  };

  const onConfirmDisarm = async () => {
    setBusy(true);
    try {
      const updated = await setPaperBotKillSwitch(false, confirmPhrase);
      setState((s) => (s ? { ...s, account: updated } : s));
      setDisarmOpen(false);
      setConfirmPhrase('');
      toast.success('Kill switch disarmed — automated paper trades can run when Phase 1 ships');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not disarm kill switch');
    } finally {
      setBusy(false);
    }
  };

  const onToggleDeployListOnly = async () => {
    if (!account) return;
    setBusy(true);
    try {
      const updated = await setPaperBotSettings({
        tradeDeployListOnly: !account.tradeDeployListOnly
      });
      setState((s) => (s ? { ...s, account: updated } : s));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update setting');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      id="paper-trading-bot"
      className="scroll-mt-20 rounded-lg border border-violet-500/20 bg-kib-card p-4 sm:p-5"
    >
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-kib-fg sm:text-xl">
              Grok paper trading bot
            </h2>
            <span className="rounded-md bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-200">
              Paper · simulated fills
            </span>
          </div>
          <p className="mt-1 text-sm text-kib-muted">
            $10,000 simulated capital · rules + autoresearch loop (Phase 1+)
          </p>
          <p className="mt-1 text-[11px] text-kib-muted">
            <Link to="/quant-agi" className="text-kib-cyber underline-offset-2 hover:underline">
              Open Quant terminal
            </Link>{' '}
            for full autoresearch diff and coding advisor.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || busy}
          className="btn-secondary shrink-0 px-3 py-1.5 text-xs disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {loading && !account ? (
        <p className="text-sm text-kib-muted">Loading paper account…</p>
      ) : error ? (
        <p className="text-sm text-amber-200">{error}</p>
      ) : account ? (
        <>
          <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border border-white/[0.08] bg-kib-surface px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-kib-muted">Equity</p>
              <p className="text-lg font-semibold tabular-nums text-kib-fg">{money(account.equityUsd)}</p>
            </div>
            <div className="rounded-lg border border-white/[0.08] bg-kib-surface px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-kib-muted">Cash</p>
              <p className="text-lg font-semibold tabular-nums text-kib-fg">{money(account.cashUsd)}</p>
            </div>
            <div className="rounded-lg border border-white/[0.08] bg-kib-surface px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-kib-muted">Day P&L</p>
              <p className={`text-lg font-semibold tabular-nums ${pnlClass(account.dayPnlUsd)}`}>
                {account.dayPnlUsd >= 0 ? '+' : ''}
                {money(account.dayPnlUsd)}
              </p>
            </div>
            <div className="rounded-lg border border-white/[0.08] bg-kib-surface px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-kib-muted">Open risk</p>
              <p className="text-lg font-semibold tabular-nums text-kib-fg">
                {account.openRiskPct.toFixed(1)}%
              </p>
            </div>
            <div className="rounded-lg border border-white/[0.08] bg-kib-surface px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-kib-muted">Last trade</p>
              <p className="text-lg font-semibold tabular-nums text-kib-fg">
                {account.daysSinceLastTrade == null ? '—' : `${account.daysSinceLastTrade}d ago`}
              </p>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-white/[0.08] bg-kib-surface px-3 py-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onToggleKillSwitch()}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                account.killSwitchArmed
                  ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
                  : 'bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/30'
              }`}
            >
              Kill switch: {account.killSwitchArmed ? 'Armed' : 'Disarmed'}
            </button>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-kib-muted">
              <input
                type="checkbox"
                checked={account.tradeDeployListOnly}
                disabled={busy}
                onChange={() => void onToggleDeployListOnly()}
                className="rounded border-white/20"
              />
              Trade deploy list only
            </label>
            <span className="text-[11px] text-kib-muted">
              Cumulative P&L:{' '}
              <span className={pnlClass(account.cumPnlUsd)}>
                {account.cumPnlUsd >= 0 ? '+' : ''}
                {money(account.cumPnlUsd)}
              </span>
            </span>
          </div>

          {disarmOpen ? (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-sm text-amber-100">
                Type <strong className="font-mono">{PAPER_BOT_DISARM_PHRASE}</strong> to disarm the kill
                switch.
              </p>
              <input
                type="text"
                value={confirmPhrase}
                onChange={(e) => setConfirmPhrase(e.target.value)}
                className="mt-2 w-full max-w-md rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-kib-fg"
                placeholder={PAPER_BOT_DISARM_PHRASE}
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onConfirmDisarm()}
                  className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  Confirm disarm
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setDisarmOpen(false);
                    setConfirmPhrase('');
                  }}
                  className="btn-secondary px-3 py-1.5 text-xs"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          <div className="mb-4 rounded-lg border border-dashed border-white/[0.12] bg-black/20 px-4 py-8 text-center">
            <p className="text-sm font-medium text-kib-fg">Performance chart</p>
            <p className="mt-1 text-xs text-kib-muted">
              Equity curve + daily P&L bars (7D / 30D / All) — Phase 1 after{' '}
              <code className="text-kib-cyber/90">paper_bot_daily_snapshots</code>
            </p>
          </div>

          <div className="mb-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-white/[0.08] bg-kib-surface/80 p-3">
              <h3 className="text-sm font-semibold text-kib-fg">Open positions</h3>
              <p className="mt-2 text-xs text-kib-muted">No open positions — simulator ships in Phase 1.</p>
            </div>
            <div className="rounded-lg border border-white/[0.08] bg-kib-surface/80 p-3">
              <h3 className="text-sm font-semibold text-kib-fg">Recent trades</h3>
              <p className="mt-2 text-xs text-kib-muted">Trade blotter empty — fills appear after run-day.</p>
            </div>
          </div>

          {state?.whyNoTradesToday ? (
            <p className="mb-4 rounded-md border border-white/[0.08] bg-kib-surface px-3 py-2 text-xs text-kib-muted">
              <span className="font-medium text-kib-fg">Why no trades today? </span>
              {state.whyNoTradesToday}
            </p>
          ) : null}

          <div className="rounded-lg border border-white/[0.08] bg-kib-surface/60 p-3">
            <h3 className="text-sm font-semibold text-kib-fg">Karpathy autoresearch</h3>
            <p className="mt-1 text-xs text-kib-muted">
              Nightly paper P&L review and patch proposals — Phase 3. Summary strip will appear here.
            </p>
          </div>

          <p className="mt-3 border-t border-white/[0.06] pt-3 text-[11px] leading-relaxed text-kib-muted">
            {state.disclaimer} Policy v{account.policyVersion}.
          </p>
        </>
      ) : null}
    </section>
  );
};
