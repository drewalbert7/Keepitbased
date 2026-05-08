/**
 * North-star copy for Quant AGI: visible at top of terminal so operators and builders
 * align on direction (autoresearch → daily code evolution → MiroFish-style agents →
 * eventual policy-gated autonomous execution).
 */
export function MissionBanner() {
  return (
    <section
      aria-label="Quant AGI mission"
      className="rounded-2xl border border-neon/30 bg-gradient-to-b from-neon/10 to-panel/80 px-4 py-4 sm:px-6 sm:py-5 backdrop-blur"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-neon/90">Goal</p>
      <h2 className="mt-1 text-base font-semibold leading-snug text-white sm:text-lg">
        Build an agent that <span className="text-mint">continuously improves</span> through{" "}
        <span className="text-white/95">Karpathy-style autoresearch</span> and{" "}
        <span className="text-white/95">automated daily code updates</span>, using{" "}
        <span className="text-white/95">MiroFish-type swarm agents</span> to surface and refine the
        strongest trade ideas—evolving toward a <span className="text-mint">policy-gated bot</span>{" "}
        that can execute the best trades on its own when you enable it.
      </h2>
      <p className="mt-3 text-xs leading-relaxed text-white/55">
        Research &amp; simulation stack. Not investment advice. Paper and kill-switch first; live
        sleeves only behind explicit limits and audit trail.
      </p>
    </section>
  );
}
