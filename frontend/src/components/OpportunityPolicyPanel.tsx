import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertDeliveryPreferences } from './AlertDeliveryPreferences';
import { fetchPublicHealthConfig, type PublicHealthConfig } from '../services/healthConfigService';

function formatDedupe(ttlSec: number | undefined) {
  if (ttlSec == null || !Number.isFinite(ttlSec) || ttlSec <= 0) return '—';
  if (ttlSec % 3600 === 0) {
    const h = ttlSec / 3600;
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  if (ttlSec % 60 === 0) {
    const m = ttlSec / 60;
    return m === 1 ? '1 minute' : `${m} minutes`;
  }
  return `${ttlSec}s`;
}

export const OpportunityPolicyPanel: React.FC<{
  className?: string;
  /** Nested inside a parent card with its own title bar — drops duplicate chrome */
  embedInPanel?: boolean;
}> = ({ className = '', embedInPanel = false }) => {
  const [cfg, setCfg] = useState<PublicHealthConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const c = await fetchPublicHealthConfig();
      if (!cancelled) {
        setCfg(c);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const mode = cfg?.opportunityTriggerMode === 'pct' ? 'pct' : 'atr';
  const onSaleAtr = cfg?.opportunityOnSaleAtrMult ?? 1.25;
  const overAtr = cfg?.opportunityOverreactionAtrMult ?? 2.5;
  const onSalePct = cfg?.opportunityOnSaleDropPct ?? 5;
  const overPct = cfg?.opportunityOverreactionDropPct ?? 12;
  const volMult = cfg?.opportunityVolSpikeMult ?? 2;
  const dedupe = formatDedupe(cfg?.opportunityDedupeTtlSec);
  const capDedupe = formatDedupe(cfg?.opportunityCapitulationDedupeTtlSec);
  const capA14 = cfg?.opportunityCapitulationAtr14Mult ?? 4;
  const capA50 = cfg?.opportunityCapitulationAtr50Mult ?? 3;
  const cap52 = cfg?.opportunityCapitulationFrom52wPct ?? 20;
  const capFb52 = cfg?.opportunityCapitulationFallback52wPct ?? 18;
  const capMegaAth = cfg?.opportunityCapitulationMegaCapAthPct ?? 15;
  const megaCount = cfg?.opportunityMegaCapSymbolCount;
  const trendOn = cfg?.opportunityShortTrendFilterEnabled === true;
  const trendDays = cfg?.opportunityShortTrendSmaDays ?? 200;
  const atrFloorPct = cfg?.opportunityAtrMinPctOfPrice ?? 0;
  const showMarketDataWarning = !!cfg && cfg.marketDataKeyPresent === false;

  const shell = embedInPanel
    ? `p-4 sm:p-5 ${className}`
    : `rounded-lg border border-white/[0.08] bg-kib-surface p-4 sm:p-5 ${className}`;

  return (
    <aside className={shell} aria-labelledby={embedInPanel ? undefined : 'opp-policy-heading'}>
      {!embedInPanel && (
        <>
          <h3 id="opp-policy-heading" className="text-sm font-semibold tracking-tight text-kib-fg">
            Opportunity alerts
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-kib-muted sm:text-xs">
            Live “dip” signals (toasts, optional email,{' '}
            <Link to="/opportunity-signals" className="text-kib-cyber underline-offset-2 hover:underline">
              signals inbox
            </Link>
            ) use <strong className="font-medium text-kib-fg">one global policy</strong> on the server — not per ticker in the UI.
          </p>
        </>
      )}
      {embedInPanel && (
        <p className="mb-3 text-[11px] leading-relaxed text-kib-muted">
          Toasts &amp; optional email use these thresholds.{' '}
          <Link to="/opportunity-signals" className="text-kib-cyber underline-offset-2 hover:underline">
            Open signals inbox
          </Link>
          {' '}
          · one global policy (not per ticker).
        </p>
      )}

      {loading && <p className={`text-xs text-kib-muted ${embedInPanel ? 'mt-0' : 'mt-3'}`}>Loading policy…</p>}

      {!loading && !cfg && (
        <p className="text-xs text-amber-600/90 mt-3">Could not load server policy. Values below are defaults.</p>
      )}

      <div className={`${embedInPanel ? 'mt-0' : 'mt-3'} space-y-2 text-xs leading-relaxed text-kib-fg/90`}>
        <p>
          <span className="text-kib-muted">When it runs:</span> you have an <strong>active</strong> watchlist alert with a{' '}
          <strong>baseline price</strong>, and the latest quote is evaluated against that baseline.
        </p>

        {mode === 'atr' ? (
          <>
            <p>
              <span className="text-kib-muted">Primary rule (ATR):</span> if price is <strong>below</strong> baseline, we
              measure the gap in units of <strong>14-day Wilder ATR</strong> from daily bars (volatility-normalized).
            </p>
            <ul className="list-disc space-y-1 pl-4 text-[11px] text-kib-muted">
              <li>
                <span className="font-medium text-kib-cyber">on_sale</span> when dip ≥{' '}
                <strong className="tabular-nums text-kib-fg">{onSaleAtr}×</strong> ATR (14-day)
              </li>
              <li>
                <span className="font-medium text-kib-cyber">overreaction</span> when dip ≥{' '}
                <strong className="tabular-nums text-kib-fg">{overAtr}×</strong> ATR (14-day)
              </li>
            </ul>
            <p className="mt-2 text-[11px] text-kib-muted">
              <span className="text-kib-fg/90 font-medium">Long-term setup (parallel):</span>{' '}
              <span className="font-mono text-violet-200/90">capitulation</span> is labeled in the app as{' '}
              <strong className="text-kib-fg/90">Major Capitulation – Long-term Setup</strong>. It may fire
              when (a) dip ≥ <strong className="tabular-nums text-kib-fg">{capA14}×</strong> 14-day ATR or (b) ≥{' '}
              <strong className="tabular-nums text-kib-fg">{capA50}×</strong> 50-day ATR measured from{' '}
              <strong className="text-kib-fg/90">max(your baseline, trailing ~52-week high)</strong> when highs exist,
              (c) ≥{' '}
              <strong className="tabular-nums text-kib-fg">{cap52}%</strong> below trailing ~52-week high, (d) optional
              mega-cap rule ≥ <strong className="tabular-nums text-kib-fg">{capMegaAth}%</strong> below a long-window high
              proxy
              {megaCount != null ? (
                <>
                  {' '}
                  (<strong className="tabular-nums text-kib-fg">{megaCount}</strong> symbols configured)
                </>
              ) : null}
              , or (e) a softer structural fallback ≥ <strong className="tabular-nums text-kib-fg">{capFb52}%</strong>{' '}
              below ~52w when violent ATR legs have not fired yet.
            </p>
            {showMarketDataWarning && (
              <p className="text-[11px] text-amber-200/90 border border-amber-500/25 rounded-md px-2 py-1.5 bg-amber-950/40">
                Market data key missing — ATR may be unavailable; the service falls back to % rules below.
              </p>
            )}
          </>
        ) : (
          <p>
            <span className="text-kib-muted">Percentage mode:</span> flags use fixed drops vs your baseline:{' '}
            <strong className="text-kib-fg">−{onSalePct}%</strong> for <span className="font-medium text-kib-cyber">on_sale</span>,{' '}
            <strong className="text-kib-fg">−{overPct}%</strong> for <span className="font-medium text-kib-cyber">overreaction</span>.
          </p>
        )}

        {mode === 'atr' && (
          <p>
            <span className="text-kib-muted">If ATR is missing:</span> same thresholds as % fallback —{' '}
            <strong className="text-kib-fg">−{onSalePct}%</strong> / <strong className="text-kib-fg">−{overPct}%</strong>{' '}
            vs baseline (global values).
          </p>
        )}

        <p className="text-[11px] text-kib-muted">
          Vol-spike overreaction (&gt;{volMult}× a “typical” intraday move) is only used when the server supplies typical-move
          data; the live price loop usually relies on ATR or % vs baseline.
        </p>

        <p className="text-[11px] text-kib-muted">
          <span className="text-kib-fg/90 font-medium">Trend filter (short tiers only):</span>{' '}
          {trendOn ? (
            <>
              enabled — <span className="font-mono text-kib-fg/90">on_sale</span> /{' '}
              <span className="font-mono text-kib-fg/90">overreaction</span> fire only when last price is{' '}
              <strong>above</strong> the <strong className="tabular-nums text-kib-fg">{trendDays}</strong>-day simple moving
              average (fail-open if SMA cannot be computed). Capitulation ignores this filter.
            </>
          ) : (
            <>off — set OPPORTUNITY_SHORT_TREND_FILTER_ENABLED=true on the API host to require price &gt; N-day SMA for short tiers.</>
          )}
        </p>

        {atrFloorPct > 0 ? (
          <p className="text-[11px] text-kib-muted">
            <span className="text-kib-fg/90 font-medium">ATR floor:</span> daily ATR is ignored for rules when it falls below{' '}
            <strong className="tabular-nums text-kib-fg">{atrFloorPct}%</strong> of price (penny / noisy names).
          </p>
        ) : (
          <p className="text-[11px] text-kib-muted">
            <span className="text-kib-fg/90 font-medium">ATR floor:</span> off (set OPPORTUNITY_ATR_MIN_PCT_OF_PRICE to e.g.{' '}
            <span className="font-mono">0.05</span> for 0.05% of price).
          </p>
        )}

        <p>
          <span className="text-kib-muted">Deduping (short tiers):</span> at most one short-tier burst per symbol per{' '}
          <strong className="text-kib-fg">{dedupe}</strong> per user.{' '}
          <span className="text-kib-muted">Capitulation tier uses a separate window (default </span>
          <strong className="text-kib-fg">{capDedupe}</strong>
          <span className="text-kib-muted">) so multi-day setups do not spam while still allowing hourly short-tier hits.</span>
        </p>
      </div>

      <div className="mt-4 border-t border-white/[0.06] pt-3">
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-kib-muted">Global customization</p>
        <p className="text-[10px] leading-relaxed text-kib-muted">
          Operators change these for <strong className="text-kib-fg/90">everyone</strong> via environment variables on the API
          host (then restart). Examples: <code className="rounded bg-black/25 px-1 font-mono text-[11px] text-kib-fg/80">OPPORTUNITY_TRIGGER_MODE</code>,{' '}
          <code className="rounded bg-black/25 px-1 font-mono text-[11px] text-kib-fg/80">OPPORTUNITY_ON_SALE_ATR_MULT</code>,{' '}
          <code className="rounded bg-black/25 px-1 font-mono text-[11px] text-kib-fg/80">OPPORTUNITY_ON_SALE_DROP_PCT</code>,{' '}
          <code className="rounded bg-black/25 px-1 font-mono text-[11px] text-kib-fg/80">OPPORTUNITY_DEDUPE_TTL_SEC</code>,{' '}
          <code className="rounded bg-black/25 px-1 font-mono text-[11px] text-kib-fg/80">OPPORTUNITY_CAPITULATION_*</code>. See <code className="rounded bg-black/25 px-1 font-mono text-[11px] text-kib-fg/80">.env.example</code>{' '}
          in the backend repo.
        </p>
      </div>

      <AlertDeliveryPreferences />
    </aside>
  );
};
