const db = require('../models/database');
const config = require('../config');
const logger = require('../utils/logger');

function parseAdminSignupEmails() {
  const raw = config.ADMIN_SIGNUP_EMAILS || '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Env-only check (bootstrap / legacy). Prefer {@link isSignupInviteAdminFromRow}. */
function isSignupInviteAdmin(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  return parseAdminSignupEmails().includes(e);
}

function isSignupInviteAdminFromRow(userRow) {
  if (!userRow) return false;
  if (userRow.is_signup_admin === true) return true;
  return isSignupInviteAdmin(userRow.email);
}

async function userIsSignupAdmin(userId) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id < 1) return false;
  const result = await db.query(
    `SELECT lower(trim(email)) AS email, COALESCE(is_signup_admin, false) AS is_signup_admin
     FROM users WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) return false;
  const row = result.rows[0];
  if (row.is_signup_admin) return true;
  return parseAdminSignupEmails().includes(row.email);
}

async function countSignupAdmins() {
  const result = await db.query(
    `SELECT COUNT(*)::int AS n FROM users WHERE COALESCE(is_signup_admin, false) = true`
  );
  return Number(result.rows[0]?.n) || 0;
}

async function anySignupAdminConfigured() {
  if (parseAdminSignupEmails().length > 0) return true;
  return (await countSignupAdmins()) > 0;
}

/**
 * Promote emails listed in ADMIN_SIGNUP_EMAILS (idempotent).
 */
async function seedAdminsFromEnv() {
  const emails = parseAdminSignupEmails();
  if (emails.length === 0) return 0;
  let updated = 0;
  for (const email of emails) {
    const r = await db.query(
      `UPDATE users
       SET is_signup_admin = true, updated_at = NOW()
       WHERE lower(trim(email)) = $1 AND COALESCE(is_signup_admin, false) = false`,
      [email]
    );
    updated += r.rowCount || 0;
  }
  if (updated > 0) {
    logger.info(`[signup-admin] Promoted ${updated} user(s) from ADMIN_SIGNUP_EMAILS`);
  }
  return updated;
}

/**
 * @param {number} targetUserId
 * @param {boolean} admin
 * @param {number} actorUserId — cannot demote self if last admin
 */
async function setSignupAdminForUser(targetUserId, admin, actorUserId) {
  const targetId = Number(targetUserId);
  const actorId = Number(actorUserId);
  if (!Number.isFinite(targetId) || targetId < 1) {
    throw new Error('Invalid user id');
  }

  const targetRow = await db.query(
    `SELECT id, email, COALESCE(is_signup_admin, false) AS is_signup_admin FROM users WHERE id = $1`,
    [targetId]
  );
  if (targetRow.rows.length === 0) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }

  const wantAdmin = Boolean(admin);
  const currentlyAdmin = Boolean(targetRow.rows[0].is_signup_admin);

  if (!wantAdmin && currentlyAdmin) {
    const adminCount = await countSignupAdmins();
    if (adminCount <= 1) {
      const err = new Error('Cannot remove the last signup administrator.');
      err.statusCode = 400;
      throw err;
    }
    if (targetId === actorId) {
      const err = new Error('You cannot remove your own admin access while you are the last administrator.');
      err.statusCode = 400;
      throw err;
    }
  }

  await db.query(
    `UPDATE users SET is_signup_admin = $1, updated_at = NOW() WHERE id = $2`,
    [wantAdmin, targetId]
  );

  return {
    userId: targetId,
    email: targetRow.rows[0].email,
    isSignupInviteAdmin: wantAdmin
  };
}

module.exports = {
  parseAdminSignupEmails,
  isSignupInviteAdmin,
  isSignupInviteAdminFromRow,
  userIsSignupAdmin,
  countSignupAdmins,
  anySignupAdminConfigured,
  seedAdminsFromEnv,
  setSignupAdminForUser
};
