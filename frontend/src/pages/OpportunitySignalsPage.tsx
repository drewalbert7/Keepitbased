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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-robinhood-gray-900">Opportunity signals</h1>
          <p className="text-robinhood-gray-600 mt-2">
            Deterministic watchlist hits vs your alert baselines (deduped hourly). Also emailed when
            email alerts are on and SMTP is configured.
          </p>
        </div>
        <button type="button" className="btn-secondary whitespace-nowrap" onClick={() => load()}>
          Refresh
        </button>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <p className="text-robinhood-gray-600 py-8 text-center">Loading…</p>
        ) : signals.length === 0 ? (
          <div className="text-center py-12">
            <h3 className="text-lg font-medium text-robinhood-gray-900 mb-2">No signals yet</h3>
            <p className="text-robinhood-gray-600">
              When price action matches your baseline on an active alert, signals appear here (and via
              toast/email if enabled).
            </p>
          </div>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-robinhood-gray-200 text-left text-robinhood-gray-600">
                <th className="py-3 pr-4 font-medium">Time</th>
                <th className="py-3 pr-4 font-medium">Symbol</th>
                <th className="py-3 pr-4 font-medium">Type</th>
                <th className="py-3 pr-4 font-medium">Price</th>
                <th className="py-3 pr-4 font-medium">Vs baseline</th>
                <th className="py-3 pr-4 font-medium">Flags</th>
                <th className="py-3 font-medium">Reasons</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((row) => {
                const flags = Array.isArray(row.flags) ? row.flags : [];
                const reasons = Array.isArray(row.reasons) ? row.reasons : [];
                return (
                <tr key={row.id} className="border-b border-robinhood-gray-100">
                  <td className="py-3 pr-4 text-robinhood-gray-800 whitespace-nowrap">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="py-3 pr-4 font-semibold text-robinhood-gray-900">{row.symbol}</td>
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
                          className="px-2 py-0.5 rounded-md bg-teal-50 text-teal-900 text-xs"
                        >
                          {f}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="py-3 text-robinhood-gray-700 max-w-md">
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
