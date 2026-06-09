const axios = require('axios');
const db = require('../models/database');
const config = require('../config');
const logger = require('../utils/logger');
const { resolveQuantAgiBaseUrl } = require('../utils/quantAgiBaseUrl');
const deployListService = require('./deployListService');

const DEFAULT_STARTING_CASH = 10000;
const DISARM_CONFIRM_PHRASE = 'ENABLE PAPER TRADES';
const DEFAULT_POLICY = {
  max_position_pct: 10,
  max_notional_per_trade: 750,
  min_cash_reserve: 500,
  max_open_positions: 5
};
const POLICY_PRECEDENCE =
  'kill_switch > user caps > active approved rules > engine defaults';
const RANK_STRATEGIES_FOR_BRAIN = ['momentum_liquidity', 'rule_breaker_gardner'];

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function mapPosition(row, priceMap) {
  const qty = Number(row.quantity);
  const avgCost = Number(row.avg_cost_usd);
  const lastPrice = priceMap[row.symbol.toUpperCase()] ?? null;
  const marketValue = lastPrice != null ? qty * lastPrice : qty * avgCost;
  const costBasis = qty * avgCost;
  return {
    symbol: row.symbol,
    assetType: row.asset_type,
    quantity: qty,
    avgCostUsd: avgCost,
    lastPriceUsd: lastPrice,
    marketValueUsd: round2(marketValue),
    unrealizedPnlUsd: round2(marketValue - costBasis)
  };
}

function mapTrade(row) {
  const reasonJson =
    row.reason_json && typeof row.reason_json === 'object' && !Array.isArray(row.reason_json)
      ? row.reason_json
      : {};
  return {
    id: row.id,
    symbol: row.symbol,
    assetType: row.asset_type,
    side: row.side,
    quantity: Number(row.quantity),
    priceUsd: Number(row.price_usd),
    notionalUsd: Number(row.notional_usd),
    reasonTags: Array.isArray(row.reason_tags) ? row.reason_tags : [],
    reasonJson,
    policyVersion: row.policy_version,
    createdAt: row.created_at
  };
}

function coercePolicyValue(key, value) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (key === 'max_open_positions') return Math.max(1, Math.min(20, Math.round(n)));
  return Math.round(n * 100) / 100;
}

function mergeActiveRulesFromRows(ruleRows) {
  const policy = { ...DEFAULT_POLICY };
  for (const row of ruleRows || []) {
    const payload = row.rule_json && typeof row.rule_json === 'object' ? row.rule_json : {};
    const ruleType = String(payload.rule_type || row.rule_type || '').trim();
    if (ruleType && Object.prototype.hasOwnProperty.call(DEFAULT_POLICY, ruleType)) {
      const val = coercePolicyValue(ruleType, payload.value ?? payload[ruleType]);
      if (val != null) policy[ruleType] = val;
    }
    for (const key of Object.keys(DEFAULT_POLICY)) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        const val = coercePolicyValue(key, payload[key]);
        if (val != null) policy[key] = val;
      }
    }
  }
  return policy;
}

function mapSnapshot(row) {
  return {
    snapshotDate: row.snapshot_date,
    equityUsd: Number(row.equity_usd),
    cashUsd: Number(row.cash_usd),
    dayPnlUsd: Number(row.day_pnl_usd),
    cumPnlUsd: Number(row.cum_pnl_usd)
  };
}

