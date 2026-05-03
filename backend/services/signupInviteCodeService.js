const bcrypt = require('bcryptjs');
const db = require('../models/database');
const logger = require('../utils/logger');
const config = require('../config');

const KEY = 'signup_invite_hash';
const SALT_ROUNDS = 12;

async function getStoredHashRow() {
  const r = await db.query(
    'SELECT value, updated_at FROM app_settings WHERE key = $1',
    [KEY]
  );
  return r.rows[0] || null;
}

async function inviteCodeConfigured() {
  const row = await getStoredHashRow();
  return Boolean(row?.value);
}

async function verifyInviteCode(plain) {
  if (typeof plain !== 'string') return false;
  const trimmed = plain.trim();
  if (!trimmed) return false;
  const row = await getStoredHashRow();
  if (!row?.value) return false;
  return bcrypt.compare(trimmed, row.value);
}

async function setInviteCodePlain(plain) {
  const trimmed = typeof plain === 'string' ? plain.trim() : '';
  const hash = await bcrypt.hash(trimmed, SALT_ROUNDS);
  await db.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [KEY, hash]
  );
}

/**
 * Bootstrap first deploy from INVITE_SIGNUP_CODE env (plaintext once). Remove secret from env after using admin UI.
 * @returns {Promise<boolean>} true if seed inserted
 */
async function seedFromEnvIfUnset() {
  const seed = typeof config.INVITE_SIGNUP_CODE === 'string' ? config.INVITE_SIGNUP_CODE.trim() : '';
  if (!seed) return false;
  const hash = await bcrypt.hash(seed, SALT_ROUNDS);
  const inserted = await db.query(
    `INSERT INTO app_settings (key, value, updated_at)
     SELECT $1, $2, NOW()
     WHERE NOT EXISTS (
       SELECT 1 FROM app_settings WHERE key = $1
     )`,
    [KEY, hash]
  );
  if (inserted.rowCount !== 1) return false;
  logger.info(
    '[signup-invite] Seeded INVITE_SIGNUP_CODE into app_settings — remove plaintext from env in production.'
  );
  return true;
}

async function statusForAdmin() {
  const row = await getStoredHashRow();
  return {
    configured: Boolean(row?.value),
    updatedAt: row?.updated_at ? row.updated_at.toISOString?.() ?? String(row.updated_at) : null
  };
}

module.exports = {
  KEY,
  verifyInviteCode,
  setInviteCodePlain,
  inviteCodeConfigured,
  seedFromEnvIfUnset,
  statusForAdmin
};
