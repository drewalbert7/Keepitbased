"use client";

import { useEffect } from "react";
import { getQuantAgiBaseUrl } from "../lib/quantBase";
import { quantAuthedFetch } from "../lib/quantAuth";
import { LatestPatch, QuantEvent, useQuantStore } from "../lib/store";

export function StreamBootstrap() {
  const replaceEvents = useQuantStore((s) => s.replaceEvents);
  const setLatestPatch = useQuantStore((s) => s.setLatestPatch);
  const setConnected = useQuantStore((s) => s.setConnected);

  useEffect(() => {
    const pullFeed = async () => {
      const base = getQuantAgiBaseUrl();
      try {
        const res = await quantAuthedFetch(`${base}/diag/terminal-feed?limit=20`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        const events = Array.isArray(payload.events)
          ? (payload.events as Array<Partial<QuantEvent>>).map((e, idx) => ({
              id: String(e.id || `live-${idx}`),
              ts: typeof e.ts === "string" ? e.ts : new Date().toISOString(),
              type: (e.type as QuantEvent["type"]) || "experiment_run",
              title: String(e.title || "Autoresearch event"),
              detail: String(e.detail || ""),
              commitSha: e.commitSha,
              state: e.state,
              sharpeDelta: typeof e.sharpeDelta === "number" ? e.sharpeDelta : undefined,
              drawdownDelta: typeof e.drawdownDelta === "number" ? e.drawdownDelta : undefined
            }))
          : [];
        replaceEvents(events);
        setLatestPatch((payload.latestPatch ?? null) as LatestPatch | null);
        setConnected(true);
      } catch {
        setConnected(false);
        replaceEvents([]);
        setLatestPatch(null);
      }
    };

    void pullFeed();
    const id = setInterval(() => void pullFeed(), 8000);
    return () => {
      clearInterval(id);
      setConnected(false);
    };
  }, [replaceEvents, setConnected, setLatestPatch]);

  return null;
}
