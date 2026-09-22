const crypto = require('crypto');
const db = require('../models/database');
const config = require('../config');
const { userHasMcpAccess } = require('./subscriptionEntitlement');

const KEY_PREFIX = 'kib_';

function hashKey(rawKey) {
  return crypto.createHash('sha256').update(String(rawKey), 'utf8').digest('hex');
}

function generateRawKey() {
  return `${KEY_PREFIX}live_${crypto.randomBytes(24).toString('base64url')}`;
}

function keyPrefixOf(rawKey) {
  return String(rawKey).slice(0, 12);
}

async function listKeys(userId) {
  const { rows } = await db.query(
    `SELECT id, name, key_prefix, scopes, last_used_at, revoked_at, created_at
     FROM user_mcp_api_keys
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    keyPrefix: r.key_prefix,
    scopes: r.scopes || [],
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
    createdAt: r.created_at,
    active: !r.revoked_at
  }));
}

async function createKey(userId, { name = 'Cursor agent' } = {}) {
  if (!config.ENABLE_MCP_CONNECTOR) {
    const err = new Error('MCP connector is disabled');
    err.statusCode = 503;
    err.code = 'MCP_DISABLED';
    throw err;
  }
  const allowed = await userHasMcpAccess(userId);
  if (!allowed) {
    const err = new Error('Active KeepItBased Pro subscription required to create MCP keys');
    err.statusCode = 402;
    err.code = 'PAYMENT_REQUIRED';
    throw err;
  }

  const { rows: countRows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM user_mcp_api_keys
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
  if ((countRows[0]?.n || 0) >= config.MCP_MAX_KEYS_PER_USER) {
    const err = new Error(`Maximum of ${config.MCP_MAX_KEYS_PER_USER} active MCP keys`);
    err.statusCode = 400;
    err.code = 'MCP_KEY_LIMIT';
    throw err;
  }

  const rawKey = generateRawKey();
  const { rows } = await db.query(
    `INSERT INTO user_mcp_api_keys (user_id, name, key_prefix, key_hash, scopes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, key_prefix, scopes, created_at`,
    [
      userId,
      String(name || 'Cursor agent').slice(0, 120),
      keyPrefixOf(rawKey),
      hashKey(rawKey),
      ['mcp:read', 'mcp:write']
    ]
  );
  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: row.scopes,
    createdAt: row.created_at,
    /** Shown once — store securely; cannot be retrieved again. */
    apiKey: rawKey
  };
}

async function revokeKey(userId, keyId) {
  const { rows } = await db.query(
    `UPDATE user_mcp_api_keys
     SET revoked_at = NOW()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
     RETURNING id`,
    [keyId, userId]
  );
  if (!rows[0]) {
    const err = new Error('API key not found');
    err.statusCode = 404;
    throw err;
  }
  return { id: rows[0].id, revoked: true };
}

/**
 * Authenticate MCP Bearer key. Returns { userId, keyId, scopes } or null.
 */
async function authenticateMcpKey(rawKey) {
  if (!rawKey || !String(rawKey).startsWith(KEY_PREFIX)) return null;
  const digest = hashKey(rawKey);
  const { rows } = await db.query(
    `SELECT k.id, k.user_id, k.scopes, k.revoked_at, u.subscription_status, u.email
     FROM user_mcp_api_keys k
     JOIN users u ON u.id = k.user_id
     WHERE k.key_hash = $1
     LIMIT 1`,
    [digest]
  );
  const row = rows[0];
  if (!row || row.revoked_at) return null;

  const paid =
    config.MCP_ENTITLEMENT_BYPASS ||
    ['active', 'trialing', 'comped'].includes(String(row.subscription_status || '').toLowerCase());
  if (!paid) return null;

  await db.query(`UPDATE user_mcp_api_keys SET last_used_at = NOW() WHERE id = $1`, [row.id]);

  return {
    userId: row.user_id,
    email: row.email,
    keyId: row.id,
    scopes: row.scopes || []
  };
}

function mcpPublicUrl() {
  if (config.MCP_PUBLIC_URL) return config.MCP_PUBLIC_URL.replace(/\/$/, '');
  const base = String(config.FRONTEND_URL || 'https://app.keepitbased.com').replace(/\/$/, '');
  // Served under /api so existing nginx /api/ proxy works without config changes.
  return `${base}/api/mcp`;
}

module.exports = {
  KEY_PREFIX,
  hashKey,
  listKeys,
  createKey,
  revokeKey,
  authenticateMcpKey,
  mcpPublicUrl
};
