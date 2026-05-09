import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  fetchStockFundamentals,
  secIssuerBrowseUrl,
  type StockFundamentals
} from '../services/fundamentalsApi';

function fmtCompactUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtMultiple(n: number | null | undefined, suffix = '×'): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${Number(n.toFixed(n < 10 ? 2 : 1))}${suffix}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

type RowProps = { label: string; value: string };

const Row: React.FC<RowProps> = ({ label, value }) => (
  <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] py-2 text-[13px] last:border-b-0">
    <span className="text-kib-muted">{label}</span>
    <span className="max-w-[60%] text-right font-mono text-xs text-kib-fg tabular-nums">{value}</span>
  </div>
);

interface StockFundamentalsModalProps {
  symbol: string | null;
  open: boolean;
  onClose: () => void;
}

export const StockFundamentalsModal: React.FC<StockFundamentalsModalProps> = ({ symbol, open, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<StockFundamentals | null>(null);

  const load = useCallback(async (sym: string) => {
    setLoading(true);
    setErr(null);
    setData(null);
    try {
      const payload = await fetchStockFundamentals(sym);
      setData(payload);
    } catch (e: unknown) {
      if (axios.isAxiosError(e)) {
        const d = e.response?.data as { message?: string; detail?: string } | undefined;
        setErr(d?.detail || d?.message || e.message || 'Could not load fundamentals');
      } else {
        setErr('Could not load fundamentals');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !symbol) return;
    void load(symbol);
  }, [open, symbol, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !symbol) return null;

  const title = data?.companyName ? `${symbol} · ${data.companyName}` : symbol;
  const filingHref = secIssuerBrowseUrl(symbol);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-black/65 backdrop-blur-[2px]"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative z-[81] mx-3 mb-8 w-full max-w-lg rounded-2xl border border-white/[0.08] bg-kib-card p-5 shadow-soft sm:mx-6 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-kib-fg">{title}</h2>
            <p className="mt-1 text-[11px] text-kib-muted">
              Consolidated snapshots from upstream data feeds — delayed; not audited statements. Educational only.
            </p>
          </div>
          <button
            type="button"
            className="-mr-2 -mt-2 rounded-lg px-2 py-1 text-sm text-kib-muted hover:bg-white/[0.05] hover:text-kib-fg"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {loading && <p className="mt-6 text-sm text-kib-muted">Loading fundamentals…</p>}
        {err && (
          <p className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            {err}
          </p>
        )}
        {!loading && !err && data && (
          <div className="mt-4 max-h-[min(60vh,420px)] overflow-y-auto">
            {(data.sector || data.industry) && (
              <p className="mb-2 text-[11px] text-kib-muted">
                {[data.sector, data.industry].filter(Boolean).join(' · ') || null}
              </p>
            )}
            <Row label="Market cap" value={fmtCompactUsd(data.marketCap ?? undefined)} />
            <Row label="Enterprise value" value={fmtCompactUsd(data.enterpriseValue ?? undefined)} />
            <Row label="Total revenue (TTM)" value={fmtCompactUsd(data.totalRevenue ?? undefined)} />
            <Row label="EV / Revenue" value={fmtMultiple(data.enterpriseToRevenue ?? undefined)} />
            <Row label="Trailing P/E" value={fmtMultiple(data.trailingPE ?? undefined, '')} />
            <Row label="Forward P/E" value={fmtMultiple(data.forwardPE ?? undefined, '')} />
            <Row label="P/S (TTM)" value={fmtMultiple(data.priceToSalesTrailing12Months ?? undefined)} />
            <Row label="P/B" value={fmtMultiple(data.priceToBook ?? undefined)} />
            <Row label="Gross margin" value={fmtPct(data.grossMargins ?? undefined)} />
            <Row label="Operating margin" value={fmtPct(data.operatingMargins ?? undefined)} />
            <Row label="Profit margin" value={fmtPct(data.profitMargins ?? undefined)} />
            <Row label="Revenue growth" value={fmtPct(data.revenueGrowth ?? undefined)} />
            <Row label="Debt / Equity" value={fmtMultiple(data.debtToEquity ?? undefined)} />
            <Row label="Total cash" value={fmtCompactUsd(data.totalCash ?? undefined)} />
            <Row label="Total debt" value={fmtCompactUsd(data.totalDebt ?? undefined)} />
            <Row label="Free cash flow" value={fmtCompactUsd(data.freeCashflow ?? undefined)} />
            <Row label="EBITDA" value={fmtCompactUsd(data.ebitda ?? undefined)} />
            <Row label="As of (feed)" value={data.timestamp ? new Date(data.timestamp).toLocaleString() : '—'} />
          </div>
        )}

        <div className="mt-5 border-t border-white/[0.06] pt-4">
          <p className="text-[11px] leading-snug text-kib-muted">
            Primary regulatory filings live on SEC.gov — use the issuer page for 10‑K / 10‑Q and exhibits.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={filingHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition hover:bg-cyan-500/20"
            >
              Open SEC filings ↗
            </a>
            <button
              type="button"
              className="rounded-lg border border-white/[0.1] px-3 py-1.5 text-xs text-kib-muted hover:bg-white/[0.04]"
              onClick={onClose}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
