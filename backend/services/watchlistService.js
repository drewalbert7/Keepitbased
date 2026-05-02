const db = require('../models/database');
const logger = require('../utils/logger');
const { getRedisClient } = require('../utils/redis');
const { validateAlertSymbol } = require('../utils/alertSymbolValidate');
const PriceMonitor = require('./priceMonitor');
const config = require('../config');

const MAIN_NAME = 'Main';
const STOCK_PREFIX = 'STOCK';

function tokenForStock(symbol) {
  return `${STOCK_PREFIX}:${String(symbol).toUpperCase()}`;
}

function parseToken(token) {
  const s = String(token || '').trim();
  const i = s.indexOf(':');
  if (i < 1) return null;
  const type = s.slice(0, i).toUpperCase();
  const sym = s.slice(i + 1).trim().toUpperCase();
  if (type !== STOCK_PREFIX || !sym) return null;
  return { assetType: 'stock', symbol: sym };
}

/**
 * Keys aligned with user_alerts: `${asset_type}:${SYMBOL}` e.g. stock:AAPL
 */
function alertKey(assetType, symbol) {
  return `${String(assetType).toLowerCase()}:${String(symbol).toUpperCase()}`;
}

function parseSymbolsJson(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') return JSON.parse(raw || '[]');
  return [];
}

async function getMainRow(userId) {
  let r = await db.query(
    `SELECT * FROM user_watchlists WHERE user_id = $1 AND name = $2 LIMIT 1`,
    [userId, MAIN_NAME]
  );
  if (r.rows.length > 0) return r.rows[0];

  try {
    await db.query(
      `INSERT INTO user_watchlists (user_id, name, symbols) VALUES ($1, $2, '[]'::jsonb)`,
      [userId, MAIN_NAME]
    );
  } catch (e) {
    if (e.code !== '23505') throw e;
  }

  r = await db.query(
    `SELECT * FROM user_watchlists WHERE user_id = $1 AND name = $2 LIMIT 1`,
    [userId, MAIN_NAME]
  );
  if (r.rows.length === 0) throw new Error('Failed to create main watchlist row');
  return r.rows[0];
}

/** One-time: copy existing stock alerts into empty Main watchlist JSON. */
async function seedFromStockAlertsIfEmpty(userId) {
  const row = await getMainRow(userId);
  const arr = parseSymbolsJson(row.symbols);
  if (arr.length > 0) return row;

  const alerts = await db.query(
    `SELECT DISTINCT UPPER(TRIM(symbol)) AS symbol
     FROM user_alerts
     WHERE user_id = $1 AND asset_type = 'stock'`,
    [userId]
  );
  const tokens = alerts.rows.map((r) => tokenForStock(r.symbol));
  if (tokens.length === 0) return row;

  await db.query(
    `UPDATE user_watchlists SET symbols = $1::jsonb, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(tokens), row.id]
  );

  const updated = await db.query(`SELECT * FROM user_watchlists WHERE id = $1`, [row.id]);
  return updated.rows[0];
}

async function warmStockQuote(symbol) {
  const pm = new PriceMonitor(null);
  const priceData = await pm.getStockPrice(symbol);
  if (!priceData) return false;
  const redis = getRedisClient();
  await redis.setEx(
    `price:${String(priceData.type).toLowerCase()}:${String(priceData.symbol).toUpperCase()}`,
    300,
    JSON.stringify(priceData)
  );
  return true;
}

class WatchlistService {
  /**
   * @returns {Promise<Set<string>>} keys like `stock:AAPL`
   */
  async getAllowedAlertKeys(userId) {
    const row = await seedFromStockAlertsIfEmpty(userId);
    const arr = parseSymbolsJson(row.symbols);
    const set = new Set();
    for (const t of arr) {
      const p = parseToken(t);
      if (p) set.add(alertKey(p.assetType, p.symbol));
    }
    return set;
  }

  /** @returns {Promise<{ symbols: string[], tokens: string[] }>} */
  async getMainWatchlist(userId) {
    const row = await seedFromStockAlertsIfEmpty(userId);
    const arr = parseSymbolsJson(row.symbols);
    const symbols = [];
    for (const t of arr) {
      const p = parseToken(t);
      if (p) symbols.push(p.symbol);
    }
    return { symbols, tokens: arr.filter((x) => typeof x === 'string') };
  }

  async addStock(userId, rawSymbol, alertService) {
    const symCheck = validateAlertSymbol(rawSymbol);
    if (!symCheck.ok) {
      const err = new Error(symCheck.message);
      err.statusCode = 400;
      throw err;
    }
    const symbol = symCheck.symbol;
    const token = tokenForStock(symbol);

    const row = await seedFromStockAlertsIfEmpty(userId);
    let arr = [...parseSymbolsJson(row.symbols)];

    if (arr.includes(token)) {
      const err = new Error(`${symbol} is already on your watchlist`);
      err.statusCode = 409;
      throw err;
    }

    const existingCount = await alertService.countUserAlerts(userId);
    const existingAlert = await db.query(
      `SELECT id FROM user_alerts WHERE user_id = $1 AND UPPER(TRIM(symbol)) = $2 AND asset_type = 'stock'`,
      [userId, symbol]
    );

    if (existingCount >= config.MAX_ALERTS_PER_USER && existingAlert.rows.length === 0) {
      const err = new Error(
        `Maximum ${config.MAX_ALERTS_PER_USER} monitored symbols per account. Remove one from your watchlist first.`
      );
      err.statusCode = 403;
      throw err;
    }

    await warmStockQuote(symbol);

    if (existingAlert.rows.length === 0) {
      await alertService.createAlert(userId, symbol, 'stock', {
        small_threshold: 5,
        medium_threshold: 10,
        large_threshold: 15
      });
    }

    arr.push(token);
    await db.query(
      `UPDATE user_watchlists SET symbols = $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(arr), row.id]
    );

    logger.info(`Watchlist +stock user=${userId} ${symbol}`);
    return this.getMainWatchlist(userId);
  }

  async removeStock(userId, rawSymbol, alertService) {
    const symCheck = validateAlertSymbol(rawSymbol);
    if (!symCheck.ok) {
      const err = new Error(symCheck.message);
      err.statusCode = 400;
      throw err;
    }
    const symbol = symCheck.symbol;
    const token = tokenForStock(symbol);

    const row = await getMainRow(userId);
    let arr = parseSymbolsJson(row.symbols).filter((t) => t !== token);

    await db.query(
      `UPDATE user_watchlists SET symbols = $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(arr), row.id]
    );

    const alertRow = await db.query(
      `SELECT id FROM user_alerts WHERE user_id = $1 AND UPPER(TRIM(symbol)) = $2 AND asset_type = 'stock'`,
      [userId, symbol]
    );
    if (alertRow.rows.length > 0) {
      await alertService.deleteAlert(alertRow.rows[0].id, userId);
    }

    logger.info(`Watchlist -stock user=${userId} ${symbol}`);
    return this.getMainWatchlist(userId);
  }
}

const watchlistService = new WatchlistService();

module.exports = {
  WatchlistService,
  watchlistService,
  parseToken,
  tokenForStock,
  alertKey,
  seedFromStockAlertsIfEmpty,
  warmStockQuote,
  parseSymbolsJson
};
