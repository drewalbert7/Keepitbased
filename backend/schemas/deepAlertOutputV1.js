/**
 * DeepAlertOutput v1 — structured payload for research + dip fused alerts.
 * All numeric fields should carry provenance (see valueWithProvenance).
 *
 * @see docs/SECTION_11_PHASE_A.md
 */

const SCHEMA_VERSION = 1;

/**
 * @typedef {object} Provenance
 * @property {string} source - e.g. "tool:evaluateWatchlistOpportunity", "api:polygon:quote", "db:research_artifacts"
 * @property {string} [ref] - id / key for traceability
 * @property {string} [computedAt] - ISO timestamp
 */

/**
 * @typedef {object} ValueWithProvenance
 * @property {number} value
 * @property {Provenance} provenance
 */

/**
 * @param {unknown} o
 * @returns {o is { value: number, provenance: { source: string } }}
 */
function isValueWithProvenance(o) {
  if (o == null || typeof o !== 'object') return false;
  const v = o.value;
  const p = o.provenance;
  if (typeof v !== 'number' || Number.isNaN(v)) return false;
  if (p == null || typeof p !== 'object') return false;
  return typeof p.source === 'string' && p.source.length > 0;
}

/**
 * Basic structural validation for persisted runs and email attachment.
 * @param {unknown} payload
 * @returns {{ ok: true, data: object } | { ok: false, errors: string[] }}
 */
function validateDeepAlertOutputV1(payload) {
  const errors = [];
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: ['root must be an object'] };
  }
  const p = /** @type {Record<string, unknown>} */ (payload);
  if (p.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  }
  if (typeof p.symbol !== 'string' || !p.symbol.trim()) {
    errors.push('symbol must be a non-empty string');
  }
  if (!Array.isArray(p.triggers)) {
    errors.push('triggers must be an array');
  }
  if (p.dipContext != null && typeof p.dipContext !== 'object') {
    errors.push('dipContext must be object or omitted');
  }
  const dc = p.dipContext && typeof p.dipContext === 'object' ? p.dipContext : null;
  if (dc && 'vsBaselinePct' in dc && dc.vsBaselinePct != null && !isValueWithProvenance(dc.vsBaselinePct)) {
    errors.push('dipContext.vsBaselinePct must use { value, provenance } when present');
  }
  if (p.fusedSignals != null && typeof p.fusedSignals !== 'object') {
    errors.push('fusedSignals must be object or omitted');
  }
  if (p.sizingProposal != null && typeof p.sizingProposal !== 'object') {
    errors.push('sizingProposal must be object or omitted');
  }
  if (!Array.isArray(p.risks)) errors.push('risks must be an array');
  if (!Array.isArray(p.invalidation)) errors.push('invalidation must be an array');
  if (!Array.isArray(p.citations)) errors.push('citations must be an array');

  if (errors.length) return { ok: false, errors };

  return { ok: true, data: p };
}

/** Example skeleton for tests and compose phase (numbers are placeholders — never user-facing without tools). */
function exampleDeepAlertOutputV1() {
  return {
    schemaVersion: SCHEMA_VERSION,
    symbol: 'AAPL',
    triggers: [{ type: 'dip_vs_baseline', flags: ['on_sale'] }],
    fusedSignals: {
      x: { summary: 'stub', artifactIds: [] },
      news: { summary: 'stub', artifactIds: [] },
      filings: { summary: 'stub', artifactIds: [] },
      fundamentals: { summary: 'stub', artifactIds: [] }
    },
    dipContext: {
      vsBaselinePct: {
        value: -6.2,
        provenance: { source: 'tool:evaluateWatchlistOpportunity', ref: 'stub' }
      }
    },
    sizingProposal: {
      tranchesPct: [],
      maxPctCap: { value: 5, provenance: { source: 'policy:user_max_position', ref: 'prefs' } },
      rationale: 'Educational framing only; not investment advice.'
    },
    risks: [],
    invalidation: [],
    citations: []
  };
}

module.exports = {
  SCHEMA_VERSION_DEEP_ALERT: SCHEMA_VERSION,
  validateDeepAlertOutputV1,
  exampleDeepAlertOutputV1,
  isValueWithProvenance
};
