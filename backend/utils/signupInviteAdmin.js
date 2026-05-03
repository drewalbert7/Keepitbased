const config = require('../config');

function parseAdminSignupEmails() {
  const raw = config.ADMIN_SIGNUP_EMAILS || '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isSignupInviteAdmin(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  const allowed = parseAdminSignupEmails();
  return allowed.includes(e);
}

module.exports = {
  parseAdminSignupEmails,
  isSignupInviteAdmin
};
