const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

let adminClient = null;

function isChatConfigured() {
  return Boolean(config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY);
}

function getAdminClient() {
  if (!isChatConfigured()) {
    return null;
  }
  if (!adminClient) {
    adminClient = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return adminClient;
}

module.exports = {
  isChatConfigured,
  getAdminClient
};
