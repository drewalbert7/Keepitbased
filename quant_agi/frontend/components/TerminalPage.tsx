"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CodeDiffPanel } from "./CodeDiffPanel";
import { EventTimeline } from "./EventTimeline";
import { JarvisCodingChat } from "./JarvisCodingChat";
import { MissionBanner } from "./MissionBanner";
import { PaperTradingBotPanel } from "./PaperTradingBotPanel";
import { EmbedAuthBridge } from "./EmbedAuthBridge";
import { StreamBootstrap } from "./StreamBootstrap";
import { TerminalHeader } from "./TerminalHeader";

function TerminalPageInner() {
  const searchParams = useSearchParams();
  const embed = searchParams.get("embed") === "1";

  return (
    <main
      className={`min-h-screen bg-bg text-white ${embed ? "px-3 py-4 sm:px-4" : "px-4 py-6 sm:px-6 lg:px-8"}`}
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
        <EmbedAuthBridge embed={embed} />
        <MissionBanner embed={embed} />
        <TerminalHeader embed={embed} />
        <PaperTradingBotPanel embed={embed} />
        <StreamBootstrap />
        <section id="autoresearch-ops" className="scroll-mt-4 space-y-3">
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-cyan-300/80">Zone C</p>
            <h2 className="mt-1 text-base font-semibold text-white">Autoresearch &amp; engineering ops</h2>
            <p className="mt-1 text-xs text-white/50">
              Autoresearch lab history, nightly patch diff, and Grok coding advisor — separate from the paper bot
              improvement log in Zone B.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <EventTimeline />
            <div className="flex min-w-0 flex-col gap-4">
              <JarvisCodingChat />
              <CodeDiffPanel />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export function TerminalPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-bg px-4 py-6 text-white">
          <p className="text-sm text-white/60">Loading Quant AGI terminal…</p>
        </main>
      }
    >
      <TerminalPageInner />
    </Suspense>
  );
}
