const axios = require('axios');
const logger = require('../utils/logger');

/**
 * When `TURNSTILE_SECRET_KEY` is set, require a valid Cloudflare Turnstile token on the body
 * (`turnstileToken` or `cf-turnstile-response`). Omitted secret skips verification (local dev).
 */
async function verifyTurnstile(req, res, next) {
  const secret = (process.env.TURNSTILE_SECRET_KEY || '').trim();
  if (!secret) return next();

  const token =
    (req.body && (req.body.turnstileToken || req.body['cf-turnstile-response'])) || '';
  if (!token || typeof token !== 'string') {
    return res.status(400).json({
      message: 'Complete the security check, then try again.'
    });
  }

  try {
    const form = new URLSearchParams();
    form.append('secret', secret);
    form.append('response', token.trim());
    const ip = (req.ip && String(req.ip).trim()) || '';
    if (ip) form.append('remoteip', ip);

    const { data } = await axios.post(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      form.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 12000
      }
    );

    if (!data || data.success !== true) {
      logger.warn('Turnstile verification failed', {
        ip: req.ip,
        errors: data && data['error-codes']
      });
      return res.status(400).json({
        message: 'Security check failed. Refresh the page and try again.'
      });
    }
    return next();
  } catch (err) {
    logger.error('Turnstile siteverify error:', err.message);
    return res.status(503).json({
      message: 'Security check is temporarily unavailable. Try again shortly.'
    });
  }
}

module.exports = { verifyTurnstile };
