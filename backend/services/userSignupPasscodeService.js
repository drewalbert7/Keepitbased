const bcrypt = require('bcryptjs');
const db = require('../models/database');

const SALT_ROUNDS = 12;

async function anyUserHasSignupPasscode() {
  const r = await db.query(
    'SELECT 1 AS ok FROM users WHERE signup_passcode_hash IS NOT NULL LIMIT 1'
  );
  return r.rows.length > 0;
}

/**
 * Match plaintext against any user's personal signup passcode (bcrypt).
 * @returns {{ ok: true, inviterUserId: number } | { ok: false }}
 */
async function verifyUserPasscode(plain) {
  if (typeof plain !== 'string') return { ok: false };
  const trimmed = plain.trim();
  if (!trimmed) return { ok: false };
  const rows = await db.query(
    'SELECT id, signup_passcode_hash FROM users WHERE signup_passcode_hash IS NOT NULL'
  );
  for (const row of rows.rows) {
    if (!row.signup_passcode_hash) continue;
    try {
      const match = await bcrypt.compare(trimmed, row.signup_passcode_hash);
      if (match) {
        return { ok: true, inviterUserId: row.id };
      }
    } catch {
      /* ignore */
    }
  }
  return { ok: false };
}

async function setPasscodeForUser(userId, plain) {
  const trimmed = typeof plain === 'string' ? plain.trim() : '';
  if (trimmed.length < 8 || trimmed.length > 128) {
    throw new Error('Passcode must be 8–128 characters');
  }
  const hash = await bcrypt.hash(trimmed, SALT_ROUNDS);
  await db.query(
    'UPDATE users SET signup_passcode_hash = $1, updated_at = NOW() WHERE id = $2',
    [hash, userId]
  );
  return trimmed;
}

async function clearPasscodeForUser(userId) {
  await db.query(
    'UPDATE users SET signup_passcode_hash = NULL, updated_at = NOW() WHERE id = $1',
    [userId]
  );
}

async function hasPasscodeForUser(userId) {
  const r = await db.query(
    'SELECT signup_passcode_hash IS NOT NULL AS active FROM users WHERE id = $1',
    [userId]
  );
  return Boolean(r.rows[0]?.active);
}

module.exports = {
  anyUserHasSignupPasscode,
  verifyUserPasscode,
  setPasscodeForUser,
  clearPasscodeForUser,
  hasPasscodeForUser
};
