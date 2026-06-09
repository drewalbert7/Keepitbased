const db = require('../models/database');
const logger = require('../utils/logger');

const DEFAULT_STARTING_CASH = 10000;
const DISARM_CONFIRM_PHRASE = 'ENABLE PAPER TRADES';

function mapAccount(row) {
  const starting = Number(row.starting_cash_usd);
  const cash = Number(row.cash_usd);
  const equity = cash; // positions mark-to-market in Phase 1
  return {
    userId: row.user_id,
    startingCashUsd: starting,
    cashUsd: cash,
    equityUsd: equity,
    dayPnlUsd: 0,
    cumPnlUsd: Number((equity - starting).toFixed(2)),
    openRiskPct: 0,
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

async function getState(userId) {
  const row = await ensureAccount(userId);
  const account = mapAccount(row);
  return {
    account,
    positions: [],
    recentTrades: [],
    pendingRules: [],
    snapshots: [],
    whyNoTradesToday: account.killSwitchArmed
      ? 'Kill switch is armed — paper trades are paused until you explicitly enable them.'
      : 'No automated run-day yet — simulator and policy engine ship in Phase 1.',
    autoresearch: null,
    disclaimer:
      'Educational paper simulation only — not investment advice. No brokerage orders are placed.',
    phase: '0-shell'
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
  return mapAccount(rows[0]);
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
  return mapAccount(rows[0]);
}

module.exports = {
  DISARM_CONFIRM_PHRASE,
  getState,
  setKillSwitch,
  setTradeDeployListOnly
};
