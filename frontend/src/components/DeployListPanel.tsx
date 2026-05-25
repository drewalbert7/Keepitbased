import React from 'react';
import type { DeployListItem } from '../services/deployListApi';

export const DeployListPanel: React.FC<{
  items: DeployListItem[];
  totalTargetWeightPct: number;
  loading: boolean;
  optimizing: boolean;
  onOptimize: () => void;
  onClear: () => void;
  onRemove: (alertId: number) => void;
}> = ({ items, totalTargetWeightPct, loading, optimizing, onOptimize, onClear, onRemove }) => {
  return (
    <div className="mt-6 rounded-lg border border-emerald-500/25 bg-emerald-950/15 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-kib-fg">Deploy list</h3>
          <p className="mt-1 max-w-2xl text-xs text-kib-muted sm:text-sm">
            One capital-ready list — Grok ranks ideal dips vs your baselines and suggests how much to
            deploy (within Profile max position %).{' '}
            <strong className="text-amber-200/90">No brokerage orders yet.</strong>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary text-sm py-2 px-4 disabled:opacity-50"
            disabled={loading || optimizing}
            onClick={onOptimize}
          >
            {optimizing ? 'Optimizing…' : 'Optimize with Grok'}
          </button>
          {items.length > 0 && (
            <button
              type="button"
              className="btn-secondary text-sm py-2 px-3 disabled:opacity-50"
              disabled={loading || optimizing}
              onClick={onClear}
            >
              Clear list
            </button>
          )}
        </div>
      </div>

      <p className="mt-3 text-xs text-kib-muted">
        Total suggested weight:{' '}
        <span className="font-mono font-medium text-kib-fg">{totalTargetWeightPct.toFixed(1)}%</span>
        {items.length > 0 ? ` across ${items.length} name(s)` : ''}
      </p>

      {loading && items.length === 0 ? (
        <p className="mt-4 text-sm text-kib-muted">Loading deploy list…</p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-sm text-kib-muted">
          Check <strong className="text-kib-fg/90">Deploy</strong> on US watchlist rows, or run{' '}
          <strong className="text-kib-fg/90">Optimize with Grok</strong> to fill the list from ideal dips.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-md border border-white/[0.06]">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-kib-surface/80 text-[10px] uppercase tracking-wide text-kib-muted">
              <tr>
                <th className="px-3 py-2 text-left">Symbol</th>
                <th className="px-3 py-2 text-right">Deploy %</th>
                <th className="px-3 py-2 text-left">Limit band</th>
                <th className="px-3 py-2 text-left">Rationale</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {items.map((it) => (
                <tr key={it.id} className="hover:bg-white/[0.02]">
                  <td className="px-3 py-2 font-mono font-semibold text-kib-fg">{it.symbol}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-kib-cyber">
                    {it.targetWeightPct != null ? `${it.targetWeightPct}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums text-kib-muted">
                    {it.suggestedLimitMin != null && it.suggestedLimitMax != null
                      ? `$${it.suggestedLimitMin} – $${it.suggestedLimitMax}`
                      : '—'}
                  </td>
                  <td className="max-w-[240px] px-3 py-2 text-xs text-kib-muted truncate" title={it.grokRationale || ''}>
                    {it.grokRationale || (it.source === 'manual' ? 'Added manually' : '—')}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="text-xs text-red-500 hover:underline"
                      onClick={() => onRemove(it.userAlertId)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
