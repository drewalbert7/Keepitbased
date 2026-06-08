const config = require('../config');

/**
 * Base URL for Quant AGI FastAPI sidecar (rank API, not /webhook/swarm-enhance).
 */
function resolveQuantAgiBaseUrl(raw) {
  const explicit = String(config.QUANT_AGI_RANK_URL || '').trim().replace(/\/$/, '');
  if (explicit) return explicit;

  const enhance = String(raw || config.QUANT_AGI_ENHANCE_URL || '').trim().replace(/\/$/, '');
  if (enhance) {
    if (enhance.endsWith('/webhook/swarm-enhance')) {
      return enhance.slice(0, -'/webhook/swarm-enhance'.length);
    }
    return enhance;
  }

  return 'http://127.0.0.1:8844';
}

module.exports = { resolveQuantAgiBaseUrl };
