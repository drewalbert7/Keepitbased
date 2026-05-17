const express = require('express');
const crypto = require('crypto');
const https = require('https');
const rateLimit = require('express-rate-limit');
const db = require('../models/database');
const logger = require('../utils/logger');

const router = express.Router();

const webhookPostLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `ses-webhook:${req.ip}`,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many requests' });
  }
});

function timingSafeEqualString(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function parseSesInner(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.Type === 'Notification' && typeof body.Message === 'string') {
    try {
      return JSON.parse(body.Message);
    } catch {
      return null;
    }
  }
  if (body.notificationType) return body;
  return null;
}

function confirmSnsSubscription(subscribeUrl) {
  const u = new URL(subscribeUrl);
  const host = u.hostname.toLowerCase();
  if (!host.endsWith('.amazonaws.com') && host !== 'sns.amazonaws.com') {
    throw new Error('SubscribeURL host not allowed');
  }
  return new Promise((resolve, reject) => {
    https
      .get(subscribeUrl, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      })
      .on('error', reject);
  });
}

function collectEmailsFromSes(ses) {
  const out = new Set();
  if (!ses || typeof ses !== 'object') return [];
  const nt = String(ses.notificationType || '').toLowerCase();

  if (nt === 'bounce' && ses.bounce && Array.isArray(ses.bounce.bouncedRecipients)) {
    for (const br of ses.bounce.bouncedRecipients) {
      const e = br && br.emailAddress && String(br.emailAddress).trim().toLowerCase();
      if (e) out.add(e);
    }
  }
  if (nt === 'complaint' && ses.complaint && Array.isArray(ses.complaint.complainedRecipients)) {
    for (const cr of ses.complaint.complainedRecipients) {
      const e = cr && cr.emailAddress && String(cr.emailAddress).trim().toLowerCase();
      if (e) out.add(e);
    }
  }
  return [...out];
}

/**
 * POST /api/webhooks/ses-delivery
 * Shared-secret ingestion for SES bounce/complaint (SNS → Lambda → here, or SNS HTTPS with forwarding).
 * Header: Authorization: Bearer <SES_WEBHOOK_SECRET>
 */
router.post('/', webhookPostLimit, async (req, res) => {
  const expected = (process.env.SES_WEBHOOK_SECRET || '').trim();
  if (!expected) {
    return res.status(404).json({ error: 'Not found' });
  }

  if (req.body && req.body.Type === 'SubscriptionConfirmation' && req.body.SubscribeURL) {
    const url = String(req.body.SubscribeURL);
    try {
      await confirmSnsSubscription(url);
      logger.info('SES webhook: SNS subscription confirmed');
      return res.status(200).json({ ok: true, subscribed: true });
    } catch (e) {
      logger.warn(`SES webhook: SNS subscription confirm failed: ${e.message}`);
      return res.status(200).json({ ok: true, note: 'subscription_confirm_failed', url });
    }
  }

  const auth = req.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  const token = m ? m[1].trim() : '';
  if (!timingSafeEqualString(token, expected)) {
    logger.warn(`SES webhook auth failed ip=${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const inner = parseSesInner(req.body);
  if (!inner) {
    return res.status(400).json({ error: 'Unrecognized payload' });
  }

  const nt = String(inner.notificationType || '');
  if (nt !== 'Bounce' && nt !== 'Complaint') {
    return res.status(200).json({ ok: true, ignored: nt || 'unknown' });
  }

  const emails = collectEmailsFromSes(inner);
  if (!emails.length) {
    return res.status(200).json({ ok: true, suppressed: 0 });
  }

  const reason = nt === 'Bounce' ? 'ses:bounce' : 'ses:complaint';
  let suppressed = 0;
  for (const em of emails) {
    const r = await db.query(
      `UPDATE users
       SET email_ses_suppressed_at = COALESCE(email_ses_suppressed_at, NOW()),
           email_ses_suppress_reason = $2,
           updated_at = NOW()
       WHERE LOWER(email) = LOWER($1)
         AND email_ses_suppressed_at IS NULL
       RETURNING id`,
      [em, reason]
    );
    suppressed += r.rowCount || 0;
  }

  logger.warn(`SES webhook ${nt}: suppressed ${suppressed} user(s) for ${emails.join(', ')}`);
  return res.status(200).json({ ok: true, suppressed, emails });
});

module.exports = router;
