#!/usr/bin/env node
/**
 * Quick check: SUPABASE_* in .env + optional query to chat_messages.
 * Run from repo: `node backend/scripts/verifySupabaseChat.js`
 * (or `cd backend && node scripts/verifySupabaseChat.js`)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const url = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const keyLooksJwt = /^eyJ/.test(key);
const keyLooksSecret = /^sb_secret_/.test(key);

function ok(msg) {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`);
}
function bad(msg) {
  console.log(`\x1b[31m✗\x1b[0m ${msg}`);
}

let exit = 0;
if (!url) {
  bad('SUPABASE_URL is missing in backend/.env');
  exit = 1;
} else {
  ok('SUPABASE_URL is set');
  if (!/^https:\/\//i.test(url)) {
    bad('SUPABASE_URL should start with https://');
    exit = 1;
  } else if (!/\.supabase\.co$/i.test(url)) {
    console.log('  (If you use a custom domain, ensure the URL matches exactly what Supabase shows under Settings → API.)');
  } else ok('SUPABASE_URL host looks like a standard *.supabase.co project');
}

if (!key) {
  bad('SUPABASE_SERVICE_ROLE_KEY is missing in backend/.env');
  exit = 1;
} else ok('SUPABASE_SERVICE_ROLE_KEY is set');
if (key && !keyLooksJwt && !keyLooksSecret) {
  bad(
    'SUPABASE_SERVICE_ROLE_KEY should be the server secret (legacy JWT `eyJ...` or new `sb_secret_...`) — not the anon/publishable key'
  );
  exit = 1;
} else if (key) ok(keyLooksJwt ? 'SUPABASE_SERVICE_ROLE_KEY looks like a JWT' : 'SUPABASE_SERVICE_ROLE_KEY looks like a new-format secret');

if (exit !== 0) {
  console.log('\nFix backend/.env, then run this script again.');
  process.exit(1);
}

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.from('chat_messages').select('id').limit(1);
  if (error) {
    bad(`Supabase query failed: ${error.message}`);
    const missingTable =
      error.code === '42P01' ||
      /relation|does not exist|schema cache/i.test(error.message || '');
    if (missingTable) {
      console.log('  → Tables missing. Easiest: Supabase → SQL Editor → paste supabase/migrations/20260203120000_global_chat.sql → Run.');
      console.log('  → Or set SUPABASE_DB_PASSWORD in backend/.env (Database password from same screen) and run: cd backend && npm run setup:supabase-chat');
    }
    if (error.message.includes('Invalid API key') || error.status === 401 || error.status === 403) {
      console.log('  → Wrong SUPABASE_SERVICE_ROLE_KEY or URL; copy again from Dashboard → Settings → API.');
    }
    process.exit(1);
  }
  ok(`Connected. chat_messages readable (${Array.isArray(data) ? data.length : 0} row sample).`);
  console.log('\nBackend chat env looks good. Also set frontend REACT_APP_SUPABASE_URL + REACT_APP_SUPABASE_ANON_KEY, run SQL migration, enable Realtime on the two tables, restart API + npm start.');
})().catch((e) => {
  bad(e.message || String(e));
  process.exit(1);
});
