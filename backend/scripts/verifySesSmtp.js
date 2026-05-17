#!/usr/bin/env node
/**
 * Verifies AWS SES SMTP credentials (AUTH only — no message sent).
 *
 *   node backend/scripts/verifySesSmtp.js
 *   npm run email:verify-smtp   # from repo root
 */

require('../config');
const nodemailer = require('nodemailer');

async function main() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587, 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;

  if (!host || !user || !pass) {
    console.error('Missing SMTP_HOST, SMTP_USER, or SMTP_PASS in backend/.env');
    process.exit(1);
  }

  console.log(`Host: ${host}:${port}`);
  console.log(`User: ${user.slice(0, 4)}…`);
  console.log(`From: ${from || '(SMTP_FROM unset — set noreply@verified-domain)'}`);

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });

  try {
    await transporter.verify();
    console.log('OK — SMTP login accepted by AWS SES.');
    console.log(
      'Next: npm run email:test-opportunity with DISABLE_EMAIL_ENGAGEMENT_SUNSET=true if testing an inactive user.'
    );
    process.exit(0);
  } catch (err) {
    console.error('FAIL —', err.message || err);
    if (String(err.message || '').includes('535')) {
      console.error(
        '535 usually means wrong SMTP password, rotated credentials, or IAM access key used instead of SES SMTP credentials.'
      );
      console.error(
        'AWS: SES → Account dashboard → SMTP settings → Create SMTP credentials (region must match SMTP_HOST).'
      );
    }
    process.exit(1);
  }
}

main();