function mapAccount(row, metrics) {
  const starting = Number(row.starting_cash_usd);
  const cash = Number(row.cash_usd);
  const equity = metrics?.equityUsd ?? cash;
  const dayPnl = metrics?.dayPnlUsd ?? 0;
  return {
    userId: row.user_id,
    startingCashUsd: starting,
    cashUsd: cash,
    equityUsd: round2(equity),
    dayPnlUsd: round2(dayPnl),
    cumPnlUsd: round2(equity - starting),
    openRiskPct: metrics?.openRiskPct ?? 0,
    mode: row.mode,
    killSwitchArmed: row.kill_switch_armed,
    tradeDeployListOnly: row.trade_deploy_list_only,
    policyVersion: row.policy_version,
    lastTradeAt: row.last_trade_at,
    daysSinceLastTrade: row.last_trade_at
      ? Math.floor((Date.now() - new Date(row.last_trade_at).getTime()) / (24 * 60 * 60 * 1000))
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRule(row) {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    ruleText: row.rule_text,
    ruleJson: row.rule_json || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function loadRulesByStatus(userId, status) {
  const { rows } = await db.query(
    `SELECT * FROM paper_bot_rules
     WHERE user_id = $1 AND status = $2
     ORDER BY created_at DESC`,
    [userId, status]
  );
  return rows;
}

async function loadActiveRulesPayload(userId) {
  const rows = await loadRulesByStatus(userId, 'active');
  return rows.map((r) => ({
    rule_type: r.rule_json?.rule_type,
    rule_json: r.rule_json,
    rule_text: r.rule_text
  }));
}

async function loadPositions(userId) {
  const { rows } = await db.query(
    `SELECT * FROM paper_bot_positions WHERE user_id = $1 ORDER BY symbol ASC`,
    [userId]
  );
  return rows;
}

async function loadRecentTrades(userId, limit = 20) {
  const { rows } = await db.query(
    `SELECT * FROM paper_bot_trades WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

async function loadRecentEvents(userId, limit = 20) {
  const { rows } = await db.query(
    `SELECT id, event_type, payload, created_at
     FROM paper_bot_events
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows.map((r) => ({
    id: r.id,
    eventType: r.event_type,
    payload: r.payload || {},
    createdAt: r.created_at
  }));
}

async function fetchRankLeadersForBrain() {
  const base = resolveQuantAgiBaseUrl();
  const timeout = config.QUANT_AGI_RANK_TIMEOUT_MS || 45000;
  const out = [];
  for (const strategy of RANK_STRATEGIES_FOR_BRAIN) {
    try {
      const { data } = await axios.get(`${base}/diag/market-universe-rank`, {
        params: { strategy, top_n: 5 },
        timeout
      });
      const rows = Array.isArray(data?.positions)
        ? data.positions
        : Array.isArray(data?.rows)
          ? data.rows
          : [];
      out.push({
        strategy,
        leaders: rows.slice(0, 5).map((row) => ({
          symbol: String(row.symbol || '').toUpperCase(),
          score: typeof row.score === 'number' ? row.score : Number(row.tape_score_raw ?? row.score ?? 0)
        }))
      });
    } catch (err) {
      logger.warn(`Brain rank fetch failed (${strategy}): ${err.message}`);
      out.push({ strategy, leaders: [], error: err.message });
    }
  }
  return out;
}

async function buildRunContext(userId) {
  const accountRow = await ensureAccount(userId);
  const positionsRaw = await loadPositions(userId);
  const universe = await resolveUniverse(userId, accountRow.trade_deploy_list_only);
  const priceSymbols = [...new Set([...universe, ...positionsRaw.map((p) => p.symbol)])];
  const priceMap = await fetchSymbolPrices(priceSymbols);
  const activeRuleRows = await loadRulesByStatus(userId, 'active');
  const activeRules = activeRuleRows.map(mapRule);
  const activeRulesPayload = await loadActiveRulesPayload(userId);
  const mergedPolicy = mergeActiveRulesFromRows(activeRuleRows);
  const positionsPayload = positionsRaw.map((p) => ({
    symbol: p.symbol,
    quantity: Number(p.quantity),
    avg_cost_usd: Number(p.avg_cost_usd)
  }));

  return {
    accountRow,
    positionsRaw,
    universe,
    priceMap,
    activeRules,
    activeRulesPayload,
    mergedPolicy,
    positionsPayload,
    universeSource: accountRow.trade_deploy_list_only ? 'deploy_list' : 'watchlist'
  };
}

async function loadSnapshots(userId, limit = 90) {
  const { rows } = await db.query(
    `SELECT * FROM paper_bot_daily_snapshots
     WHERE user_id = $1
     ORDER BY snapshot_date DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows.reverse();
}

async function fetchSymbolPrices(symbols) {
  const uniq = [...new Set(symbols.map((s) => String(s).toUpperCase()).filter(Boolean))];
  if (!uniq.length) return {};

  const base = resolveQuantAgiBaseUrl();
  try {
    const { data } = await axios.get(`${base}/diag/market-snapshot`, {
      params: { symbols: uniq.join(',') },
      timeout: config.QUANT_AGI_RANK_TIMEOUT_MS || 45000
    });
    const out = {};
    for (const row of data?.symbols || []) {
      const sym = String(row.symbol || '').toUpperCase();
      const px = Number(row.last_close);
      if (sym && Number.isFinite(px) && px > 0) out[sym] = px;
    }
    return out;
  } catch (err) {
    logger.warn(`Paper bot price fetch failed: ${err.message}`);
    return {};
  }
}

async function computeMetrics(accountRow, positions, priceMap) {
  const cash = Number(accountRow.cash_usd);
  let invested = 0;
  for (const p of positions) {
    const px = priceMap[p.symbol.toUpperCase()] ?? Number(p.avg_cost_usd);
    invested += Number(p.quantity) * px;
  }
  const equity = cash + invested;
  const starting = Number(accountRow.starting_cash_usd);
  const openRiskPct = equity > 0 ? (invested / equity) * 100 : 0;

  const today = new Date().toISOString().slice(0, 10);
  const snapRes = await db.query(
    `SELECT equity_usd FROM paper_bot_daily_snapshots
     WHERE user_id = $1 AND snapshot_date < $2::date
     ORDER BY snapshot_date DESC LIMIT 1`,
    [accountRow.user_id, today]
  );
  const prevEquity = snapRes.rows.length ? Number(snapRes.rows[0].equity_usd) : starting;
  const dayPnlUsd = equity - prevEquity;

  return { equityUsd: equity, dayPnlUsd, openRiskPct: round2(openRiskPct) };
}

async function upsertDailySnapshot(userId, accountRow, metrics) {
  const today = new Date().toISOString().slice(0, 10);
  const starting = Number(accountRow.starting_cash_usd);
  await db.query(
    `INSERT INTO paper_bot_daily_snapshots
       (user_id, snapshot_date, equity_usd, cash_usd, day_pnl_usd, cum_pnl_usd)
     VALUES ($1, $2::date, $3, $4, $5, $6)
     ON CONFLICT (user_id, snapshot_date) DO UPDATE SET
       equity_usd = EXCLUDED.equity_usd,
       cash_usd = EXCLUDED.cash_usd,
       day_pnl_usd = EXCLUDED.day_pnl_usd,
       cum_pnl_usd = EXCLUDED.cum_pnl_usd`,
    [
      userId,
      today,
      round2(metrics.equityUsd),
      round2(Number(accountRow.cash_usd)),
      round2(metrics.dayPnlUsd),
      round2(metrics.equityUsd - starting)
    ]
  );
}

async function resolveUniverse(userId, tradeDeployListOnly) {
  if (tradeDeployListOnly) {
    const rows = await deployListService.listDeployList(userId);
    const symbols = rows
      .filter((r) => r.alert_active !== false)
      .map((r) => String(r.symbol || '').toUpperCase())
      .filter(Boolean);
    if (symbols.length) return symbols;
  }

  const { rows } = await db.query(
    `SELECT symbol FROM user_alerts
     WHERE user_id = $1 AND active = true AND asset_type = 'stock'
     ORDER BY updated_at DESC LIMIT 25`,
    [userId]
  );
  return rows.map((r) => String(r.symbol).toUpperCase()).filter(Boolean);
}

async function ensureAccount(userId) {
  const existing = await db.query(`SELECT * FROM paper_bot_accounts WHERE user_id = $1`, [userId]);
  if (existing.rows.length) {
    return existing.rows[0];
  }
  const inserted = await db.query(
    `INSERT INTO paper_bot_accounts (user_id, starting_cash_usd, cash_usd, kill_switch_armed, trade_deploy_list_only)
     VALUES ($1, $2, $2, true, true)
     RETURNING *`,
    [userId, DEFAULT_STARTING_CASH]
  );
  await db.query(
    `INSERT INTO paper_bot_events (user_id, event_type, payload)
     VALUES ($1, 'account_created', $2)`,
    [userId, JSON.stringify({ startingCashUsd: DEFAULT_STARTING_CASH })]
  );
  logger.info(`Paper bot account created for user ${userId}`);
  return inserted.rows[0];
}

async function applyFill(userId, accountRow, fill) {
  const symbol = String(fill.symbol).toUpperCase();
  const side = fill.side === 'sell' ? 'sell' : 'buy';
  const qty = Number(fill.quantity);
  const price = Number(fill.price_usd);
  const notional = round2(Number(fill.notional_usd ?? qty * price));
  const reasonTags = JSON.stringify(Array.isArray(fill.reason_tags) ? fill.reason_tags : ['manual']);
  const reasonJson = JSON.stringify(
    fill.reason_json && typeof fill.reason_json === 'object' && !Array.isArray(fill.reason_json)
      ? fill.reason_json
      : {}
  );

  if (!symbol || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
    const err = new Error('Invalid fill');
    err.statusCode = 400;
    throw err;
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const acctRes = await client.query(`SELECT * FROM paper_bot_accounts WHERE user_id = $1 FOR UPDATE`, [
      userId
    ]);
    const acct = acctRes.rows[0];
    let cash = Number(acct.cash_usd);

    if (side === 'buy') {
      if (cash + 0.01 < notional) {
        const err = new Error('Insufficient cash for buy');
        err.statusCode = 400;
        throw err;
      }
      cash = round2(cash - notional);
      const posRes = await client.query(
        `SELECT * FROM paper_bot_positions WHERE user_id = $1 AND symbol = $2`,
        [userId, symbol]
      );
      if (posRes.rows.length) {
        const prev = posRes.rows[0];
        const prevQty = Number(prev.quantity);
        const newQty = prevQty + qty;
        const newAvg = (prevQty * Number(prev.avg_cost_usd) + notional) / newQty;
        await client.query(
          `UPDATE paper_bot_positions
           SET quantity = $3, avg_cost_usd = $4, updated_at = NOW()
           WHERE user_id = $1 AND symbol = $2`,
          [userId, symbol, newQty, round2(newAvg)]
        );
      } else {
        await client.query(
          `INSERT INTO paper_bot_positions (user_id, symbol, asset_type, quantity, avg_cost_usd)
           VALUES ($1, $2, 'stock', $3, $4)`,
          [userId, symbol, qty, price]
        );
      }
    } else {
      const posRes = await client.query(
        `SELECT * FROM paper_bot_positions WHERE user_id = $1 AND symbol = $2 FOR UPDATE`,
        [userId, symbol]
      );
      if (!posRes.rows.length) {
        const err = new Error('No position to sell');
        err.statusCode = 400;
        throw err;
      }
      const prevQty = Number(posRes.rows[0].quantity);
      if (prevQty + 1e-9 < qty) {
        const err = new Error('Sell quantity exceeds position');
        err.statusCode = 400;
        throw err;
      }
      cash = round2(cash + notional);
      const remaining = round2(prevQty - qty);
      if (remaining <= 1e-9) {
        await client.query(`DELETE FROM paper_bot_positions WHERE user_id = $1 AND symbol = $2`, [
          userId,
          symbol
        ]);
      } else {
        await client.query(
          `UPDATE paper_bot_positions SET quantity = $3, updated_at = NOW() WHERE user_id = $1 AND symbol = $2`,
          [userId, symbol, remaining]
        );
      }
    }

    await client.query(
      `UPDATE paper_bot_accounts SET cash_usd = $2, last_trade_at = NOW(), updated_at = NOW() WHERE user_id = $1`,
      [userId, cash]
    );

    await client.query(
      `INSERT INTO paper_bot_trades
         (user_id, symbol, asset_type, side, quantity, price_usd, notional_usd, reason_tags, reason_json, policy_version)
       VALUES ($1, $2, 'stock', $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
      [userId, symbol, side, qty, price, notional, reasonTags, reasonJson, accountRow.policy_version]
    );

    await client.query(
      `INSERT INTO paper_bot_events (user_id, event_type, payload)
       VALUES ($1, 'fill', $2)`,
      [
        userId,
        JSON.stringify({ symbol, side, quantity: qty, priceUsd: price, notionalUsd: notional })
      ]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getState(userId) {
  const row = await ensureAccount(userId);
  const positionsRaw = await loadPositions(userId);
  const tradesRaw = await loadRecentTrades(userId);

  const symbols = positionsRaw.map((p) => p.symbol);
  const priceMap = await fetchSymbolPrices(symbols);
  const metrics = await computeMetrics(row, positionsRaw, priceMap);
  await upsertDailySnapshot(userId, row, metrics);

  const snapshotsRaw = await loadSnapshots(userId);
  const account = mapAccount(row, metrics);
  const positions = positionsRaw.map((p) => mapPosition(p, priceMap));
  const recentTrades = tradesRaw.map(mapTrade);
  const snapshots = snapshotsRaw.map(mapSnapshot);

  let whyNoTradesToday = null;
  if (account.killSwitchArmed) {
    whyNoTradesToday =
      'Kill switch is armed — paper trades are paused until you disarm it above.';
  } else if (!recentTrades.length) {
    whyNoTradesToday = 'No fills yet — run a simulated day or add deploy-list symbols.';
  } else if (account.daysSinceLastTrade != null && account.daysSinceLastTrade > 0) {
    whyNoTradesToday = `Last fill was ${account.daysSinceLastTrade} day(s) ago. Run simulate-day to test policy.`;
  }

  const pendingRules = (await loadRulesByStatus(userId, 'pending')).map(mapRule);
  const activeRules = (await loadRulesByStatus(userId, 'active')).map(mapRule);

  return {
    account,
    positions,
    recentTrades,
    pendingRules,
    activeRules,
    snapshots,
    whyNoTradesToday,
    autoresearch: null,
    disclaimer:
      'Educational paper simulation only — not investment advice. No brokerage orders are placed.',
    phase: '3-autoresearch'
  };
}

async function setKillSwitch(userId, { armed, confirmPhrase }) {
  if (armed === false) {
    if (String(confirmPhrase || '').trim() !== DISARM_CONFIRM_PHRASE) {
      const err = new Error(`Type ${DISARM_CONFIRM_PHRASE} to disarm the kill switch`);
      err.statusCode = 400;
      err.code = 'CONFIRM_PHRASE_REQUIRED';
      throw err;
    }
  }
  await ensureAccount(userId);
  const { rows } = await db.query(
    `UPDATE paper_bot_accounts
     SET kill_switch_armed = $2, updated_at = NOW()
     WHERE user_id = $1
     RETURNING *`,
    [userId, Boolean(armed)]
  );
  await db.query(
    `INSERT INTO paper_bot_events (user_id, event_type, payload)
     VALUES ($1, 'kill_switch', $2)`,
    [userId, JSON.stringify({ armed: Boolean(armed) })]
  );
  return mapAccount(rows[0], null);
}

async function setTradeDeployListOnly(userId, enabled) {
  await ensureAccount(userId);
  const { rows } = await db.query(
    `UPDATE paper_bot_accounts
     SET trade_deploy_list_only = $2, updated_at = NOW()
     WHERE user_id = $1
     RETURNING *`,
    [userId, Boolean(enabled)]
  );
  return mapAccount(rows[0], null);
}

async function simulateDay(userId) {
  const ctx = await buildRunContext(userId);
  const { accountRow, universe, priceMap, activeRulesPayload, positionsPayload, universeSource } =
    ctx;
  const base = resolveQuantAgiBaseUrl();

  const { data } = await axios.post(
    `${base}/bot/run-day`,
    {
      cash_usd: Number(accountRow.cash_usd),
      kill_switch_armed: accountRow.kill_switch_armed,
      policy_version: accountRow.policy_version,
      universe_symbols: universe,
      prices: priceMap,
      positions: positionsPayload,
      active_rules: activeRulesPayload,
      universe_source: universeSource
    },
    { timeout: config.QUANT_AGI_RANK_TIMEOUT_MS || 45000 }
  );

  if (data?.skipped) {
    await db.query(
      `INSERT INTO paper_bot_events (user_id, event_type, payload)
       VALUES ($1, 'run_day_skipped', $2)`,
      [userId, JSON.stringify({ reason: data.reason || 'skipped' })]
    );
    return { ...((await getState(userId)) || {}), runDay: { skipped: true, reason: data.reason } };
  }

  const fills = Array.isArray(data?.fills) ? data.fills : [];
  for (const fill of fills) {
    await applyFill(userId, accountRow, fill);
  }

  const refreshed = await ensureAccount(userId);
  const posAfter = await loadPositions(userId);
  const metrics = await computeMetrics(refreshed, posAfter, priceMap);
  await upsertDailySnapshot(userId, refreshed, metrics);

  await db.query(
    `INSERT INTO paper_bot_events (user_id, event_type, payload)
     VALUES ($1, 'run_day_completed', $2)`,
    [userId, JSON.stringify({ fillCount: fills.length, fills })]
  );

  return { ...(await getState(userId)), runDay: { skipped: false, fillCount: fills.length } };
}

async function getPolicySnapshot(userId) {
  const ctx = await buildRunContext(userId);
  const { accountRow, universe, activeRules, mergedPolicy, positionsRaw, universeSource } = ctx;
  const rankLeaders = await fetchRankLeadersForBrain();
  const cash = Number(accountRow.cash_usd);

  return {
    policyVersion: accountRow.policy_version,
    precedence: POLICY_PRECEDENCE,
    mergedPolicy,
    activeRules,
    gates: {
      killSwitchArmed: accountRow.kill_switch_armed,
      tradeDeployListOnly: accountRow.trade_deploy_list_only,
      cashUsd: round2(cash),
      cashHeadroomUsd: round2(Math.max(0, cash - Number(mergedPolicy.min_cash_reserve))),
      openPositions: positionsRaw.length,
      maxOpenPositions: mergedPolicy.max_open_positions
    },
    universe: {
      source: universeSource,
      symbolCount: universe.length,
      symbolsSample: universe.slice(0, 10)
    },
    inputSignals: {
      rankLeaders,
      regimeLabel: null
    },
    disclaimer:
      'Grok proposes rules; bot_policy_engine merges approved rules into deterministic intents.'
  };
}

async function dryRun(userId) {
  const ctx = await buildRunContext(userId);
  const {
    accountRow,
    universe,
    priceMap,
    activeRulesPayload,
    positionsPayload,
    mergedPolicy,
    universeSource
  } = ctx;
  const base = resolveQuantAgiBaseUrl();

  const { data } = await axios.post(
    `${base}/bot/dry-run`,
    {
      cash_usd: Number(accountRow.cash_usd),
      kill_switch_armed: accountRow.kill_switch_armed,
      policy_version: accountRow.policy_version,
      universe_symbols: universe,
      prices: priceMap,
      positions: positionsPayload,
      active_rules: activeRulesPayload
    },
    { timeout: config.QUANT_AGI_RANK_TIMEOUT_MS || 45000 }
  );

  await db.query(
    `INSERT INTO paper_bot_events (user_id, event_type, payload)
     VALUES ($1, 'dry_run', $2)`,
    [
      userId,
      JSON.stringify({
        skipped: Boolean(data?.skipped),
        reason: data?.reason || null,
        intentCount: Array.isArray(data?.intents) ? data.intents.length : 0
      })
    ]
  );

  return {
    skipped: Boolean(data?.skipped),
    reason: data?.reason || null,
    intents: Array.isArray(data?.intents) ? data.intents : [],
    fills: Array.isArray(data?.fills) ? data.fills : [],
    policyVersion: data?.policy_version ?? accountRow.policy_version,
    appliedPolicy: data?.applied_policy || mergedPolicy
  };
}

async function getRecentEvents(userId, limit = 15) {
  return loadRecentEvents(userId, limit);
}

const BASELINE_MAX_DRAWDOWN_PCT = 0.15;
const RESET_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function sharpeProxy(returns) {
  if (!returns || returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std < 1e-12) return 0;
  return (mean / std) * Math.sqrt(252);
}

function maxDrawdownPct(snapshots, startingEquity) {
  let peak = Number(startingEquity || 0);
  let maxDd = 0;
  for (const row of snapshots) {
    const eq = Number(row.equity_usd ?? row.equityUsd ?? 0);
    peak = Math.max(peak, eq);
    if (peak > 0) maxDd = Math.max(maxDd, (peak - eq) / peak);
  }
  return round2(maxDd);
}

function computePaperBotMetrics(accountRow, snapshotsRaw, liveEquityUsd, tradeCount) {
  const starting = Number(accountRow.starting_cash_usd);
  const equity = Number(liveEquityUsd ?? starting);
  const returns = [];
  for (let i = 1; i < snapshotsRaw.length; i++) {
    const prev = Number(snapshotsRaw[i - 1].equity_usd);
    const curr = Number(snapshotsRaw[i].equity_usd);
    if (prev > 0) returns.push((curr - prev) / prev);
  }
  const prior5 = returns.length >= 10 ? returns.slice(-10, -5) : [];
  const recent5 = returns.length >= 5 ? returns.slice(-5) : [];

  return {
    startingCashUsd: starting,
    equityUsd: round2(equity),
    cumPnlUsd: round2(equity - starting),
    paperDays: snapshotsRaw.length,
    tradeCount: Number(tradeCount) || 0,
    sharpeProxy: round2(sharpeProxy(returns)),
    sharpe7d: round2(sharpeProxy(returns.slice(-7))),
    sharpeHoldout5dDelta: round2(sharpeProxy(recent5) - sharpeProxy(prior5)),
    maxDrawdownPct: maxDrawdownPct(snapshotsRaw, starting)
  };
}

function accountPromotionCooldown(accountRow) {
  const resetAt = accountRow?.reset_at ? new Date(accountRow.reset_at).getTime() : 0;
  if (!resetAt || !Number.isFinite(resetAt)) {
    return { blocked: false, hoursRemaining: 0 };
  }
  const elapsed = Date.now() - resetAt;
  if (elapsed >= RESET_COOLDOWN_MS) {
    return { blocked: false, hoursRemaining: 0 };
  }
  return {
    blocked: true,
    hoursRemaining: Math.ceil((RESET_COOLDOWN_MS - elapsed) / (60 * 60 * 1000))
  };
}

function evaluatePromotionGates(metrics, { walkForward = null, resetCooldown = null } = {}) {
  const gates = [
    {
      id: 'paper_days',
      label: '≥10 paper days',
      pass: metrics.paperDays >= 10,
      actual: metrics.paperDays,
      required: 10
    },
    {
      id: 'trade_count',
      label: '≥20 fills',
      pass: metrics.tradeCount >= 20,
      actual: metrics.tradeCount,
      required: 20
    },
    {
      id: 'sharpe_holdout',
      label: 'Sharpe Δ > 0 (last 5d vs prior 5d)',
      pass: metrics.sharpeHoldout5dDelta > 0,
      actual: metrics.sharpeHoldout5dDelta,
      required: 0
    },
    {
      id: 'max_drawdown',
      label: 'Max drawdown ≤ 15%',
      pass: metrics.maxDrawdownPct <= BASELINE_MAX_DRAWDOWN_PCT,
      actual: metrics.maxDrawdownPct,
      required: BASELINE_MAX_DRAWDOWN_PCT
    }
  ];

  if (walkForward) {
    gates.push({
      id: 'walk_forward',
      label: 'Walk-forward Sharpe Δ > 0 (Massive holdout)',
      pass: Boolean(walkForward.pass),
      actual: Number(walkForward.avgHoldoutSharpeDelta ?? walkForward.avg_holdout_sharpe_delta ?? 0),
      required: 0
    });
  }

  const cooldownBlocked = Boolean(resetCooldown?.blocked);
  gates.push({
    id: 'reset_cooldown',
    label: '24h cooldown after account reset',
    pass: !cooldownBlocked,
    actual: cooldownBlocked ? 1 : 0,
    required: 0
  });

  const passedCount = gates.filter((g) => g.pass).length;
  return {
    gates,
    passedCount,
    totalCount: gates.length,
    promotionReady: passedCount === gates.length
  };
}

async function countTrades(userId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS c FROM paper_bot_trades WHERE user_id = $1`,
    [userId]
  );
  return rows[0]?.c ?? 0;
}

async function fetchTradedSymbols(userId, limit = 12) {
  const { rows } = await db.query(
    `SELECT symbol, COUNT(*)::int AS fills
     FROM paper_bot_trades
     WHERE user_id = $1
     GROUP BY symbol
     ORDER BY fills DESC, symbol ASC
     LIMIT $2`,
    [userId, limit]
  );
  return rows.map((r) => String(r.symbol).toUpperCase());
}

async function buildNightlyContext(userId, accountRow, snapshotsRaw, metrics, tradeCount) {
  let worstDay = null;
  let positiveDays = 0;
  for (const row of snapshotsRaw) {
    const dayPnl = Number(row.day_pnl_usd);
    if (dayPnl > 0) positiveDays += 1;
    if (!worstDay || dayPnl < worstDay.dayPnlUsd) {
      worstDay = { snapshotDate: row.snapshot_date, dayPnlUsd: round2(dayPnl) };
    }
  }

  const symRes = await db.query(
    `SELECT symbol, COUNT(*)::int AS fills
     FROM paper_bot_trades WHERE user_id = $1
     GROUP BY symbol ORDER BY fills DESC LIMIT 10`,
    [userId]
  );
  const tagRes = await db.query(
    `SELECT tag, COUNT(*)::int AS n FROM (
       SELECT unnest(reason_tags) AS tag FROM paper_bot_trades
       WHERE user_id = $1 AND reason_tags IS NOT NULL AND cardinality(reason_tags) > 0
     ) t GROUP BY tag ORDER BY n DESC LIMIT 8`,
    [userId]
  );

  return {
    equityUsd: metrics.equityUsd,
    cumPnlUsd: metrics.cumPnlUsd,
    paperDays: metrics.paperDays,
    tradeCount,
    winRateDays: snapshotsRaw.length ? round2(positiveDays / snapshotsRaw.length) : 0,
    worstDay,
    symbolsTraded: symRes.rows.map((r) => ({
      symbol: r.symbol,
      fills: Number(r.fills)
    })),
    topReasonTags: tagRes.rows.map((r) => ({
      tag: r.tag,
      count: Number(r.n)
    }))
  };
}

async function fetchWalkForwardEval(symbols) {
  if (!symbols.length) return null;
  const base = resolveQuantAgiBaseUrl();
  try {
    const { data } = await axios.post(
      `${base}/diag/paper-bot/walk-forward`,
      { symbols, holdout_days: 5 },
      { timeout: config.QUANT_AGI_RANK_TIMEOUT_MS || 60000 }
    );
    if (!data?.ok) return null;
    return {
      symbolsRequested: data.symbols_requested ?? symbols.length,
      symbolsEvaluated: data.symbols_evaluated ?? 0,
      holdoutDays: data.holdout_days ?? 5,
      avgHoldoutSharpeDelta: round2(data.avg_holdout_sharpe_delta ?? 0),
      pass: Boolean(data.pass),
      reason: data.reason ?? null,
      perSymbol: Array.isArray(data.per_symbol) ? data.per_symbol.slice(0, 6) : []
    };
  } catch (err) {
    logger.warn(`Walk-forward eval failed: ${err.message}`);
    return null;
  }
}

async function fetchLatestPatchPreview() {
  const base = resolveQuantAgiBaseUrl();
  try {
    const { data } = await axios.get(`${base}/diag/terminal-feed`, {
      params: { limit: 1 },
      timeout: config.QUANT_AGI_RANK_TIMEOUT_MS || 45000
    });
    const patch = data?.latestPatch;
    if (!patch?.patch) return null;
    return {
      commitSha: patch.commitSha || null,
      createdAt: patch.createdAt || null,
      patchPreview: String(patch.patch).split('\n').slice(0, 12).join('\n'),
      truncated: Boolean(patch.truncated)
    };
  } catch (err) {
    logger.warn(`Latest patch preview failed: ${err.message}`);
    return null;
  }
}

async function fetchLatestAutoresearchExperiment() {
  const base = resolveQuantAgiBaseUrl();
  try {
    const { data } = await axios.get(`${base}/diag/experiments`, {
      params: { limit: 1 },
      timeout: config.QUANT_AGI_RANK_TIMEOUT_MS || 45000
    });
    const exp = (data?.experiments || [])[0];
    if (!exp) return null;
    const sharpeDelta =
      exp.baseline_sharpe != null && exp.candidate_sharpe != null
        ? round2(Number(exp.candidate_sharpe) - Number(exp.baseline_sharpe))
        : null;
    return {
      id: exp.id,
      branch: exp.branch,
      commitSha: exp.commit_sha,
      improved: Boolean(exp.improved),
      sharpeDelta,
      rejectionReason: exp.rejection_reason || null,
      createdAt: exp.created_at || null
    };
  } catch (err) {
    logger.warn(`Autoresearch experiment fetch failed: ${err.message}`);
    return null;
  }
}

async function fetchAutoresearchScorecard() {
  const base = resolveQuantAgiBaseUrl();
  try {
    const { data } = await axios.get(`${base}/diag/scorecard`, {
      params: { limit: 20 },
      timeout: config.QUANT_AGI_RANK_TIMEOUT_MS || 45000
    });
    if (!data?.ok) return null;
    return {
      testedExperiments: data.tested_experiments ?? 0,
      improvedExperiments: data.improved_experiments ?? 0,
      promotionRate: data.promotion_rate ?? 0,
      avgSharpeDelta: data.avg_sharpe_delta ?? 0
    };
  } catch (err) {
    logger.warn(`Autoresearch scorecard fetch failed: ${err.message}`);
    return null;
  }
}

async function getAutoresearchLatest(userId) {
  const accountRow = await ensureAccount(userId);
  const positionsRaw = await loadPositions(userId);
  const symbols = positionsRaw.map((p) => p.symbol);
  const priceMap = await fetchSymbolPrices(symbols);
  const liveMetrics = await computeMetrics(accountRow, positionsRaw, priceMap);
  await upsertDailySnapshot(userId, accountRow, liveMetrics);

  const snapshotsRaw = await loadSnapshots(userId);
  const tradeCount = await countTrades(userId);
  const metrics = computePaperBotMetrics(
    accountRow,
    snapshotsRaw,
    liveMetrics.equityUsd,
    tradeCount
  );
  const nightlyContext = await buildNightlyContext(
    userId,
    accountRow,
    snapshotsRaw,
    metrics,
    tradeCount
  );
  const resetCooldown = accountPromotionCooldown(accountRow);
  const tradedSymbols = await fetchTradedSymbols(userId);

  const [walkForward, latestExperiment, autoresearchScorecard, latestPatch] =
    await Promise.all([
      fetchWalkForwardEval(tradedSymbols),
      fetchLatestAutoresearchExperiment(),
      fetchAutoresearchScorecard(),
      fetchLatestPatchPreview()
    ]);

  const promotion = evaluatePromotionGates(metrics, { walkForward, resetCooldown });

  return {
    metrics,
    nightlyContext,
    walkForward,
    resetCooldown,
    promotion,
    latestExperiment,
    autoresearchScorecard,
    latestPatch,
    asOf: new Date().toISOString()
  };
}

async function promoteAutoresearchPatch(userId, { commitSha, experimentId } = {}) {
  const accountRow = await ensureAccount(userId);
  const resetCooldown = accountPromotionCooldown(accountRow);
  if (resetCooldown.blocked) {
    const err = new Error(
      `Account reset cooldown — wait ${resetCooldown.hoursRemaining}h before promoting patches`
    );
    err.statusCode = 403;
    err.code = 'RESET_COOLDOWN';
    throw err;
  }

  const latest = await getAutoresearchLatest(userId);
  if (!latest.promotion?.promotionReady) {
    const err = new Error('Promotion gates not satisfied — review the checklist in the strip');
    err.statusCode = 403;
    err.code = 'GATES_NOT_MET';
    throw err;
  }

  const exp = latest.latestExperiment;
  if (!exp?.improved) {
    const err = new Error('Latest experiment did not improve — nothing to promote');
    err.statusCode = 400;
    throw err;
  }

  const sha = String(commitSha || exp.commitSha || '').trim();
  if (!sha) {
    const err = new Error('No commit sha to promote');
    err.statusCode = 400;
    throw err;
  }

  const base = resolveQuantAgiBaseUrl();
  const { data } = await axios.post(
    `${base}/diag/autoresearch/promote`,
    {
      commit_sha: sha,
      experiment_id: experimentId ?? exp.id,
      promoted_by: `user:${userId}`
    },
    { timeout: config.QUANT_AGI_RANK_TIMEOUT_MS || 45000 }
  );

  if (!data?.ok) {
    const err = new Error(data?.error || 'Promote failed');
    err.statusCode = 400;
    throw err;
  }

  await db.query(
    `INSERT INTO paper_bot_events (user_id, event_type, payload)
     VALUES ($1, 'autoresearch_promoted', $2)`,
    [
      userId,
      JSON.stringify({
        sourceSha: data.source_sha || sha,
        promotedSha: data.promoted_sha,
        branch: data.branch,
        experimentId: experimentId ?? exp.id
      })
    ]
  );

  return {
    ok: true,
    sourceSha: data.source_sha || sha,
    promotedSha: data.promoted_sha,
    branch: data.branch,
    files: data.files || [],
    promotion: latest.promotion
  };
}

async function resetAccount(userId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await ensureAccount(userId);
    await client.query(`DELETE FROM paper_bot_positions WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM paper_bot_trades WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM paper_bot_daily_snapshots WHERE user_id = $1`, [userId]);
    await client.query(
      `UPDATE paper_bot_rules SET status = 'dismissed', updated_at = NOW()
       WHERE user_id = $1 AND status = 'pending'`,
      [userId]
    );
    const { rows } = await client.query(
      `UPDATE paper_bot_accounts
       SET cash_usd = starting_cash_usd,
           policy_version = 1,
           last_trade_at = NULL,
           reset_at = NOW(),
           kill_switch_armed = true,
           updated_at = NOW()
       WHERE user_id = $1
       RETURNING *`,
      [userId]
    );
    await client.query(
      `INSERT INTO paper_bot_events (user_id, event_type, payload)
       VALUES ($1, 'account_reset', $2)`,
      [userId, JSON.stringify({ startingCashUsd: Number(rows[0]?.starting_cash_usd) })]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getState(userId);
}

async function manualTrade(userId, { symbol, side, notionalUsd }) {
  const accountRow = await ensureAccount(userId);
  if (accountRow.kill_switch_armed) {
    const err = new Error('Kill switch is armed — disarm before manual paper trades');
    err.statusCode = 403;
    throw err;
  }

  const sym = String(symbol || '')
    .toUpperCase()
    .trim();
  if (!sym) {
    const err = new Error('Symbol required');
    err.statusCode = 400;
    throw err;
  }

  const priceMap = await fetchSymbolPrices([sym]);
  const price = priceMap[sym];
  if (!price) {
    const err = new Error(`No price for ${sym}`);
    err.statusCode = 400;
    throw err;
  }

  const notional = round2(Number(notionalUsd));
  if (!Number.isFinite(notional) || notional <= 0) {
    const err = new Error('notionalUsd must be positive');
    err.statusCode = 400;
    throw err;
  }

  const tradeSide = side === 'sell' ? 'sell' : 'buy';
  const qty = round2(notional / price);
  if (qty <= 0) {
    const err = new Error('Notional too small for one share');
    err.statusCode = 400;
    throw err;
  }

  await applyFill(userId, accountRow, {
    symbol: sym,
    side: tradeSide,
    quantity: qty,
    price_usd: price,
    notional_usd: round2(qty * price),
    reason_tags: ['manual', 'dev']
  });

  const refreshed = await ensureAccount(userId);
  const posAfter = await loadPositions(userId);
  const metrics = await computeMetrics(refreshed, posAfter, priceMap);
  await upsertDailySnapshot(userId, refreshed, metrics);

  return getState(userId);
}

async function interpretNote(userId, noteText) {
  await ensureAccount(userId);
  const cleaned = String(noteText || '').trim();
  if (!cleaned) {
    const err = new Error('Note text required');
    err.statusCode = 400;
    throw err;
  }

  const state = await getState(userId);
  const base = resolveQuantAgiBaseUrl();

  const { data } = await axios.post(
    `${base}/bot/interpret-note`,
    {
      note: cleaned,
      context: {
        equity_usd: state.account.equityUsd,
        cash_usd: state.account.cashUsd,
        policy_version: state.account.policyVersion,
        active_rules_count: state.activeRules?.length ?? 0
      }
    },
    { timeout: config.QUANT_AGI_RANK_TIMEOUT_MS || 45000 }
  );

  if (!data?.ok) {
    const err = new Error(data?.error || 'Grok could not interpret note');
    err.statusCode = 502;
    throw err;
  }

  await db.query(
    `INSERT INTO paper_bot_events (user_id, event_type, payload)
     VALUES ($1, 'user_note', $2)`,
    [userId, JSON.stringify({ note: cleaned.slice(0, 500), usedGrok: Boolean(data.used_grok) })]
  );

  const proposals = Array.isArray(data.proposals) ? data.proposals : [];
  for (const p of proposals) {
    const ruleText = String(p.rule_text || p.ruleText || 'Proposed rule').slice(0, 500);
    const ruleJson = {
      ...(p.payload && typeof p.payload === 'object' ? p.payload : {}),
      rule_type: p.rule_type || p.payload?.rule_type,
      rationale: p.rationale || null
    };
    await db.query(
      `INSERT INTO paper_bot_rules (user_id, source, status, rule_text, rule_json)
       VALUES ($1, 'user', 'pending', $2, $3::jsonb)`,
      [userId, ruleText, JSON.stringify(ruleJson)]
    );
  }

  return getState(userId);
}

async function approveRule(userId, ruleId) {
  const id = Number(ruleId);
  if (!Number.isFinite(id)) {
    const err = new Error('Invalid rule id');
    err.statusCode = 400;
    throw err;
  }

  const check = await db.query(
    `SELECT * FROM paper_bot_rules WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (!check.rows.length) {
    const err = new Error('Rule not found');
    err.statusCode = 404;
    throw err;
  }
  if (check.rows[0].status !== 'pending') {
    const err = new Error('Only pending rules can be approved');
    err.statusCode = 400;
    throw err;
  }

  await db.query(
    `UPDATE paper_bot_rules SET status = 'active', updated_at = NOW() WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  await db.query(
    `UPDATE paper_bot_accounts
     SET policy_version = policy_version + 1, updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );
  await db.query(
    `INSERT INTO paper_bot_events (user_id, event_type, payload)
     VALUES ($1, 'rule_applied', $2)`,
    [userId, JSON.stringify({ ruleId: id, action: 'approved' })]
  );

  return getState(userId);
}

async function dismissRule(userId, ruleId) {
  const id = Number(ruleId);
  if (!Number.isFinite(id)) {
    const err = new Error('Invalid rule id');
    err.statusCode = 400;
    throw err;
  }

  const { rowCount } = (
    await db.query(
      `UPDATE paper_bot_rules
       SET status = 'dismissed', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
      [id, userId]
    )
  ).rowCount;

  if (!rowCount) {
    const err = new Error('Pending rule not found');
    err.statusCode = 404;
    throw err;
  }

  await db.query(
    `INSERT INTO paper_bot_events (user_id, event_type, payload)
     VALUES ($1, 'rule_dismissed', $2)`,
    [userId, JSON.stringify({ ruleId: id })]
  );

  return getState(userId);
}

module.exports = {
  DISARM_CONFIRM_PHRASE,
  getState,
  getPolicySnapshot,
  getAutoresearchLatest,
  promoteAutoresearchPatch,
  resetAccount,
  dryRun,
  getRecentEvents,
  setKillSwitch,
  setTradeDeployListOnly,
  simulateDay,
  manualTrade,
  interpretNote,
  approveRule,
  dismissRule
};
