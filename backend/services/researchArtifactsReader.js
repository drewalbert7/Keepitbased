const db = require('../models/database');
const { watchlistService } = require('./watchlistService');

/**
 * @param {import('pg').QueryResultRow} row
 */
function mapArtifactRow(row) {
  return {
    id: String(row.id),
    source: row.source,
    symbol: String(row.symbol || '').toUpperCase(),
    assetType: row.asset_type,
    title: row.title,
    contentSummary: row.content_summary,
    url: row.url,
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at
  };
}

/**
 * Return recent `research_artifacts` rows only for symbols the user is allowed to see
 * (Main watchlist / `getAllowedAlertKeys`). Prevents cross-tenant headline leakage.
 *
 * @param {number} userId
 * @param {{ symbols?: string[], hours?: number, limit?: number }} opts
 */
async function getResearchArtifactsForUser(userId, opts = {}) {
  const hoursRaw = opts.hours;
  const hours = Math.min(
    168,
    Math.max(1, Number.isFinite(Number(hoursRaw)) ? Number(hoursRaw) : 24)
  );
  const limitRaw = opts.limit;
  const limit = Math.min(200, Math.max(1, Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : 50));

  const allowed = await watchlistService.getAllowedAlertKeys(userId);
  let symList = (opts.symbols || [])
    .map((s) => String(s).toUpperCase().trim())
    .filter(Boolean);

  if (symList.length === 0) {
    const main = await watchlistService.getMainWatchlist(userId);
    symList = (main.symbols || []).map((s) => String(s).toUpperCase().trim()).filter(Boolean);
  }

  const filtered = [];
  for (const s of symList) {
    if (allowed.has(`stock:${s}`) || allowed.has(`crypto:${s}`)) {
      if (!filtered.includes(s)) filtered.push(s);
    }
  }

  if (filtered.length === 0) {
    return {
      artifacts: [],
      lookbackHours: hours,
      limit,
      symbolsRequested: symList,
      symbolsAllowed: []
    };
  }

  const result = await db.query(
    `SELECT id, source, symbol, asset_type, title, content_summary, url, published_at, fetched_at
     FROM research_artifacts
     WHERE UPPER(TRIM(symbol)) = ANY($1::text[])
       AND COALESCE(published_at, fetched_at) >= NOW() - ($2::numeric * INTERVAL '1 hour')
     ORDER BY COALESCE(published_at, fetched_at) DESC
     LIMIT $3`,
    [filtered, hours, limit]
  );

  return {
    artifacts: result.rows.map(mapArtifactRow),
    lookbackHours: hours,
    limit,
    symbolsRequested: symList,
    symbolsAllowed: filtered
  };
}

module.exports = {
  getResearchArtifactsForUser,
  mapArtifactRow
};
