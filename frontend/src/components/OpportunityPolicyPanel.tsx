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
            Dip signals (toasts, optional email,{' '}
            <Link to="/opportunity-signals" className="text-kib-cyber underline-offset-2 hover:underline">
              inbox
            </Link>
            ) share the same rules for every symbol.
          </p>
        </>
      )}
      {embedInPanel && (
        <p className="mb-3 text-[11px] leading-relaxed text-kib-muted">
          Same dip rules for every symbol.{' '}
          <Link to="/opportunity-signals" className="text-kib-cyber underline-offset-2 hover:underline">
            View signal inbox
          </Link>
          .
        </p>
      )}

      {loading && <p className={`text-xs text-kib-muted ${embedInPanel ? 'mt-0' : 'mt-3'}`}>Loading policy…</p>}

      {!loading && !cfg && (
        <p className="text-xs text-amber-600/90 mt-3">Could not load server policy. Values below are defaults.</p>
      )}

      <div className={`${embedInPanel ? 'mt-0' : 'mt-3'} space-y-2 text-xs leading-relaxed text-kib-fg/90`}>
        <p>
          <span className="text-kib-muted">When it runs:</span> you have an <strong>active</strong> watchlist row with a{' '}
          <strong>baseline</strong>; each quote is compared to that baseline.
        </p>

        {mode === 'atr' ? (
          <>
            <p>
              <span className="text-kib-muted">Short tiers (ATR):</span> below baseline, dip size is measured in{' '}
              <strong>14-day ATR</strong> (daily bars).
            </p>
            <ul className="list-disc space-y-1 pl-4 text-[11px] text-kib-muted">
              <li>
                <span className="font-medium text-kib-cyber">on_sale</span> — dip ≥{' '}
                <strong className="tabular-nums text-kib-fg">{onSaleAtr}×</strong> ATR
              </li>
              <li>
                <span className="font-medium text-kib-cyber">overreaction</span> — dip ≥{' '}
                <strong className="tabular-nums text-kib-fg">{overAtr}×</strong> ATR
              </li>
            </ul>
            <p className="mt-2 text-[11px] text-kib-muted">
              <span className="font-medium text-kib-fg/90">Major capitulation (long-term):</span> in-app as{' '}
              <strong className="text-kib-fg/90">Major Capitulation – Long-term Setup</strong>. Stricter mix of ATR vs
              14d/50d (<strong className="tabular-nums text-kib-fg">{capA14}×</strong> /{' '}
              <strong className="tabular-nums text-kib-fg">{capA50}×</strong>), drawdown vs ~52w high (≥{' '}
              <strong className="tabular-nums text-kib-fg">{cap52}%</strong>
              ), optional mega-cap distance (≥ <strong className="tabular-nums text-kib-fg">{capMegaAth}%</strong>
              {megaCount != null ? (
                <>
                  , <strong className="tabular-nums text-kib-fg">{megaCount}</strong> symbols
                </>
              ) : null}
              ), and a softer <strong className="tabular-nums text-kib-fg">{capFb52}%</strong> vs ~52w when huge ATR legs
              have not fired yet.
            </p>
            {showMarketDataWarning && (
              <p className="text-[11px] text-amber-200/90 border border-amber-500/25 rounded-md px-2 py-1.5 bg-amber-950/40">
                Market data key missing — ATR may be unavailable; the service falls back to % rules below.
              </p>
            )}
          </>
        ) : (
          <p>
            <span className="text-kib-muted">Percentage mode:</span> fixed drops vs baseline —{' '}
            <strong className="text-kib-fg">−{onSalePct}%</strong> → <span className="font-medium text-kib-cyber">on_sale</span>,{' '}
            <strong className="text-kib-fg">−{overPct}%</strong> → <span className="font-medium text-kib-cyber">overreaction</span>.
          </p>
        )}

        {mode === 'atr' && (
          <p>
            <span className="text-kib-muted">If ATR is missing:</span> falls back to{' '}
            <strong className="text-kib-fg">−{onSalePct}%</strong> / <strong className="text-kib-fg">−{overPct}%</strong> vs baseline.
          </p>
        )}

        <p className="text-[11px] text-kib-muted">
          Vol-spike boost (&gt;{volMult}× typical intraday move) applies only when that data exists; otherwise ATR or % rules
          drive the loop.
        </p>

        <p className="text-[11px] text-kib-muted">
          <span className="font-medium text-kib-fg/90">Trend filter (short tiers):</span>{' '}
          {trendOn ? (
            <>
              On — <span className="font-mono text-kib-fg/90">on_sale</span> /{' '}
              <span className="font-mono text-kib-fg/90">overreaction</span> only if price is above the{' '}
              <strong className="tabular-nums text-kib-fg">{trendDays}</strong>-day SMA (skipped if SMA missing). Capitulation
              ignores this.
            </>
          ) : (
            <>Off — enable on the API host with <span className="font-mono">OPPORTUNITY_SHORT_TREND_FILTER_ENABLED</span>.</>
          )}
        </p>

        {atrFloorPct > 0 ? (
          <p className="text-[11px] text-kib-muted">
            <span className="font-medium text-kib-fg/90">ATR floor:</span> ignore ATR for rules when it is under{' '}
            <strong className="tabular-nums text-kib-fg">{atrFloorPct}%</strong> of price.
          </p>
        ) : (
          <p className="text-[11px] text-kib-muted">
            <span className="font-medium text-kib-fg/90">ATR floor:</span> off.
          </p>
        )}

        <p>
          <span className="text-kib-muted">Cooldowns:</span> at most one short-tier signal per symbol per{' '}
          <strong className="text-kib-fg">{dedupe}</strong> (per user). Capitulation uses{' '}
          <strong className="text-kib-fg">{capDedupe}</strong> so long setups do not spam.
        </p>

        <p className="text-[10px] leading-relaxed text-kib-muted/90">
          Deployers: change defaults in backend environment variables — see <code className="rounded bg-black/25 px-1 font-mono text-[10px]">.env.example</code>.
        </p>
      </div>

      <AlertDeliveryPreferences />
    </aside>
  );
};
