import React from 'react';

type Props = {
  assetType: string;
  currentPrice: number | null | undefined;
  week52High?: number | null;
  week52Low?: number | null;
};

function fmtPrice(price: number | null | undefined, assetType: string): string {
  if (price == null || Number.isNaN(Number(price))) return '—';
  const p = Number(price);
  const digits = assetType === 'crypto' && p < 10 ? 4 : 2;
  return `$${p.toFixed(digits)}`;
}

/**
 * Fidelity-style trailing ~52-week range: bar from daily lows to highs (~252 sessions),
 * small diamond marker for last price position within the band.
 */
export const Watchlist52WeekRange: React.FC<Props> = ({
  assetType,
  currentPrice,
  week52High,
  week52Low
}) => {
  const hi = week52High != null ? Number(week52High) : NaN;
  const lo = week52Low != null ? Number(week52Low) : NaN;
  const px = currentPrice != null ? Number(currentPrice) : NaN;

  if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi <= lo) {
    return (
      <span className="text-slate-500 text-xs" title="52-week range unavailable (quotes need market data)">
        —
      </span>
    );
  }

  let pct = Number.isFinite(px) ? ((px - lo) / (hi - lo)) * 100 : NaN;
  if (!Number.isFinite(pct)) pct = 50;
  const clamped = Math.min(100, Math.max(0, pct));

  const title = Number.isFinite(px)
    ? `Last ${fmtPrice(px, assetType)} · ~${clamped.toFixed(0)}% along trailing ~52-week range (daily bars)`
    : 'Trailing ~52-week range from daily highs and lows';

  return (
    <div className="w-full min-w-[112px] max-w-[176px]" title={title}>
      <div className="flex justify-between gap-1 text-[10px] tabular-nums leading-none text-slate-500">
        <span className="min-w-0 truncate">{fmtPrice(lo, assetType)}</span>
        <span className="min-w-0 truncate text-right">{fmtPrice(hi, assetType)}</span>
      </div>
      <div className="relative mt-1 h-2.5">
        <div
          className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full border border-white/[0.12] bg-gradient-to-r from-slate-800 via-slate-700/90 to-slate-800 shadow-inner"
          aria-hidden
        />
        <div
          className="absolute top-1/2 z-10 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] border border-white/35 bg-teal-400 shadow-[0_1px_2px_rgba(0,0,0,0.45)]"
          style={{ left: `${clamped}%` }}
          aria-hidden
        />
      </div>
      <p className="mt-0.5 text-[9px] uppercase tracking-wide text-slate-600">52-week range</p>
    </div>
  );
};
