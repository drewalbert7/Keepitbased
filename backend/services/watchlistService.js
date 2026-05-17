const db = require('../models/database');
const logger = require('../utils/logger');
const { getRedisClient } = require('../utils/redis');
const { validateAlertSymbol, normalizeAlertSymbol } = require('../utils/alertSymbolValidate');
const PriceMonitor = require('./priceMonitor');
const config = require('../config');
const { assertTradableUsStock } = require('./stockReferenceService');
const itickClient = require('./itickClient');
const {
  parseWatchlistToken,
  tokenForUsStock,
  tokenForTwStock,
  twAlertSymbol,
  parseTwAlertSymbol,
  normalizeTwCode,
  resolveTwSymbolInput,
  alertKey,
  CRYPTO_PREFIX
} = require('../utils/stockMarketIdentity');

const MAIN_NAME = 'Main';

function tokenForStock(symbol) {
  return tokenForUsStock(symbol);
}

function tokenForCrypto(baseSymbol) {
  return `${CRYPTO_PREFIX}:${String(baseSymbol).toUpperCase()}`;
}

function parseToken(token) {
  return parseWatchlistToken(token);
}

/** Strip Polygon-style suffix if user pasted `X:BTCUSD` — store base `BTC` in alerts/redis. */
function normalizeCryptoBaseForAlert(raw) {
  let s = normalizeAlertSymbol(raw);
  if (s.startsWith('X:')) s = s.slice(2);
  s = s.replace(/USDT?$/i, '').replace(/USD$/i, '');
  return validateAlertSymbol(s);
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

/** One-time: copy existing alerts into empty Main watchlist JSON. */
async function seedMainWatchlistFromAlertsIfEmpty(userId) {
  const row = await getMainRow(userId);
  const arr = parseSymbolsJson(row.symbols);
  if (arr.length > 0) return row;

  const stockAlerts = await db.query(
    `SELECT DISTINCT UPPER(TRIM(symbol)) AS symbol
     FROM user_alerts
     WHERE user_id = $1 AND asset_type = 'stock'`,
    [userId]
  );
  const cryptoAlerts = await db.query(
    `SELECT DISTINCT UPPER(TRIM(symbol)) AS symbol
     FROM user_alerts
     WHERE user_id = $1 AND asset_type = 'crypto'`,
    [userId]
  );
  const tokens = [
    ...stockAlerts.rows.map((r) => {
      const sym = String(r.symbol || '').trim().toUpperCase();
      const tw = parseTwAlertSymbol(sym);
      if (tw) return tokenForTwStock(tw.code);
      return tokenForStock(sym);
    }),
    ...cryptoAlerts.rows.map((r) => tokenForCrypto(r.symbol))
  ];
  if (tokens.length === 0) return row;

  await db.query(
    `UPDATE user_watchlists SET symbols = $1::jsonb, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(tokens), row.id]
  );

  const updated = await db.query(`SELECT * FROM user_watchlists WHERE id = $1`, [row.id]);
  return updated.rows[0];
}

async function warmStockQuote(alertSymbol) {
  const pm = new PriceMonitor(null);
  const priceData = await pm.getStockPrice(alertSymbol);
  if (!priceData) return false;
  const redis = getRedisClient();
  await redis.setEx(
    `price:${String(priceData.type).toLowerCase()}:${String(priceData.symbol).toUpperCase()}`,
    300,
    JSON.stringify(priceData)
  );
  return true;
}

async function warmCryptoQuote(baseSymbol) {
  const pm = new PriceMonitor(null);
  const priceData = await pm.getCryptoPrice(String(baseSymbol).toUpperCase());
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
    const row = await seedMainWatchlistFromAlertsIfEmpty(userId);
    const arr = parseSymbolsJson(row.symbols);
    const set = new Set();
    for (const t of arr) {
      const p = parseToken(t);
      if (p) set.add(alertKey(p.assetType, p.alertSymbol || p.symbol));
    }
    return set;
  }

  /** @returns {Promise<{ symbols: string[], tokens: string[] }>} */
  async getMainWatchlist(userId) {
    const row = await seedMainWatchlistFromAlertsIfEmpty(userId);
    const arr = parseSymbolsJson(row.symbols);
    const symbols = [];
    for (const t of arr) {
      const p = parseToken(t);
      if (p) symbols.push(p.alertSymbol || p.symbol);
    }
    return { symbols, tokens: arr.filter((x) => typeof x === 'string') };
  }

  async addStock(userId, rawSymbol, alertService) {
    const raw = String(rawSymbol || '').trim().toUpperCase();
    if (raw.startsWith('TW:')) {
      return this.addTwStock(userId, raw, alertService);
    }

    const symCheck = validateAlertSymbol(rawSymbol);
    if (!symCheck.ok) {
      const err = new Error(symCheck.message);
      err.statusCode = 400;
      throw err;
    }
    const normalizedInput = symCheck.symbol;
    let symbol = normalizedInput;
    try {
      const resolved = await assertTradableUsStock(normalizedInput);
      symbol = resolved.ticker;
    } catch (e) {
      if (e.statusCode === 400) throw e;
      const err = new Error(e.message || 'Could not verify stock symbol');
      err.statusCode = 400;
      throw err;
    }

    const token = tokenForStock(symbol);

    const row = await seedMainWatchlistFromAlertsIfEmpty(userId);
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

    logger.info(`Watchlist +stock user=${userId} ${symbol}${normalizedInput !== symbol ? ` (from "${normalizedInput}")` : ''}`);
    return this.getMainWatchlist(userId);
  }

  async addTwStock(userId, rawSymbol, alertService) {
    if (!config.ITICK_TW_ENABLED) {
      const err = new Error('Taiwan market data is disabled on this server');
      err.statusCode = 503;
      throw err;
    }
    if (!itickClient.isConfigured()) {
      const err = new Error('Taiwan stocks require ITICK_API_TOKEN on the server');
      err.statusCode = 503;
      throw err;
    }

    const codeCheck = resolveTwSymbolInput(rawSymbol);
    if (!codeCheck.ok) {
      const err = new Error(codeCheck.message);
      err.statusCode = 400;
      throw err;
    }
    const alertSymbol = twAlertSymbol(codeCheck.code);
    const token = tokenForTwStock(codeCheck.code);
    if (!token) {
      const err = new Error('Invalid Taiwan stock code');
      err.statusCode = 400;
      throw err;
    }

    const row = await seedMainWatchlistFromAlertsIfEmpty(userId);
    let arr = [...parseSymbolsJson(row.symbols)];

    if (arr.includes(token)) {
      const err = new Error(`${alertSymbol} is already on your watchlist`);
      err.statusCode = 409;
      throw err;
    }

    const existingCount = await alertService.countUserAlerts(userId);
    const existingAlert = await db.query(
      `SELECT id FROM user_alerts WHERE user_id = $1 AND UPPER(TRIM(symbol)) = $2 AND asset_type = 'stock'`,
      [userId, alertSymbol]
    );

    if (existingCount >= config.MAX_ALERTS_PER_USER && existingAlert.rows.length === 0) {
      const err = new Error(
        `Maximum ${config.MAX_ALERTS_PER_USER} monitored symbols per account. Remove one from your watchlist first.`
      );
      err.statusCode = 403;
      throw err;
    }

    const warmed = await warmStockQuote(alertSymbol);
    if (!warmed) {
      const err = new Error(
        `Could not load a quote for Taiwan symbol ${codeCheck.code}. Check the code or iTick plan coverage.`
      );
      err.statusCode = 400;
      throw err;
    }

    if (existingAlert.rows.length === 0) {
      await alertService.createAlert(userId, alertSymbol, 'stock', {
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

    logger.info(`Watchlist +TW stock user=${userId} ${alertSymbol}`);
    return this.getMainWatchlist(userId);
  }

  async addCrypto(userId, rawSymbol, alertService) {
    const symCheck = normalizeCryptoBaseForAlert(rawSymbol);
    if (!symCheck.ok) {
      const err = new Error(symCheck.message);
      err.statusCode = 400;
      throw err;
    }
    const symbol = symCheck.symbol;
    const token = tokenForCrypto(symbol);

    const row = await seedMainWatchlistFromAlertsIfEmpty(userId);
    let arr = [...parseSymbolsJson(row.symbols)];

    if (arr.includes(token)) {
      const err = new Error(`${symbol} is already on your crypto watchlist`);
      err.statusCode = 409;
      throw err;
    }

    const existingCount = await alertService.countUserAlerts(userId);
    const existingAlert = await db.query(
      `SELECT id FROM user_alerts WHERE user_id = $1 AND UPPER(TRIM(symbol)) = $2 AND asset_type = 'crypto'`,
      [userId, symbol]
    );

    if (existingCount >= config.MAX_ALERTS_PER_USER && existingAlert.rows.length === 0) {
      const err = new Error(
        `Maximum ${config.MAX_ALERTS_PER_USER} monitored symbols per account. Remove one from your watchlist first.`
      );
      err.statusCode = 403;
      throw err;
    }

    await warmCryptoQuote(symbol);

    if (existingAlert.rows.length === 0) {
      await alertService.createAlert(userId, symbol, 'crypto', {
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

    logger.info(`Watchlist +crypto user=${userId} ${symbol}`);
    return this.getMainWatchlist(userId);
  }

  async removeSymbol(userId, rawSymbol, assetType, alertService) {
    const at = assetType === 'crypto' ? 'crypto' : 'stock';
    let symbol;
    let token;

    if (at === 'crypto') {
      const symCheck = normalizeCryptoBaseForAlert(rawSymbol);
      if (!symCheck.ok) {
        const err = new Error(symCheck.message);
        err.statusCode = 400;
        throw err;
      }
      symbol = symCheck.symbol;
      token = tokenForCrypto(symbol);
    } else {
      const raw = String(rawSymbol || '').trim().toUpperCase();
      const tw = raw.startsWith('TW:') ? raw : null;
      if (tw) {
        const code = tw.slice(3).replace(/\D/g, '');
        symbol = twAlertSymbol(code);
        token = tokenForTwStock(code);
        if (!token) {
          const err = new Error('Invalid Taiwan symbol');
          err.statusCode = 400;
          throw err;
        }
      } else {
        const symCheck = validateAlertSymbol(rawSymbol);
        if (!symCheck.ok) {
          const err = new Error(symCheck.message);
          err.statusCode = 400;
          throw err;
        }
        symbol = symCheck.symbol;
        token = tokenForStock(symbol);
      }
    }

    const row = await getMainRow(userId);
    let arr = parseSymbolsJson(row.symbols).filter((t) => t !== token);

    await db.query(
      `UPDATE user_watchlists SET symbols = $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(arr), row.id]
    );

    const alertRow = await db.query(
      `SELECT id FROM user_alerts WHERE user_id = $1 AND UPPER(TRIM(symbol)) = $2 AND asset_type = $3`,
      [userId, symbol, at]
    );
    if (alertRow.rows.length > 0) {
      await alertService.deleteAlert(alertRow.rows[0].id, userId);
    }

    logger.info(`Watchlist -${at} user=${userId} ${symbol}`);
    return this.getMainWatchlist(userId);
  }

  async removeStock(userId, rawSymbol, alertService) {
    return this.removeSymbol(userId, rawSymbol, 'stock', alertService);
  }
}

const watchlistService = new WatchlistService();

module.exports = {
  WatchlistService,
  watchlistService,
  parseToken,
  tokenForStock,
  tokenForCrypto,
  alertKey,
  seedMainWatchlistFromAlertsIfEmpty,
  warmStockQuote,
  parseSymbolsJson,
  tokenForTwStock,
  twAlertSymbol
};
