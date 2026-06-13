"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchPaperBotShadowOrders,
  runPaperBotShadowPreview,
  type PaperBotShadowOrder,
  type PaperBotShadowPreviewResult
} from "../../lib/paperBotApi";
import { moneyPrecise } from "./format";

type Props = {
  refreshKey?: number;
  killSwitchArmed?: boolean;
  busy?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onStatus?: (msg: string | null) => void;
  onComplete?: () => void;
};

export function BotShadowBlotter({
  refreshKey = 0,
  killSwitchArmed = false,
  busy = false,
  onBusyChange,
  onStatus,
  onComplete
}: Props) {
  const [orders, setOrders] = useState<PaperBotShadowOrder[]>([]);
  const [lastRun, setLastRun] = useState<PaperBotShadowPreviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchPaperBotShadowOrders(15);
      setOrders(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load shadow orders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders, refreshKey]);

  async function handleShadowPreview() {
    onBusyChange?.(true);
    onStatus?.(null);
    setError(null);
    try {
      const result = await runPaperBotShadowPreview();
      setLastRun(result);
      await loadOrders();
      if (result.skipped) {
        onStatus?.(result.reason || "Shadow preview — no broker orders");
      } else {
        onStatus?.(`Shadow preview — ${result.orderCount} hypothetical order(s), not sent`);
      }
      onComplete?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Shadow preview failed");
    } finally {
      onBusyChange?.(false);
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-amber-100">Shadow broker preview</h3>
          <p className="mt-0.5 text-[11px] text-white/50">
            Hypothetical orders only — policy run as-if disarmed; nothing hits the paper ledger or a broker.
          </p>
          {killSwitchArmed ? (
            <p className="mt-1 text-[11px] text-amber-200/80">
              Kill switch is armed; shadow still previews what policy would do if disarmed.
            </p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleShadowPreview()}
          className="rounded-lg border border-amber-400/35 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-50 hover:bg-amber-500/25 disabled:opacity-50"
        >
          {busy ? "Running…" : "Shadow preview"}
        </button>
      </div>

      {lastRun ? (
        <p className="mt-2 text-[11px] text-white/55">
          Last run: {lastRun.orderCount} order(s)
          {lastRun.skipped ? ` · skipped (${lastRun.reason || "no orders"})` : ""}
          {lastRun.killSwitchArmedAtRun ? " · kill switch was armed" : ""}
        </p>
      ) : null}

      {error ? <p className="mt-2 text-xs text-warn">{error}</p> : null}

      {loading && !orders.length ? (
        <p className="mt-2 text-xs text-white/45">Loading shadow orders…</p>
      ) : orders.length ? (
        <ul className="mt-3 space-y-2">
          {orders.map((o) => (
            <li key={o.id} className="rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="font-medium text-amber-100">
                  {o.side.toUpperCase()} {o.symbol}
                </span>
                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-100">not sent</span>
              </div>
              <p className="mt-0.5 text-[11px] text-white/45">
                {o.quantity > 0 ? `${o.quantity.toFixed(4)} @ ${moneyPrecise(o.priceUsd)} · ` : ""}
                {moneyPrecise(o.notionalUsd)} · {new Date(o.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-white/45">No shadow orders yet — run Shadow preview.</p>
      )}
    </div>
  );
}
