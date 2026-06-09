"use client";

import { useQuantStore } from "../lib/store";

export function TerminalHeader({ embed = false }: { embed?: boolean }) {
  const connected = useQuantStore((s) => s.connected);

  return (
    <header className="rounded-2xl border border-white/10 bg-panel/70 px-4 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-white/60">Quant AGI Terminal</p>
          <h1 className="text-xl font-semibold text-white">Quant AGI Bot &amp; autoresearch ops</h1>
          {!embed ? (
            <p className="mt-1 text-xs text-white/50">
              <a href="#quant-agi-bot" className="text-neon underline-offset-2 hover:underline">
                Quant AGI Bot
              </a>
              {" · "}
              <a href="#autoresearch-ops" className="text-neon underline-offset-2 hover:underline">
                Autoresearch ops
              </a>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`rounded-full px-3 py-1 ${connected ? "bg-mint/20 text-mint" : "bg-danger/20 text-danger"}`}
          >
            {connected ? "Autoresearch feed live" : "Autoresearch feed offline"}
          </span>
          <a
            href="/dashboard"
            target={embed ? "_top" : undefined}
            rel={embed ? "noopener noreferrer" : undefined}
            className="rounded-full border border-white/15 px-3 py-1 text-white/70 hover:text-white"
          >
            Dashboard
          </a>
        </div>
      </div>
    </header>
  );
}
