"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchPaperBotImprovementEvents, type PaperBotEvent } from "../../lib/paperBotApi";
import {
  formatImprovementEvent,
  improvementToneClass,
  type FormattedImprovementEvent
} from "./formatImprovementEvent";

type Props = {
  refreshKey?: number;
};

export function BotImprovementLog({ refreshKey = 0 }: Props) {
  const [events, setEvents] = useState<FormattedImprovementEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const raw = await fetchPaperBotImprovementEvents(25);
      setEvents(raw.map(formatImprovementEvent));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load improvement log");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <div className="mb-4 rounded-xl border border-white/10 bg-panelAlt/50 p-3">
      <div>
        <h3 className="text-sm font-semibold text-white/85">Bot improvement log</h3>
        <p className="mt-0.5 text-[11px] text-white/45">
          Fills, rules, kill switch, simulate-day, and autoresearch promotions — your paper bot
          story, not the autoresearch lab timeline in Zone C.
        </p>
      </div>

      {error ? <p className="mt-2 text-xs text-warn">{error}</p> : null}

      {loading && !events.length ? (
        <p className="mt-3 text-xs text-white/45">Loading improvement log…</p>
      ) : events.length ? (
        <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto">
          {events.map((ev) => {
            const open = expandedId === ev.id;
            const hasPayload = ev.payload && Object.keys(ev.payload).length > 0;
            return (
              <li key={ev.id} className="rounded-lg border border-white/10 bg-black/25 px-2.5 py-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${improvementToneClass(ev.tone)}`}
                      >
                        {ev.eventType.replace(/_/g, " ")}
                      </span>
                      <p className="text-xs font-medium text-white">{ev.title}</p>
                    </div>
                    {ev.detail ? <p className="mt-1 text-[11px] text-white/50">{ev.detail}</p> : null}
                    <p className="mt-1 text-[10px] text-white/35">{new Date(ev.createdAt).toLocaleString()}</p>
                  </div>
                  {hasPayload ? (
                    <button
                      type="button"
                      onClick={() => setExpandedId(open ? null : ev.id)}
                      className="shrink-0 text-[10px] text-neon hover:underline"
                    >
                      {open ? "Hide" : "Details"}
                    </button>
                  ) : null}
                </div>
                {open && hasPayload ? (
                  <pre className="mt-2 max-h-32 overflow-auto rounded border border-white/10 bg-black/40 p-2 text-[10px] text-white/65">
                    {JSON.stringify(ev.payload, null, 2)}
                  </pre>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-white/45">
          No bot activity yet — simulate a day or approve a Grok rule.
        </p>
      )}
    </div>
  );
}
