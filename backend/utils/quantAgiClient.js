const axios = require('axios');
const config = require('../config');
const logger = require('./logger');

/**
 * Build POST URL for swarm enrichment. Accepts base (http://host:8844) or full webhook path.
 * @param {string} raw
 */
function resolveQuantAgiEnhanceUrl(raw) {
  const b = String(raw).trim().replace(/\/$/, '');
  if (!b) return '';
  if (b.endsWith('/webhook/swarm-enhance')) return b;
  return `${b}/webhook/swarm-enhance`;
}

/**
 * @param {{ symbol: string, baselinePrice: number, alertId?: string, message?: string, assetType?: 'stock'|'crypto' }} input
 * @returns {Promise<object|null>}
 */
async function fetchQuantAgiEnrichment(input) {
  const base = config.QUANT_AGI_ENHANCE_URL;
  if (!base) return null;
  const url = resolveQuantAgiEnhanceUrl(base);
  if (!url) return null;
  const sym = String(input.symbol || '').trim().toUpperCase();
  if (!sym || !Number.isFinite(Number(input.baselinePrice))) return null;

  try {
    const { data } = await axios.post(
      url,
      {
        symbol: sym,
        baseline_price: Number(input.baselinePrice),
        ...(input.alertId != null ? { alertId: String(input.alertId) } : {}),
        ...(input.message ? { message: String(input.message) } : {}),
        ...(input.assetType ? { assetType: input.assetType } : {})
      },
      {
        timeout: config.QUANT_AGI_TIMEOUT_MS,
        validateStatus: (s) => s >= 200 && s < 300,
        headers: { 'Content-Type': 'application/json' }
      }
    );
    return data && typeof data === 'object' ? data : null;
  } catch (err) {
    logger.warn(
      `Quant AGI enrichment skipped for ${sym}: ${err.code || err.name || 'error'} ${err.message || ''}`.trim()
    );
    return null;
  }
}

module.exports = {
  fetchQuantAgiEnrichment,
  resolveQuantAgiEnhanceUrl
};
