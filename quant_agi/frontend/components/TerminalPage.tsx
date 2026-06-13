"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { MissionBanner } from "./MissionBanner";
import { PaperTradingBotPanel } from "./PaperTradingBotPanel";
import { EmbedAuthBridge } from "./EmbedAuthBridge";
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
