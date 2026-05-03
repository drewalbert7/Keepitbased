#!/usr/bin/env node
/**
 * Applies `supabase/migrations/20260203120000_global_chat.sql` to your Supabase Postgres.
 *
 * Connection (first match wins):
 *   1. SUPABASE_DB_URL — full URI from Dashboard → Database (Session / Direct / URI).
 *   2. SUPABASE_URL + SUPABASE_DB_PASSWORD — builds direct host `db.<ref>.supabase.co:5432`
 *      (password: same as “Database password” in project settings; reset there if unknown).
 *
 * If neither is set, prints help and (when possible) copies the migration SQL to your clipboard
 * so you can paste it into Supabase → SQL Editor → Run.
 *
 * Run from repo root: `node backend/scripts/applySupabaseChatMigration.js`
 * Or: `cd backend && npm run migrate:supabase-chat`
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const migrationPath = path.join(__dirname, '../../supabase/migrations/20260203120000_global_chat.sql');

function projectRefFromSupabaseUrl(supabaseUrl) {
  try {
    const hostname = new URL(supabaseUrl.trim()).hostname.toLowerCase();
    const m = hostname.match(/^([a-z0-9]+)\.supabase\.co$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function resolveDbUrl() {
  const explicit = (process.env.SUPABASE_DB_URL || '').trim();
  if (explicit) return explicit;

  const base = (process.env.SUPABASE_URL || '').trim();
  const password = (process.env.SUPABASE_DB_PASSWORD || '').trim();
  if (!base || !password) return null;

  const ref = projectRefFromSupabaseUrl(base);
  if (!ref) {
    console.error(
      'SUPABASE_URL must look like https://YOUR_PROJECT_REF.supabase.co to auto-build the DB URL.'
    );
    process.exit(1);
  }

  const enc = encodeURIComponent(password);
  return `postgresql://postgres:${enc}@db.${ref}.supabase.co:5432/postgres?sslmode=require`;
}

function copyToClipboard(text) {
  if (process.platform === 'darwin') {
    const r = spawnSync('pbcopy', [], { input: text, encoding: 'utf8' });
    return r.status === 0 && !r.error;
  }
  if (process.platform === 'linux') {
    const wl = spawnSync('wl-copy', [], { input: text, encoding: 'utf8' });
    if (wl.status === 0 && !wl.error) return true;
    const xc = spawnSync('xclip', ['-selection', 'clipboard'], { input: text, encoding: 'utf8' });
    return xc.status === 0 && !xc.error;
  }
  if (process.platform === 'win32') {
    const r = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', 'Set-Clipboard -Value ([Console]::In.ReadToEnd())'],
      { input: text, encoding: 'utf8' }
    );
    return r.status === 0 && !r.error;
  }
  return false;
}

if (!fs.existsSync(migrationPath)) {
  console.error('Migration file not found:', migrationPath);
  process.exit(1);
}

const dbUrl = resolveDbUrl();

if (!dbUrl) {
  console.error(
    [
      'No database connection configured for migrations.',
      '',
      'Pick one:',
      '',
      '  A) Supabase Dashboard → SQL Editor → paste file:',
      `       ${migrationPath}`,
      '     → Run once.',
      '',
      '  B) Add to backend/.env the database password (Settings → Database → Database password):',
      '       SUPABASE_DB_PASSWORD=your_password',
      '     (SUPABASE_URL must already be set.) Then run:',
      '       cd backend && npm run migrate:supabase-chat',
      '',
      '  C) Paste the full “Connection string” URI as:',
      '       SUPABASE_DB_URL=postgresql://...',
      '     Then run the same npm command.',
      '',
      'If psql fails with IPv6 / network errors, use option A or set SUPABASE_DB_URL to the Session pooler URI from the dashboard.',
    ].join('\n')
  );
  try {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    if (copyToClipboard(sql)) {
      console.log(
        '\n\x1b[32m✓\x1b[0m Migration SQL copied to clipboard. Open Supabase → SQL Editor → New query → Paste (Ctrl+V) → Run.'
      );
    } else {
      console.log(
        '\n(Clipboard unavailable in this environment — open the file above in an editor, copy all, then paste into Supabase SQL Editor.)'
      );
    }
  } catch {
    /* ignore */
  }
  process.exit(1);
}

const r = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', migrationPath], {
  stdio: 'inherit',
  encoding: 'utf8',
});

if (r.error) {
  console.error(r.error.message);
  process.exit(1);
}
if (r.status !== 0) {
  console.error(
    '\nIf the error mentions IPv6, DNS, or timeout: use the SQL Editor (option A) or SUPABASE_DB_URL with the Session pooler from Supabase → Database.'
  );
  process.exit(r.status ?? 1);
}

console.log('\nMigration applied. Run: node backend/scripts/verifySupabaseChat.js');
