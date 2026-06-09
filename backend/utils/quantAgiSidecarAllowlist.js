/**
 * Allowlisted Quant AGI sidecar paths for authenticated browser proxy.
 * Server-side callers (digest worker, priceMonitor) use 127.0.0.1:8844 directly.
 */
const SIDECAR_GET_PREFIXES = [
  'health',
  'diag/terminal-feed',
  'diag/market-snapshot',
  'diag/market-universe-rank',
  'diag/scorecard'
];

const SIDECAR_POST_PREFIXES = ['v1/coding-chat'];

function normalizeSubPath(raw) {
  const trimmed = String(raw || '')
    .replace(/^\/+/, '')
    .split('?')[0]
    .trim();
  if (!trimmed || trimmed.includes('..')) return null;
  return trimmed;
}

function matchesPrefix(path, prefixes) {
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
}

function isAllowedSidecarRequest(method, subPath) {
  const path = normalizeSubPath(subPath);
  if (!path) return false;
  const m = String(method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD') {
    return matchesPrefix(path, SIDECAR_GET_PREFIXES);
  }
  if (m === 'POST') {
    return matchesPrefix(path, SIDECAR_POST_PREFIXES);
  }
  return false;
}

module.exports = {
  SIDECAR_GET_PREFIXES,
  SIDECAR_POST_PREFIXES,
  normalizeSubPath,
  isAllowedSidecarRequest
};
