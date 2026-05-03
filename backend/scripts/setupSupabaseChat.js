#!/usr/bin/env node
/**
 * One command: apply chat migration (if DB creds present) then verify API keys + tables.
 * From repo: `node backend/scripts/setupSupabaseChat.js`
 * From backend: `npm run setup:supabase-chat`
 */
const path = require('path');
const { spawnSync } = require('child_process');

const node = process.execPath;
const scripts = __dirname;

function run(script) {
  return spawnSync(node, [path.join(scripts, script)], { stdio: 'inherit' });
}

const m = run('applySupabaseChatMigration.js');
const v = run('verifySupabaseChat.js');
if (v.status === 0) process.exit(0);
if (m.status !== 0) process.exit(m.status ?? 1);
process.exit(v.status ?? 1);
