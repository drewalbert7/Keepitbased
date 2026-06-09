"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuantStore } from "../lib/store";
import {
  AutoresearchPromoteButton,
  loadAutoresearchForPromote
} from "./bot/AutoresearchPromoteButton";
import type { PaperBotAutoresearchLatest } from "../lib/paperBotApi";

export function CodeDiffPanel() {
  const events = useQuantStore((s) => s.events);
  const latestPatch = useQuantStore((s) => s.latestPatch);
  const connected = useQuantStore((s) => s.connected);
  const [promoteData, setPromoteData] = useState<PaperBotAutoresearchLatest | null>(null);

  const latestCodeEvent = useMemo(
    () => events.find((e) => e.type === "code_update_proposed" || e.type === "promotion"),
    [events]
  );

  const hasPatch = Boolean(latestPatch?.patch);

  useEffect(() => {
    void loadAutoresearchForPromote().then(setPromoteData);
  }, [latestPatch?.commitSha]);

  return (
    <section id="autoresearch-diff" className="scroll-mt-4 rounded-2xl border border-white/10 bg-panel/70 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/70">Daily code update</h2>
      <div className="rounded-xl border border-white/10 bg-black/40 p-3">
        <p className="mb-2 text-xs text-white/50">
          {latestCodeEvent?.title || "Latest patch preview"}{" "}
          {latestPatch?.commitSha || latestCodeEvent?.commitSha
            ? `| ${latestPatch?.commitSha || latestCodeEvent?.commitSha}`
            : ""}
        </p>
        {hasPatch ? (
          <pre className="max-h-[360px] overflow-auto text-xs text-white/80">{latestPatch?.patch}</pre>
        ) : (
          <p className="text-sm text-white/55">
            {connected
              ? "No sandbox patch yet — run autoresearch nightly or wait for the next experiment."
              : "Autoresearch feed offline — reconnect to load the latest patch from sandbox git."}
          </p>
        )}
      </div>
      {hasPatch ? (
        <>
          <p className="mt-3 text-xs text-white/60">
            {latestPatch?.truncated
              ? "Patch truncated to keep UI responsive; open sandbox git for full diff."
              : "Sandbox git diff — not merged to production until you approve below."}
          </p>
          <AutoresearchPromoteButton
            data={promoteData}
            compact
            onPromoted={() => void loadAutoresearchForPromote().then(setPromoteData)}
          />
        </>
      ) : null}
    </section>
  );
}
