"use client";

import { QuantEvent, useQuantStore } from "../lib/store";

function stateBadge(state?: QuantEvent["state"]) {
  if (!state) return "bg-white/10 text-white/70";
  if (state === "approved" || state === "deployed") return "bg-mint/20 text-mint";
  if (state === "rejected") return "bg-danger/20 text-danger";
  if (state === "tested") return "bg-cyan-400/20 text-cyan-300";
  return "bg-warn/20 text-warn";
}

export function EventTimeline() {
  const events = useQuantStore((s) => s.events);

  return (
    <section className="rounded-2xl border border-white/10 bg-panel/70 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/70">Live event timeline</h2>
      <div className="space-y-3">
        {events.length === 0 ? (
          <p className="text-sm text-white/60">No events yet.</p>
        ) : (
          events.map((event) => (
            <article key={event.id} className="rounded-xl border border-white/10 bg-panelAlt/80 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-white">{event.title}</p>
                <span className={`rounded-full px-2 py-1 text-xs ${stateBadge(event.state)}`}>{event.state || event.type}</span>
              </div>
              <p className="text-xs text-white/70">{event.detail}</p>
              <p className="mt-2 text-[11px] text-white/50">
                {new Date(event.ts).toLocaleString()} {event.commitSha ? `| ${event.commitSha}` : ""}
              </p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
