import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  fetchOpportunitySignals,
  OpportunitySignalRow
} from '../services/opportunitySignalsService';

function formatPrice(row: OpportunitySignalRow): string {
  const n = Number(row.price);
  if (!Number.isFinite(n)) return String(row.price);
  if (row.asset_type === 'crypto' && Math.abs(n) < 1) return n.toFixed(6);
  return n.toFixed(2);
}

function formatOpportunityFlag(flag: string): string {
  if (flag === 'capitulation') return 'Major Capitulation – Long-term Setup';
  return flag;
}

const OpportunitySignalsPage: React.FC = () => {
  const [signals, setSignals] = useState<OpportunitySignalRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const rows = await fetchOpportunitySignals(100);
      setSignals(rows);
    } catch {
      toast.error('Could not load opportunity signals');
      setSignals([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 45000);
    return () => window.clearInterval(t);
  }, [load]);

  return (
    <div className="mx-auto max-w-[1360px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-kib-fg sm:text-3xl">Opportunity signals</h1>
          <p className="mt-2 text-sm text-kib-muted sm:text-base">
            Stage 1: deterministic opportunity flags vs your baselines (same dedupe windows as the dashboard).
            Stage 2 (UltimateDipBuyer AI): when dip-insight email is enabled, Grok adds a structured verdict,
            confidence, and timing notes — stored here even if the rich email is gated (e.g. Hold/Pass).
          </p>
        </div>
        <button type="button" className="btn-secondary whitespace-nowrap" onClick={() => load()}>
          Refresh
        </button>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <p className="text-kib-muted py-8 text-center">Loading…</p>
        ) : signals.length === 0 ? (
          <div className="text-center py-12">
            <h3 className="text-lg font-medium text-kib-fg mb-2">No signals yet</h3>
            <p className="text-kib-muted">
              When price action matches your baseline on an active alert, signals appear here (and via
              toast/email if enabled).
            </p>
          </div>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-kib-line text-left text-kib-muted">
                <th className="py-3 pr-4 font-medium">Time</th>
                <th className="py-3 pr-4 font-medium">Symbol</th>
                <th className="py-3 pr-4 font-medium">Type</th>
                <th className="py-3 pr-4 font-medium">Price</th>
                <th className="py-3 pr-4 font-medium">Vs baseline</th>
                <th className="py-3 pr-4 font-medium">Flags</th>
                <th className="py-3 pr-4 font-medium min-w-[140px]">UltimateDipBuyer AI</th>
                <th className="py-3 font-medium">Reasons</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((row) => {
                const flags = Array.isArray(row.flags) ? row.flags : [];
                const reasons = Array.isArray(row.reasons) ? row.reasons : [];
                const ai = row.ai_assessment;
                return (
                <tr key={row.id} className="border-b border-slate-800">
                  <td className="py-3 pr-4 text-slate-300 whitespace-nowrap">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="py-3 pr-4 font-semibold text-kib-fg">{row.symbol}</td>
                  <td className="py-3 pr-4 capitalize">{row.asset_type}</td>
                  <td className="py-3 pr-4">${formatPrice(row)}</td>
                  <td className="py-3 pr-4">
                    {row.vs_baseline_pct != null
                      ? `${Number(row.vs_baseline_pct).toFixed(2)}%`
                      : '—'}
                  </td>
                  <td className="py-3 pr-4">
                    <span className="inline-flex flex-wrap gap-1">
                      {flags.map((f) => (
                        <span
                          key={f}
                          className={`px-2 py-0.5 rounded-md border text-xs font-mono ${
                            f === 'capitulation'
                              ? 'bg-violet-950/55 text-violet-200 border-violet-500/35 max-w-[220px] whitespace-normal'
                              : 'bg-teal-950/55 text-teal-200 border-teal-500/30'
                          }`}
                        >
                          {formatOpportunityFlag(f)}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="py-3 pr-4 align-top text-xs text-slate-300 max-w-[220px]">
                    {ai?.verdict ? (
                      <div className="space-y-1">
                        <div className="font-semibold text-kib-cyber/90">{ai.verdict}</div>
                        {ai.confidence != null && (
                          <div className="tabular-nums text-kib-muted">
                            Confidence {Math.round(Number(ai.confidence))}%
                          </div>
                        )}
                        {ai.emailSent === false && ai.emailSuppressReason ? (
                          <div className="text-[10px] text-amber-200/90">
                            Email gated ({ai.emailSuppressReason.replace(/_/g, ' ')})
                          </div>
                        ) : ai.emailSent ? (
                          <div className="text-[10px] text-emerald-200/80">Email sent</div>
                        ) : null}
                        {ai.reasoning ? (
                          <p className="mt-1 text-[11px] leading-snug text-slate-400 line-clamp-4" title={ai.reasoning}>
                            {ai.reasoning}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="py-3 text-slate-300 max-w-md">
                    <ul className="list-disc list-inside space-y-0.5">
                      {reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default OpportunitySignalsPage;
