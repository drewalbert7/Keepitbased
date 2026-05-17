const db = require('../models/database');
const { parseWatchlistToken } = require('./stockMarketIdentity');

/**
 * Parse JSONB `symbols` arrays from watchlists: `STOCK:AAPL`, `CRYPTO:BTC`, …
 *
 * @param {unknown} raw
 * @returns {string[]}
 */
function parseSymbolsArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw || '[]');
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Union of **all** watchlist tickers across every user and every list name
 * (not only `Main`). Same token shape as the dashboard / PriceMonitor / agent context.
 *
 * @returns {Promise<{ stocks: Set<string>, cryptos: Set<string> }>}
 */
async function loadSymbolsFromAllWatchlistRows() {
  const result = await db.query(`SELECT symbols FROM user_watchlists`);
  const stocks = new Set();
  const cryptos = new Set();

  for (const row of result.rows) {
    for (const t of parseSymbolsArray(row.symbols)) {
      if (typeof t !== 'string') continue;
      const parsed = parseWatchlistToken(t);
      if (!parsed) continue;
      const sym = String(parsed.alertSymbol || parsed.symbol || '').toUpperCase();
      if (!sym) continue;
      if (parsed.assetType === 'stock') stocks.add(sym);
      if (parsed.assetType === 'crypto') cryptos.add(sym);
    }
  }

  return { stocks, cryptos };
}

/**
 * If no tokens appear on any watchlist, fall back to legacy active stock alerts (same idea as PriceMonitor).
 *
 * @param {Set<string>} stocks
 */
async function mergeLegacyStockAlerts(stocks, cryptos) {
  if (stocks.size > 0 || cryptos.size > 0) return;
  const legacy = await db.query(`
    SELECT DISTINCT UPPER(TRIM(symbol)) AS symbol
    FROM user_alerts
    WHERE active = true AND asset_type = 'stock'
  `);
  for (const r of legacy.rows) {
    stocks.add(String(r.symbol).toUpperCase());
  }
}

/**
 * Ordered flat list for ingestion / jobs: stocks first, then crypto (deduped per asset class).
 *
 * @returns {Promise<Array<{ symbol: string, assetType: 'stock' | 'crypto' }>>}
 */
async function getWatchlistTickerJobs() {
  const { stocks, cryptos } = await loadSymbolsFromAllWatchlistRows();
  await mergeLegacyStockAlerts(stocks, cryptos);

  const out = [];
  for (const s of stocks) {
    out.push({ symbol: s, assetType: 'stock' });
  }
  for (const s of cryptos) {
    out.push({ symbol: s, assetType: 'crypto' });
  }
  return out;
}

module.exports = {
  getWatchlistTickerJobs,
  loadSymbolsFromAllWatchlistRows,
  parseSymbolsArray
};
