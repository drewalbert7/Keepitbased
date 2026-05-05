/**
 * Deterministic 0–100 "confluence" hint for Grok dip briefings.
 * Heuristic only — not a tradable signal; opportunity flags already passed the engine gate.
 *
 * @param {{ flags?: string[], vsBaselinePct?: number|null }} evalResult
 * @param {{ atr14?: number|null }} [tech]
 * @param {number} [price]
 */
function computeDipConfluenceScore(evalResult, tech, price) {
  let s = 45;
  const flags = Array.isArray(evalResult?.flags) ? evalResult.flags : [];
  if (flags.includes('capitulation')) s += 28;
  else if (flags.includes('overreaction')) s += 22;
  else if (flags.includes('on_sale')) s += 15;

  const vb = Number(evalResult?.vsBaselinePct);
  if (Number.isFinite(vb)) {
    if (vb <= -30) s += 15;
    else if (vb <= -20) s += 10;
    else if (vb <= -12) s += 5;
  }

  const p = Number(price);
  const a14 = tech?.atr14 != null ? Number(tech.atr14) : null;
  if (a14 != null && Number.isFinite(a14) && p > 0) {
    const atrPct = (a14 / p) * 100;
    if (atrPct >= 4) s += 5;
  }

  return Math.min(100, Math.max(0, Math.round(s)));
}

module.exports = { computeDipConfluenceScore };
