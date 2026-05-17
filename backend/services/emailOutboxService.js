const db = require('../models/database');
const logger = require('../utils/logger');
const config = require('../config');

/**
 * Persistent email outbox (Phase 3) — instant send via worker or hourly digest batches.
 */

function hourBucketUtc(date = new Date()) {
  return date.toISOString().slice(0, 13);
}

function scheduledForNextUtcHour(date = new Date()) {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(d.getUTCHours() + 1);
  return d;
}

/**
 * @param {'instant' | 'hourly_digest'} deliveryMode
 * @param {number} userId
 * @param {Date} [now]
 */
function buildOpportunityOutboxSchedule(deliveryMode, userId, now = new Date()) {
  if (deliveryMode === 'hourly_digest') {
    const bucket = hourBucketUtc(now);
    return {
      batchKey: `opp-digest:${userId}:${bucket}`,
      scheduledFor: scheduledForNextUtcHour(now)
    };
  }
  return { batchKey: null, scheduledFor: now };
}

/**
 * @param {object} input
 * @param {number} input.userId
 * @param {string} input.toEmail
 * @param {string} input.messageType
 * @param {object} input.payload
 * @param {string|null} [input.batchKey]
 * @param {Date} [input.scheduledFor]
 */
async function enqueueEmail(input) {
  const {
    userId,
    toEmail,
    messageType,
    payload,
    batchKey = null,
    scheduledFor = new Date()
  } = input;

  if (!config.ENABLE_EMAIL_OUTBOX) {
    return { enqueued: false, reason: 'outbox_disabled' };
  }

  const sym = payload?.deliverCtx?.symbol || payload?.opportunity?.symbol;
  if (batchKey && sym) {
    const existing = await db.query(
      `SELECT id FROM email_outbox
       WHERE user_id = $1 AND batch_key = $2 AND status = 'pending'
         AND payload->'deliverCtx'->>'symbol' = $3
       LIMIT 1`,
      [userId, batchKey, String(sym).toUpperCase()]
    );
    if (existing.rows[0]?.id) {
      await db.query(
        `UPDATE email_outbox
         SET payload = $1::jsonb, scheduled_for = $2, updated_at = NOW()
         WHERE id = $3`,
        [JSON.stringify(payload), scheduledFor, existing.rows[0].id]
      );
      return { enqueued: true, id: existing.rows[0].id, updated: true };
    }
  }

  const ins = await db.query(
    `INSERT INTO email_outbox (
       user_id, to_email, message_type, payload, batch_key, status, scheduled_for
     ) VALUES ($1, $2, $3, $4::jsonb, $5, 'pending', $6)
     RETURNING id`,
    [userId, toEmail, messageType, JSON.stringify(payload), batchKey, scheduledFor]
  );
  return { enqueued: true, id: ins.rows[0].id, updated: false };
}

/**
 * @param {number} limit
 */
async function claimInstantPending(limit = 20) {
  const cap = Math.min(Math.max(1, limit), 50);
  const r = await db.query(
    `UPDATE email_outbox
     SET status = 'processing', attempts = attempts + 1, updated_at = NOW()
     WHERE id IN (
       SELECT id FROM email_outbox
       WHERE status = 'pending'
         AND batch_key IS NULL
         AND scheduled_for <= NOW()
       ORDER BY scheduled_for ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [cap]
  );
  return r.rows;
}

/**
 * @param {number} limit
 * @returns {Promise<string[]>}
 */
async function listDueDigestBatchKeys(limit = 10) {
  const cap = Math.min(Math.max(1, limit), 20);
  const r = await db.query(
    `SELECT DISTINCT batch_key FROM email_outbox
     WHERE status = 'pending'
       AND batch_key IS NOT NULL
       AND scheduled_for <= NOW()
     ORDER BY batch_key ASC
     LIMIT $1`,
    [cap]
  );
  return r.rows.map((row) => row.batch_key).filter(Boolean);
}

async function claimPendingByBatchKey(batchKey) {
  const r = await db.query(
    `UPDATE email_outbox
     SET status = 'processing', attempts = attempts + 1, updated_at = NOW()
     WHERE id IN (
       SELECT id FROM email_outbox
       WHERE status = 'pending' AND batch_key = $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [batchKey]
  );
  return r.rows;
}

async function markOutboxSent(ids) {
  if (!ids.length) return;
  await db.query(
    `UPDATE email_outbox
     SET status = 'sent', sent_at = NOW(), updated_at = NOW(), last_error = NULL
     WHERE id = ANY($1::int[])`,
    [ids.map((id) => Number(id))]
  );
}

async function markOutboxFailed(id, errorMessage) {
  const maxAttempts = config.EMAIL_OUTBOX_MAX_ATTEMPTS;
  await db.query(
    `UPDATE email_outbox
     SET status = CASE WHEN attempts >= $2 THEN 'failed' ELSE 'pending' END,
         last_error = $3,
         updated_at = NOW()
     WHERE id = $1`,
    [id, maxAttempts, String(errorMessage || 'unknown').slice(0, 2000)]
  );
}

module.exports = {
  hourBucketUtc,
  scheduledForNextUtcHour,
  buildOpportunityOutboxSchedule,
  enqueueEmail,
  claimInstantPending,
  listDueDigestBatchKeys,
  claimPendingByBatchKey,
  markOutboxSent,
  markOutboxFailed
};
