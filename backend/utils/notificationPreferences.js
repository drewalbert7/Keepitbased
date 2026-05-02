/**
 * Merge stored JSONB with defaults so older rows stay valid as we add keys.
 */
function mergeNotificationPreferences(raw) {
  const p =
    raw != null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    email: p.email !== false,
    push: p.push !== false,
    opportunityToasts: p.opportunityToasts !== false
  };
}

module.exports = {
  mergeNotificationPreferences
};
