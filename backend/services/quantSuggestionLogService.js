const { pool } = require('../models/database');
const logger = require('../utils/logger');
const PriceMonitor = require('./priceMonitor');

const VALID_STRATEGIES = new Set([
  'momentum_liquidity',
  'photonics_chokepoint',
  'rule_breaker_gardner',
  'rule_breaker_gardner_early'
]);

const priceMonitor = new PriceMonitor(null);

function daysBetween(a, b) {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

async function getStockClose(symbol) {
  try {
    const p = await priceMonitor.getStockPrice(String(symbol).toUpperCase());
    if (!p || p.price == null) return null;
    return Number(p.price);
  } catch (err) {
    logger.warn(`quant suggestion price lookup failed for ${symbol}: ${err.message}`);
    return null;
  }
}

async function logSuggestionAdd({
  userId,
  symbol,
  strategy,
  rankScore,
  rankPosition,
  entryPrice,
  source = 'dashboard_add'
}) {
  const sym = String(symbol || '').trim().toUpperCase();
  const strat = String(strategy || '').trim();
  if (!sym || !VALID_STRATEGIES.has(strat)) {
    const err = new Error('Invalid symbol or strategy');
    err.statusCode = 400;
    throw err;
  }

  let price = entryPrice != null ? Number(entryPrice) : null;
  if (price == null || !Number.isFinite(price) || price <= 0) {
    price = await getStockClose(sym);
  }
  const spyEntry = await getStockClose('SPY');

  const { rows } = await pool.query(
    `INSERT INTO quant_rank_suggestion_log
      (user_id, symbol, strategy, rank_score, rank_position, entry_price, spy_entry_price, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, user_id, symbol, strategy, rank_score, rank_position, entry_price, spy_entry_price, source, created_at`,
    [
      userId,
      sym,
      strat,
      rankScore != null && Number.isFinite(Number(rankScore)) ? Number(rankScore) : null,
      rankPosition != null && Number.isFinite(Number(rankPosition)) ? Number(rankPosition) : null,
      price,
      spyEntry != null && Number.isFinite(spyEntry) ? spyEntry : null,
      String(source || 'dashboard_add').slice(0, 32)
    ]
  );
  return rows[0];
}

async function getUserSuggestionOutcomes(userId, { limit = 40 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, symbol, strategy, rank_score, rank_position, entry_price, spy_entry_price, source, created_at
     FROM quant_rank_suggestion_log
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, Math.min(100, Math.max(1, Number(limit) || 40))]
  );

  const now = new Date();
  const enriched = [];
  let sumReturn = 0;
  let sumSpy = 0;
  let countWithReturn = 0;

  const spyNow = await getStockClose('SPY');

  for (const row of rows) {
    const entry = row.entry_price != null ? Number(row.entry_price) : null;
    const spyEntry = row.spy_entry_price != null ? Number(row.spy_entry_price) : null;
    const created = row.created_at ? new Date(row.created_at) : now;
    const current = await getStockClose(row.symbol);
    const ageDays = daysBetween(created, now);

    let returnPct = null;
    if (entry != null && entry > 0 && current != null && Number.isFinite(current)) {
      returnPct = ((current - entry) / entry) * 100;
    }

    let spyReturnPct = null;
    if (spyEntry != null && spyEntry > 0 && spyNow != null && Number.isFinite(spyNow)) {
      spyReturnPct = ((spyNow - spyEntry) / spyEntry) * 100;
    }

    if (returnPct != null) {
      sumReturn += returnPct;
      countWithReturn += 1;
      if (spyReturnPct != null) sumSpy += spyReturnPct;
    }

    enriched.push({
      id: row.id,
      symbol: row.symbol,
      strategy: row.strategy,
      rankScore: row.rank_score != null ? Number(row.rank_score) : null,
      rankPosition: row.rank_position,
      entryPrice: entry,
      currentPrice: current,
      returnPct: returnPct != null ? Number(returnPct.toFixed(3)) : null,
      spyReturnPct: spyReturnPct != null ? Number(spyReturnPct.toFixed(3)) : null,
      excessReturnPct:
        returnPct != null && spyReturnPct != null
          ? Number((returnPct - spyReturnPct).toFixed(3))
          : null,
      ageDays,
      source: row.source,
      createdAt: row.created_at
    });
  }

  const avgReturnPct =
    countWithReturn > 0 ? Number((sumReturn / countWithReturn).toFixed(3)) : null;
  const avgSpyReturnPct =
    countWithReturn > 0 ? Number((sumSpy / countWithReturn).toFixed(3)) : null;

  return {
    totalLogged: rows.length,
    withReturns: countWithReturn,
    avgReturnPct,
    avgSpyReturnPct,
    avgExcessReturnPct:
      avgReturnPct != null && avgSpyReturnPct != null
        ? Number((avgReturnPct - avgSpyReturnPct).toFixed(3))
        : null,
    items: enriched
  };
}

module.exports = {
  logSuggestionAdd,
  getUserSuggestionOutcomes,
  VALID_STRATEGIES
};
