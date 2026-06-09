"use client";

import { useState } from "react";
import type { PaperBotTrade } from "../../lib/paperBotApi";
import { moneyPrecise } from "./format";

export function BotTradeBlotter({ trades }: { trades: PaperBotTrade[] }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div className="rounded-xl border border-white/10 bg-panelAlt/60 p-3">
      <h3 className="text-sm font-semibold text-white/80">Recent trades</h3>
      {trades.length ? (
        <ul className="mt-2 space-y-2">
          {trades.map((t) => {
            const open = expandedId === t.id;
            const hasExplain =
              (t.reasonJson && Object.keys(t.reasonJson).length > 0) || (t.reasonTags?.length ?? 0) > 0;
            return (
              <li key={t.id} className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="font-medium text-white">
                    {t.side.toUpperCase()} {t.symbol}
                  </span>
                  <span className="tabular-nums text-white/50">{moneyPrecise(t.notionalUsd)}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-white/45">
                  {t.quantity.toFixed(4)} @ {moneyPrecise(t.priceUsd)} · {new Date(t.createdAt).toLocaleString()}
                  {t.reasonTags?.length ? ` · ${t.reasonTags.join(", ")}` : ""}
                </p>
                {hasExplain ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setExpandedId(open ? null : t.id)}
                      className="mt-1 text-[11px] text-neon hover:underline"
                    >
                      {open ? "Hide explanation" : "Explain this trade"}
                    </button>
                    {open ? (
                      <pre className="mt-2 max-h-40 overflow-auto rounded border border-white/10 bg-black/40 p-2 text-[10px] text-white/70">
                        {JSON.stringify(
                          t.reasonJson && Object.keys(t.reasonJson).length
                            ? t.reasonJson
                            : { reason_tags: t.reasonTags, policy_version: t.policyVersion },
                          null,
                          2
                        )}
                      </pre>
                    ) : null}
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-white/50">Trade blotter empty — fills appear after run-day.</p>
      )}
    </div>
  );
}
