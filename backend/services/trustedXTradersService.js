const db = require('../models/database');
const logger = require('../utils/logger');

const MAX_TRUSTED = (() => {
  const n = parseInt(process.env.PAPER_BOT_MAX_TRUSTED_X_TRADERS, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 20) : 12;
})();

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

function normalizeHandle(raw) {
  return String(raw || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
}

function mapRow(row) {
  return {
    id: row.id,
    xUserId: row.x_user_id,
    username: row.username,
    label: row.label || row.username,
    createdAt: row.created_at
  };
}

async function listTrustedTraders(userId) {
  const { rows } = await db.query(
    `SELECT id, x_user_id, username, label, created_at
     FROM paper_bot_trusted_x_traders
     WHERE user_id = $1
     ORDER BY created_at ASC`,
    [userId]
  );
  return rows.map(mapRow);
}

async function addTrustedTrader(userId, { username, label } = {}) {
  const existing = await listTrustedTraders(userId);
  if (existing.length >= MAX_TRUSTED) {
    const err = new Error(`Maximum ${MAX_TRUSTED} trusted traders — remove one first`);
    err.statusCode = 400;
    throw err;
  }

  const handle = normalizeHandle(username);
  if (!HANDLE_RE.test(handle)) {
    const err = new Error('Invalid X handle — use 1–15 letters, numbers, or underscores');
    err.statusCode = 400;
    throw err;
  }
  if (existing.some((r) => r.username === handle)) {
    const err = new Error(`@${handle} is already in your trusted list`);
    err.statusCode = 409;
    throw err;
  }

  const displayLabel = String(label || handle).trim().slice(0, 64) || handle;

  const { rows } = await db.query(
    `INSERT INTO paper_bot_trusted_x_traders (user_id, x_user_id, username, label)
     VALUES ($1, NULL, $2, $3)
     RETURNING id, x_user_id, username, label, created_at`,
    [userId, handle, displayLabel]
  );
  return mapRow(rows[0]);
}

async function removeTrustedTrader(userId, traderId) {
  const id = Number(traderId);
  if (!Number.isFinite(id)) {
    const err = new Error('Invalid trader id');
    err.statusCode = 400;
    throw err;
  }
  const result = await db.query(
    `DELETE FROM paper_bot_trusted_x_traders WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId]
  );
  if (!result.rowCount) {
    const err = new Error('Trusted trader not found');
    err.statusCode = 404;
    throw err;
  }
  return { ok: true, id };
}

async function accountsForPulse(userId) {
  const rows = await listTrustedTraders(userId);
  return rows.map((r) => ({
    id: r.username,
    username: r.username,
    label: r.label,
    source: 'user'
  }));
}

module.exports = {
  MAX_TRUSTED,
  listTrustedTraders,
  addTrustedTrader,
  removeTrustedTrader,
  accountsForPulse,
  normalizeHandle
};
