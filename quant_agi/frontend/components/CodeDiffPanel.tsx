"use client";

import { useMemo } from "react";
import { useQuantStore } from "../lib/store";

const fallbackDiff = `diff --git a/swarm/evaluator.py b/swarm/evaluator.py
index 38ad18d..a5f239b 100644
--- a/swarm/evaluator.py
+++ b/swarm/evaluator.py
@@
- max_notional = 0.18
+ max_notional = 0.12
@@
- if regime_vol > 0.70: confidence *= 0.85
++ if regime_vol > 0.58: confidence *= 0.72`;

export function CodeDiffPanel() {
  const events = useQuantStore((s) => s.events);
  const latestPatch = useQuantStore((s) => s.latestPatch);
  const latestCodeEvent = useMemo(
    () => events.find((e) => e.type === "code_update_proposed" || e.type === "promotion"),
    [events]
  );

  return (
    <section className="rounded-2xl border border-white/10 bg-panel/70 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/70">Daily code update</h2>
      <div className="rounded-xl border border-white/10 bg-black/40 p-3">
        <p className="mb-2 text-xs text-white/50">
          {latestCodeEvent?.title || "Latest patch preview"}{" "}
          {latestPatch?.commitSha || latestCodeEvent?.commitSha ? `| ${latestPatch?.commitSha || latestCodeEvent?.commitSha}` : ""}
        </p>
        <pre className="max-h-[360px] overflow-auto text-xs text-white/80">{latestPatch?.patch || fallbackDiff}</pre>
      </div>
      <p className="mt-3 text-xs text-white/60">
        {latestPatch?.truncated
          ? "Patch truncated to keep UI responsive; open sandbox git for full diff."
          : "Streaming latest autoresearch patch from Quant AGI terminal feed."}
      </p>
    </section>
  );
}
