/**
 * Signed tokens for RFC 8058 one-click List-Unsubscribe (no login required).
 */
const jwt = require('jsonwebtoken');
const config = require('../config');

const PURPOSE = 'marketing_email_unsub';
const TTL_SEC = 365 * 24 * 3600;

/**
 * @param {number} userId
 * @returns {string}
 */
function createEmailUnsubscribeToken(userId) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('invalid userId for unsubscribe token');
  }
  return jwt.sign({ purpose: PURPOSE, sub: id }, config.JWT_SECRET, { expiresIn: TTL_SEC });
}

/**
 * @param {string} token
 * @returns {{ userId: number }|null}
 */
function verifyEmailUnsubscribeToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const decoded = jwt.verify(token.trim(), config.JWT_SECRET);
    if (decoded.purpose !== PURPOSE) return null;
    const userId = Number(decoded.sub);
    if (!Number.isFinite(userId) || userId <= 0) return null;
    return { userId };
  } catch {
    return null;
  }
}

/**
 * @param {number} userId
 * @returns {string}
 */
function buildOneClickUnsubscribeUrl(userId) {
  const base = String(process.env.FRONTEND_URL || 'https://keepitbased.com')
    .trim()
    .replace(/\/$/, '');
  const token = createEmailUnsubscribeToken(userId);
  return `${base}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
}

module.exports = {
  createEmailUnsubscribeToken,
  verifyEmailUnsubscribeToken,
  buildOneClickUnsubscribeUrl,
  PURPOSE
};
