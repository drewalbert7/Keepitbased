const db = require('../models/database');
const logger = require('../utils/logger');

/**
 * Persist an agent chat exchange for audit/replay. Best-effort: failures are logged, not thrown to the client.
 */
async function persistAgentChatRun({
  userId,
  prompt,
  mode,
  preferences,
  reply,
  output,
  runMetadata
}) {
  const externalRunId = runMetadata?.runId || null;
  const providerUsed = runMetadata?.providerUsed ?? null;
  const fallbackUsed =
    typeof runMetadata?.fallbackUsed === 'boolean' ? runMetadata.fallbackUsed : null;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const runRes = await client.query(
      `INSERT INTO agent_runs (
        user_id, external_run_id, source, prompt, mode, preferences,
        reply, output, run_metadata, provider_used, fallback_used
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9::jsonb, $10, $11)
      RETURNING id`,
      [
        userId,
        externalRunId,
        'chat',
        prompt,
        mode || null,
        preferences ? JSON.stringify(preferences) : null,
        reply || '',
        output ? JSON.stringify(output) : null,
        runMetadata ? JSON.stringify(runMetadata) : null,
        providerUsed,
        fallbackUsed
      ]
    );

    const runId = runRes.rows[0].id;

    await client.query(
      `INSERT INTO agent_messages (run_id, seq, role, content) VALUES ($1, 1, 'user', $2)`,
      [runId, prompt]
    );
    await client.query(
      `INSERT INTO agent_messages (run_id, seq, role, content) VALUES ($1, 2, 'assistant', $2)`,
      [runId, reply || '']
    );

    await client.query('COMMIT');
    return { runId };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.warn(`Agent run persistence skipped: ${err.message}`);
    return null;
  } finally {
    client.release();
  }
}

async function listRecentAgentRuns(userId, limit = 50) {
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const result = await db.query(
    `SELECT id, external_run_id, source, prompt, mode, reply, output, run_metadata,
            provider_used, fallback_used, created_at
     FROM agent_runs
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, cap]
  );
  return result.rows;
}

/**
 * Keyset pagination on id DESC (monotonic). Optional action prefix filter (LIKE 'prefix%').
 * @returns {Promise<{ rows: Array, limit: number }>}
 */
async function listRecentAgentAudit(userId, options = {}) {
  const cap = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
  const beforeId =
    options.beforeId != null && Number.isFinite(Number(options.beforeId))
      ? parseInt(options.beforeId, 10)
      : null;
  const actionPrefix =
    typeof options.actionPrefix === 'string' && options.actionPrefix.trim().length > 0
      ? options.actionPrefix.trim().slice(0, 80)
      : null;

  const params = [userId];
  let sql = `SELECT id, action, detail, created_at
     FROM agent_audit_events
     WHERE user_id = $1`;
  let p = 2;

  if (actionPrefix) {
    sql += ` AND action LIKE $${p}`;
    params.push(`${actionPrefix}%`);
    p += 1;
  }
  if (beforeId != null && beforeId > 0) {
    sql += ` AND id < $${p}`;
    params.push(beforeId);
    p += 1;
  }

  sql += ` ORDER BY id DESC LIMIT $${p}`;
  params.push(cap);

  const result = await db.query(sql, params);
  return { rows: result.rows, limit: cap };
}

/**
 * Policy / audit trail for agent-adjacent actions (apply plan, internal API creates, quota denials).
 */
async function persistAgentAuditEvent({ userId, action, detail }) {
  if (!userId || !action) return null;
  try {
    await db.query(
      `INSERT INTO agent_audit_events (user_id, action, detail) VALUES ($1, $2, $3::jsonb)`,
      [
        userId,
        String(action).slice(0, 80),
        JSON.stringify(detail && typeof detail === 'object' ? detail : {})
      ]
    );
  } catch (err) {
    logger.warn(`Agent audit insert skipped: ${err.message}`);
  }
  return null;
}

module.exports = {
  persistAgentChatRun,
  listRecentAgentRuns,
  listRecentAgentAudit,
  persistAgentAuditEvent
};
