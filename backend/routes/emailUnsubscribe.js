const express = require('express');
const rateLimit = require('express-rate-limit');
const { verifyEmailUnsubscribeToken } = require('../utils/emailUnsubscribeToken');
const { applyMarketingEmailUnsubscribe } = require('../services/marketingEmailUnsubscribe');
const logger = require('../utils/logger');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' }
});

function unsubHtml(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 2rem; }
    main { max-width: 28rem; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 1.5rem 1.75rem; }
    h1 { font-size: 1.25rem; margin: 0 0 0.75rem; color: #f8fafc; }
    p { line-height: 1.55; color: #94a3b8; margin: 0 0 1rem; font-size: 0.95rem; }
    a { color: #2dd4bf; }
  </style>
</head>
<body><main><h1>${title}</h1>${body}</main></body>
</html>`;
}

function appOrigin() {
  return String(process.env.FRONTEND_URL || 'https://keepitbased.com').trim().replace(/\/$/, '');
}

function isOneClickBody(req) {
  const b = req.body || {};
  if (b['List-Unsubscribe'] === 'One-Click') return true;
  if (String(req.get('List-Unsubscribe') || '') === 'One-Click') return true;
  return false;
}

async function handleUnsubscribe(req, res) {
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  const verified = verifyEmailUnsubscribeToken(token);
  if (!verified) {
    if (req.method === 'GET') {
      return res
        .status(400)
        .send(
          unsubHtml(
            'Link expired or invalid',
            '<p>This unsubscribe link is invalid or has expired. Sign in and open <strong>Profile → Notifications</strong> to manage email.</p>'
          )
        );
    }
    return res.status(400).json({ error: 'invalid_token' });
  }

  if (req.method === 'POST' && !isOneClickBody(req)) {
    logger.warn(`email unsubscribe POST without One-Click user=${verified.userId}`);
    return res.status(400).json({ error: 'expected List-Unsubscribe=One-Click' });
  }

  const result = await applyMarketingEmailUnsubscribe(verified.userId);
  if (!result.ok) {
    if (req.method === 'GET') {
      return res.status(404).send(unsubHtml('Account not found', '<p>We could not find this account.</p>'));
    }
    return res.status(404).json({ error: 'user_not_found' });
  }

  if (req.method === 'GET') {
    return res.send(
      unsubHtml(
        'You are unsubscribed',
        `<p>Watchlist dip alerts and Grok briefings are turned off for <strong>${result.email}</strong>.</p>
         <p>Account emails (password reset, username recovery) may still be sent when you request them.</p>
         <p><a href="${appOrigin()}/profile">Notification settings</a></p>`
      )
    );
  }

  return res.status(200).json({ ok: true });
}

/** RFC 8058 one-click (POST) + browser confirmation (GET). */
router.get('/', limiter, handleUnsubscribe);
router.post('/', limiter, express.urlencoded({ extended: false }), handleUnsubscribe);

module.exports = router;
