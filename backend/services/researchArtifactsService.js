const crypto = require('crypto');
const db = require('../models/database');

/**
 * Stable idempotency key per article × symbol (same headline URL may tag multiple tickers).
 *
 * @param {string} source
 * @param {string} symbol
 * @param {string} url
 * @param {string | null} publishedAtIso
 */
function computeContentHash(source, symbol, url, publishedAtIso) {
  const h = crypto.createHash('sha256');
  h.update(String(source));
  h.update('|');
  h.update(String(symbol || '').toUpperCase());
  h.update('|');
  h.update(String(url || ''));
  h.update('|');
  h.update(String(publishedAtIso || ''));
  return h.digest('hex');
}

/**
 * Insert one Polygon news row; skips duplicates via content_hash.
 *
 * @returns {Promise<boolean>} true if a new row was inserted
 */
async function insertPolygonNewsArtifact({
  symbol,
  assetType = 'stock',
  url,
  title,
  contentSummary,
  publishedAt,
  rawPayload,
  cik = null
}) {
  const contentHash = computeContentHash('polygon_news', symbol, url, publishedAt);
  const result = await db.query(
    `INSERT INTO research_artifacts (
      source, symbol, asset_type, cik, url, content_hash,
      title, content_summary, published_at, raw_payload
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
    ON CONFLICT (content_hash) DO NOTHING
    RETURNING id`,
    [
      'polygon_news',
      String(symbol).toUpperCase(),
      assetType === 'crypto' ? 'crypto' : 'stock',
      cik,
      url,
      contentHash,
      title || null,
      contentSummary || null,
      publishedAt || null,
      JSON.stringify(rawPayload && typeof rawPayload === 'object' ? rawPayload : {})
    ]
  );
  return result.rowCount > 0;
}

/**
 * Count artifacts for correlation gates (e.g. last N hours).
 *
 * @param {string} symbol - bare ticker
 * @param {number} windowHours
 */
async function countArtifactsForSymbol(symbol, windowHours = 24) {
  const sym = String(symbol || '').toUpperCase();
  if (!sym) return 0;
  const hours = Math.min(Math.max(Number(windowHours) || 24, 1), 168);
  const result = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM research_artifacts
     WHERE symbol = $1
       AND COALESCE(published_at, fetched_at)
           >= NOW() - ($2::numeric * INTERVAL '1 hour')`,
    [sym, hours]
  );
  return result.rows[0]?.n ?? 0;
}

module.exports = {
  computeContentHash,
  insertPolygonNewsArtifact,
  countArtifactsForSymbol
};
