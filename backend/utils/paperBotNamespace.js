/**
 * Paper bot namespace contract (Phase 4a).
 *
 * Simulated fills must stay in paper_bot_* tables only. They must NOT:
 * - enqueue opportunity / dip emails (email_outbox)
 * - mutate deploy list (user_deploy_list_items)
 * - place broker orders (future: executionService)
 *
 * Allowed reads: deploy list (universe), user_alerts (watchlist fallback), market prices via Quant sidecar.
 */

const PAPER_BOT_NAMESPACE = 'paper_bot';
const PAPER_BOT_SHADOW_NAMESPACE = 'paper_bot_shadow';

/** Postgres tables the paper bot service may write. */
const WRITABLE_TABLES = new Set([
  'paper_bot_accounts',
  'paper_bot_positions',
  'paper_bot_trades',
  'paper_bot_daily_snapshots',
  'paper_bot_rules',
  'paper_bot_events'
]);

/** Services that must never be invoked from paper-bot fill paths. */
const FORBIDDEN_WRITE_SERVICES = [
  'emailService',
  'emailOutboxService',
  'priceMonitor',
  'executionService',
  'deployListService.add', // read-only listDeployList is OK
  'dipInsightEmailService'
];

function stampPaperBotFillReason(reasonJson) {
  const base =
    reasonJson && typeof reasonJson === 'object' && !Array.isArray(reasonJson) ? { ...reasonJson } : {};
  return {
    ...base,
    fill_namespace: PAPER_BOT_NAMESPACE,
    simulation_only: true,
    broker_sent: false
  };
}

function stampShadowOrderPayload(order, { killSwitchArmed }) {
  const base = order && typeof order === 'object' ? { ...order } : {};
  return {
    ...base,
    fill_namespace: PAPER_BOT_SHADOW_NAMESPACE,
    simulation_only: true,
    broker_sent: false,
    shadow_preview: true,
    kill_switch_armed_at_run: Boolean(killSwitchArmed)
  };
}

function assertWritableTable(tableName) {
  if (!WRITABLE_TABLES.has(tableName)) {
    throw new Error(`Paper bot namespace violation: write to ${tableName} is not allowed`);
  }
}

/**
 * Smoke helper: verify simulate-day did not trigger opportunity outbox or deploy-list mutations.
 */
async function auditNamespaceSideEffects(db, userId, { deployListCountBefore, deployListMaxUpdatedBefore }) {
  const outboxRes = await db.query(
    `SELECT COUNT(*)::int AS c FROM email_outbox
     WHERE user_id = $1 AND created_at > NOW() - INTERVAL '2 minutes'
       AND message_type ILIKE '%opportunity%'`,
    [userId]
  );
  const opportunityOutboxRecent = outboxRes.rows[0]?.c ?? 0;

  const deployRes = await db.query(
    `SELECT COUNT(*)::int AS c, MAX(updated_at) AS max_updated
     FROM user_deploy_list_items WHERE user_id = $1`,
    [userId]
  );
  const deployCount = deployRes.rows[0]?.c ?? 0;
  const deployMaxUpdated = deployRes.rows[0]?.max_updated;

  const deployUnchanged =
    deployCount === deployListCountBefore &&
    String(deployMaxUpdated || '') === String(deployListMaxUpdatedBefore || '');

  return {
    ok: opportunityOutboxRecent === 0 && deployUnchanged,
    opportunityOutboxRecent,
    deployUnchanged,
    deployCount,
    deployListCountBefore
  };
}

module.exports = {
  PAPER_BOT_NAMESPACE,
  PAPER_BOT_SHADOW_NAMESPACE,
  WRITABLE_TABLES,
  FORBIDDEN_WRITE_SERVICES,
  stampPaperBotFillReason,
  stampShadowOrderPayload,
  assertWritableTable,
  auditNamespaceSideEffects
};
