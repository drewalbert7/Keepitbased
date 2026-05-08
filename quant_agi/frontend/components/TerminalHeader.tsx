"use client";

import { useQuantStore } from "../lib/store";

export function TerminalHeader() {
  const { connected, mode, setMode, killSwitch, toggleKillSwitch } = useQuantStore();

  return (
    <header className="rounded-2xl border border-white/10 bg-panel/70 px-4 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-white/60">Quant AGI Terminal</p>
          <h1 className="text-xl font-semibold text-white">Autoresearch and execution cockpit</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-full px-3 py-1 ${connected ? "bg-mint/20 text-mint" : "bg-danger/20 text-danger"}`}>
            {connected ? "Stream connected" : "Stream offline"}
          </span>
          <div className="rounded-full border border-white/20 px-1 py-1">
            {(["paper", "shadow", "live"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-full px-3 py-1 transition ${
                  mode === m ? "bg-neon text-white" : "text-white/70 hover:text-white"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <button
            onClick={toggleKillSwitch}
            className={`rounded-full px-3 py-1 font-semibold ${
              killSwitch ? "bg-mint/20 text-mint" : "bg-danger/20 text-danger"
            }`}
          >
            {killSwitch ? "Kill switch armed" : "Kill switch released"}
          </button>
        </div>
      </div>
    </header>
  );
}
