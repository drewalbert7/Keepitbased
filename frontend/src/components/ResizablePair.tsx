import React, { useCallback, useEffect, useRef, useState } from 'react';

const HANDLE_PX = 6;

const MEDIA: Record<'md' | 'lg', string> = {
  md: '(min-width: 768px)',
  lg: '(min-width: 1024px)'
};

function readStoredPct(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw != null) {
      const n = parseFloat(raw);
      if (Number.isFinite(n)) return n;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

function persistPct(key: string, pct: number) {
  try {
    localStorage.setItem(key, String(Math.round(pct * 100) / 100));
  } catch {
    /* ignore */
  }
}

type ResizablePairProps = {
  storageKey: string;
  defaultPct: number;
  minLeftPx: number;
  minRightPx: number;
  breakpoint?: 'md' | 'lg';
  left: React.ReactNode;
  right: React.ReactNode;
  className?: string;
};

/**
 * Side-by-side panels with a draggable vertical separator. Stacks below the breakpoint width.
 */
export function ResizablePair({
  storageKey,
  defaultPct,
  minLeftPx,
  minRightPx,
  breakpoint = 'lg',
  left,
  right,
  className = ''
}: ResizablePairProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const latestPctRef = useRef(defaultPct);
  const [splitWide, setSplitWide] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(MEDIA[breakpoint]).matches;
  });
  const [leftPct, setLeftPct] = useState(() => readStoredPct(storageKey, defaultPct));

  const stackGap = 'gap-6';

  useEffect(() => {
    latestPctRef.current = leftPct;
  }, [leftPct]);

  useEffect(() => {
    const mq = window.matchMedia(MEDIA[breakpoint]);
    const sync = () => setSplitWide(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [breakpoint]);

  const clampPct = useCallback(
    (raw: number, containerWidth: number) => {
      const w = containerWidth;
      if (w <= HANDLE_PX + minLeftPx + minRightPx) return raw;
      const minPct = (minLeftPx / w) * 100;
      const maxPct = ((w - HANDLE_PX - minRightPx) / w) * 100;
      return Math.min(maxPct, Math.max(minPct, raw));
    },
    [minLeftPx, minRightPx]
  );

  useEffect(() => {
    if (!splitWide || !containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      const w = el.getBoundingClientRect().width;
      if (w < 32) return;
      setLeftPct((prev) => {
        const next = clampPct(prev, w);
        latestPctRef.current = next;
        return next;
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [splitWide, clampPct]);

  const startDrag = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!splitWide || !containerRef.current) return;
      e.preventDefault();
      const container = containerRef.current;

      const onMove = (ev: PointerEvent) => {
        const rect = container.getBoundingClientRect();
        const w = rect.width;
        if (w < 32) return;
        const x = ev.clientX - rect.left;
        const rawPct = (x / w) * 100;
        const next = clampPct(rawPct, w);
        latestPctRef.current = next;
        setLeftPct(next);
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        document.body.style.removeProperty('cursor');
        document.body.style.removeProperty('user-select');
        persistPct(storageKey, latestPctRef.current);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      onMove(e.nativeEvent);
    },
    [splitWide, clampPct, storageKey]
  );

  const gridStyle: React.CSSProperties | undefined =
    splitWide
      ? {
          gridTemplateColumns: `${leftPct}% ${HANDLE_PX}px minmax(0, 1fr)`
        }
      : undefined;

  return (
    <div
      ref={containerRef}
      className={`w-full ${splitWide ? 'grid items-stretch gap-0' : `flex flex-col ${stackGap}`} ${className}`}
      style={gridStyle}
    >
      <div className="min-w-0">{left}</div>

      {splitWide && (
        <button
          type="button"
          aria-label="Drag to resize panels"
          aria-orientation="vertical"
          role="separator"
          aria-valuenow={Math.round(leftPct)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="flex cursor-col-resize flex-col items-center justify-center border-0 bg-transparent p-0 outline-none"
          style={{ touchAction: 'none' }}
          onPointerDown={startDrag}
        >
          <span className="h-full min-h-[120px] w-px max-h-[min(92vh,900px)] rounded-full bg-white/[0.12] hover:bg-kib-cyber/50" />
        </button>
      )}

      <div className="min-w-0">{right}</div>
    </div>
  );
}
