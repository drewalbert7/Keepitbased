/**
 * North-star copy for Quant AGI deep ops cockpit.
 * Compact variant when embedded in the main app iframe.
 */
export function MissionBanner({ embed = false }: { embed?: boolean }) {
  if (embed) {
    return (
      <section
        aria-label="Quant AGI ops"
        className="rounded-xl border border-white/10 bg-panel/60 px-3 py-2.5 text-xs text-white/65"
      >
        <span className="font-medium text-white/85">Quant AGI Bot</span> — paper trading, multi-agent brain,
        and learning lab. Watchlist and deploy list stay on the{" "}
        <a href="/dashboard" target="_top" className="text-neon underline-offset-2 hover:underline">
          dashboard
        </a>
        .
      </section>
    );
  }

  return (
    <section
      aria-label="Quant AGI mission"
      className="rounded-2xl border border-neon/30 bg-gradient-to-b from-neon/10 to-panel/80 px-4 py-4 sm:px-6 sm:py-5 backdrop-blur"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-neon/90">Quant AGI</p>
      <h2 className="mt-1 text-base font-semibold leading-snug text-white sm:text-lg">
        <span className="text-mint">Quant AGI Bot</span> — multi-agent paper trading, brain monitor, and
        external learning from arXiv + X.
      </h2>
      <p className="mt-3 text-xs leading-relaxed text-white/55">
        Stock suggestions and deploy list live on{" "}
        <a href="/dashboard" className="text-neon underline-offset-2 hover:underline">
          /dashboard
        </a>
        . Educational simulation only — not investment advice.
      </p>
    </section>
  );
}
