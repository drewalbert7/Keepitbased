const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Canonical public app origin for outbound links (matches verified SES sending domain).
 * Set `FRONTEND_URL=https://your.domain` in production so links are not localhost.
 */
function appBaseUrl() {
  const raw = (process.env.FRONTEND_URL || 'https://keepitbased.com').trim().replace(/\/$/, '');
  try {
    const u = new URL(raw);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
  } catch (_) {
    /* ignore */
  }
  return 'https://keepitbased.com';
}

function profilePreferencesUrl() {
  return `${appBaseUrl()}/profile`;
}

/**
 * RFC 2369 List-Unsubscribe — mailbox providers (and AWS SES guidance) expect a clear prefs URL.
 * One-click POST is not implemented; HTTPS profile only.
 */
function listUnsubscribeHeaders() {
  try {
    const u = new URL(profilePreferencesUrl());
    if (u.protocol === 'https:') {
      return { 'List-Unsubscribe': `<${profilePreferencesUrl()}>` };
    }
  } catch (_) {
    /* dev http */
  }
  return {};
}

function mergeMailHeaders(extra = {}) {
  return { ...listUnsubscribeHeaders(), ...extra };
}

/** Repeated in HTML footers — explicit consent language for SES / ISP trust. */
function complianceOptInSentence() {
  return 'You opted in to this email inside your KeepItBased account settings when you enabled this notification.';
}

/**
 * Visible From address. For AWS SES, `SMTP_USER` is often the SMTP IAM-style username (AKIA…),
 * not an email — set `SMTP_FROM=noreply@yourdomain.com` on your verified domain.
 */
function smtpFromHeader() {
  const addr = process.env.SMTP_FROM || process.env.SMTP_USER;
  return `"KeepItBased" <${addr}>`;
}

/** Only allow X/Twitter URLs in outbound emails. */
function sanitizeXPostUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host !== 'x.com' && host !== 'twitter.com') return null;
    return u.href;
  } catch {
    return null;
  }
}

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  async sendAlert(email, alertData) {
    try {
      const levelColors = {
        small: '#fbbf24',
        medium: '#f97316', 
        large: '#dc2626'
      };

      const levelEmojis = {
        small: '🟡',
        medium: '🟠',
        large: '🔴'
      };

      const color = levelColors[alertData.level];
      const emoji = levelEmojis[alertData.level];

      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">KeepItBased Alert ${emoji}</h1>
          </div>
          
          <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <div style="background: ${color}; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="margin: 0 0 10px 0; font-size: 24px;">
                ${alertData.level.toUpperCase()} BUY SIGNAL
              </h2>
              <p style="margin: 0; font-size: 18px; font-weight: 600;">
                ${alertData.assetType.toUpperCase()} ${alertData.symbol}
              </p>
            </div>
            
            <div style="margin: 20px 0;">
              <p style="font-size: 18px; margin: 10px 0;">
                <strong>Current Price:</strong> $${alertData.currentPrice.toFixed(2)}
              </p>
              <p style="font-size: 18px; margin: 10px 0;">
                <strong>Drop:</strong> ${alertData.dropPercentage}%
              </p>
              <p style="font-size: 18px; margin: 10px 0;">
                <strong>Baseline Price:</strong> $${alertData.baselinePrice.toFixed(2)}
              </p>
            </div>
            
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid ${color};">
              <p style="margin: 0; font-size: 16px; color: #555;">
                ${alertData.message}
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 30px;">
              <a href="${appBaseUrl()}" 
                 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                        color: white; padding: 15px 30px; text-decoration: none; 
                        border-radius: 8px; font-weight: 600; display: inline-block;">
                View in App
              </a>
            </div>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #777; font-size: 14px;">
              <p style="margin: 0 0 10px; font-size: 13px; color: #555;">${complianceOptInSentence()}</p>
              <p>This KeepItBased price alert was sent at ${new Date(alertData.timestamp).toLocaleString()}.</p>
              <p><a href="${profilePreferencesUrl()}" style="color: #667eea;">Manage email alerts &amp; unsubscribe</a></p>
            </div>
          </div>
        </div>
      `;

      const textPlain = [
        `KeepItBased — ${String(alertData.level).toUpperCase()} alert: ${alertData.symbol}`,
        `${alertData.assetType} ${alertData.symbol} dropped ${alertData.dropPercentage}% vs baseline.`,
        `${complianceOptInSentence()}`,
        `Manage or turn off emails: ${profilePreferencesUrl()}`
      ].join('\n\n');

      const mailOptions = {
        from: smtpFromHeader(),
        to: email,
        subject: `KeepItBased — ${emoji} ${alertData.level.toUpperCase()} alert: ${alertData.symbol} (${alertData.dropPercentage}% drop)`,
        text: textPlain,
        html: html,
        headers: mergeMailHeaders()
      };

      await this.transporter.sendMail(mailOptions);
      logger.info(`Alert email sent to ${email} for ${alertData.symbol}`);
    } catch (error) {
      logger.error('Error sending alert email:', error);
    }
  }

  async sendWelcome(email, displayName) {
    const greet = displayName && String(displayName).trim() ? String(displayName).trim() : 'there';
    try {
      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to KeepItBased! 🚀</h1>
          </div>
          
          <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h2 style="color: #333; margin-bottom: 20px;">Hi ${greet}!</h2>
            
            <p style="font-size: 16px; line-height: 1.6; color: #555;">
              Thanks for joining KeepItBased! You're now ready to never miss another buying opportunity in crypto and stocks.
            </p>
            
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #333;">Get Started:</h3>
              <ul style="margin: 0; padding-left: 20px; color: #555;">
                <li style="margin: 8px 0;">Set up alerts for your favorite crypto and stocks</li>
                <li style="margin: 8px 0;">Customize your thresholds (Small: 5%, Medium: 10%, Large: 15%)</li>
                <li style="margin: 8px 0;">Get notified when prices drop and it's time to buy the dip!</li>
              </ul>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${appBaseUrl()}" 
                 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                        color: white; padding: 15px 30px; text-decoration: none; 
                        border-radius: 8px; font-weight: 600; display: inline-block;">
                Start Setting Up Alerts
              </a>
            </div>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #777; font-size: 14px;">
              <p style="margin: 0 0 8px; font-size: 13px; color: #555;">You created this KeepItBased account and can opt out of non-essential email anytime under Profile.</p>
              <p><a href="${profilePreferencesUrl()}" style="color: #667eea;">Notification settings</a></p>
              <p style="margin-top: 12px;">Happy investing — The KeepItBased team</p>
            </div>
          </div>
        </div>
      `;

      const mailOptions = {
        from: smtpFromHeader(),
        to: email,
        subject: 'KeepItBased — Welcome! Set up alerts when you’re ready',
        html: html
      };

      await this.transporter.sendMail(mailOptions);
      logger.info(`Welcome email sent to ${email}`);
    } catch (error) {
      logger.error('Error sending welcome email:', error);
    }
  }

  async sendUsernameRecovery(email, username) {
    const uname = username && String(username).trim() ? String(username).trim() : null;
    try {
      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">KeepItBased - Username Recovery</h1>
          </div>
          
          <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h2 style="color: #333; margin-bottom: 20px;">Username Recovery Request</h2>
            
            <p style="font-size: 16px; line-height: 1.6; color: #555;">
              You requested to recover your sign-in details for KeepItBased.
            </p>
            
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
              <p style="margin: 0; font-size: 16px; font-weight: 600; color: #333;">
                Sign in with your <strong>email</strong>: <span style="color: #667eea;">${email}</span>
              </p>
              ${
                uname
                  ? `<p style="margin: 12px 0 0 0; font-size: 16px; font-weight: 600; color: #333;">Your public <strong>username</strong>: <span style="color: #667eea;">@${uname}</span></p>`
                  : '<p style="margin: 12px 0 0 0; font-size: 14px; color: #555;">You have not set a username yet — add one under Profile after you sign in.</p>'
              }
            </div>
            
            <p style="font-size: 16px; line-height: 1.6; color: #555;">
              Your password is unchanged. Use “Forgot password” on the login page if you need to reset it.
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${appBaseUrl()}/login" 
                 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                        color: white; padding: 15px 30px; text-decoration: none; 
                        border-radius: 8px; font-weight: 600; display: inline-block;">
                Go to Login
              </a>
            </div>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #777; font-size: 14px;">
              <p>If you didn't request this, please ignore this email.</p>
              <p>The KeepItBased Team</p>
            </div>
          </div>
        </div>
      `;

      const mailOptions = {
        from: smtpFromHeader(),
        to: email,
        subject: 'KeepItBased - Your Username Recovery',
        html: html
      };

      await this.transporter.sendMail(mailOptions);
      logger.info(`Username recovery email sent to ${email}`);
    } catch (error) {
      logger.error('Error sending username recovery email:', error);
    }
  }

  async sendPasswordReset(email, resetToken) {
    try {
      const resetUrl = `${appBaseUrl()}/reset-password?token=${encodeURIComponent(resetToken)}`;
      
      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">KeepItBased - Password Reset</h1>
          </div>
          
          <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h2 style="color: #333; margin-bottom: 20px;">Reset Your Password</h2>
            
            <p style="font-size: 16px; line-height: 1.6; color: #555;">
              You requested a password reset for your KeepItBased account. Click the button below to set a new password.
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" 
                 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                        color: white; padding: 15px 30px; text-decoration: none; 
                        border-radius: 8px; font-weight: 600; display: inline-block;">
                Reset My Password
              </a>
            </div>
            
            <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
              <p style="margin: 0; font-size: 14px; color: #856404;">
                <strong>Security Note:</strong> This link will expire in 1 hour for your security. 
                If you didn't request this reset, please ignore this email.
              </p>
            </div>
            
            <p style="font-size: 14px; line-height: 1.6; color: #777;">
              If the button doesn't work, you can copy and paste this link into your browser:
              <br><a href="${resetUrl}" style="color: #667eea; word-break: break-all;">${resetUrl}</a>
            </p>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #777; font-size: 14px;">
              <p>This password reset was requested at ${new Date().toLocaleString()}</p>
              <p>The KeepItBased Team</p>
            </div>
          </div>
        </div>
      `;

      const mailOptions = {
        from: smtpFromHeader(),
        to: email,
        subject: 'KeepItBased - Reset Your Password',
        html: html
      };

      await this.transporter.sendMail(mailOptions);
      logger.info(`Password reset email sent to ${email}`);
    } catch (error) {
      logger.error('Error sending password reset email:', error);
    }
  }

  isConfigured() {
    return Boolean(
      process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
    );
  }

  /**
   * Watchlist / PriceMonitor deterministic opportunity signal (not legacy alert rules).
   * @param {object} [options]
   * @param {string} [options.subjectPrefix] — e.g. `[TEST] ` for smoke scripts
   */
  async sendOpportunitySignalEmail(toAddress, payload, options = {}) {
    if (!this.isConfigured()) {
      logger.warn('Opportunity email skipped: SMTP not configured');
      return;
    }
    try {
      const subjectPrefix =
        typeof options.subjectPrefix === 'string' ? options.subjectPrefix : '';
      const {
        symbol,
        assetType,
        flags = [],
        reasons = [],
        vsBaselinePct,
        price,
        timestamp
      } = payload;
      const hasCapitulationFlag = Array.isArray(flags) && flags.includes('capitulation');
      const displayFlagLabels = Array.isArray(flags)
        ? flags.map((f) =>
            f === 'capitulation' ? 'Major Capitulation – Long-term Setup' : String(f)
          )
        : [];
      const flagStr = displayFlagLabels.length ? displayFlagLabels.join(', ') : String(flags);
      const reasonLines = Array.isArray(reasons)
        ? reasons.map((r) => `<li>${String(r)}</li>`).join('')
        : '';
      const vs =
        vsBaselinePct != null && Number.isFinite(Number(vsBaselinePct))
          ? `${Number(vsBaselinePct).toFixed(2)}%`
          : '—';

      const heroTitle = hasCapitulationFlag
        ? 'KeepItBased — Major Capitulation (long-term setup)'
        : 'KeepItBased — Opportunity signal';

      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #0f766e 0%, #115e59 100%); padding: 24px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 22px;">${heroTitle}</h1>
          </div>
          <div style="background: white; padding: 28px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.08);">
            <p style="font-size: 13px; color: #475569; margin: 0 0 16px; line-height: 1.5;">
              ${complianceOptInSentence()}
            </p>
            <p style="font-size: 18px; margin: 0 0 16px;">
              <strong>${String(assetType || '').toUpperCase()} ${String(symbol || '').toUpperCase()}</strong>
            </p>
            <p style="margin: 8px 0;"><strong>Price:</strong> $${Number(price).toFixed(4)}</p>
            <p style="margin: 8px 0;"><strong>Vs baseline:</strong> ${vs}</p>
            <p style="margin: 8px 0;"><strong>Flags:</strong> ${flagStr}</p>
            ${
              reasonLines
                ? `<ul style="margin: 12px 0; padding-left: 20px;">${reasonLines}</ul>`
                : ''
            }
            <div style="text-align: center; margin-top: 24px;">
              <a href="${appBaseUrl()}/opportunity-signals"
                 style="background: linear-gradient(135deg, #0f766e 0%, #115e59 100%);
                        color: white; padding: 12px 24px; text-decoration: none;
                        border-radius: 8px; font-weight: 600; display: inline-block;">
                View signals inbox
              </a>
            </div>
            <p style="margin-top: 24px; font-size: 13px; color: #64748b;">
              ${timestamp ? new Date(timestamp).toLocaleString() : new Date().toLocaleString()}
            </p>
            <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center;">
              <p style="margin: 0 0 8px;">
                <strong style="color: #64748b;">KeepItBased</strong> · educational market alerts · not brokerage or personalized advice.
              </p>
              <p style="margin: 0 0 8px;">
                <a href="${profilePreferencesUrl()}" style="color: #0f766e;">Unsubscribe / manage all email types</a>
                ·
                <a href="${appBaseUrl()}/opportunity-signals" style="color: #0f766e;">Signals inbox</a>
              </p>
              <p style="margin: 12px 0 0; font-size: 11px; color: #cbd5e1;">
                Not investment advice. Past performance does not guarantee future results.
              </p>
            </div>
          </div>
        </div>
      `;

      const symU = String(symbol || '').toUpperCase();
      const subjectLine = hasCapitulationFlag
        ? `${subjectPrefix}KeepItBased — Major long-term setup: ${symU} (${flagStr})`
        : `${subjectPrefix}KeepItBased — Opportunity signal: ${symU} (${flagStr})`;

      const plain = [
        `KeepItBased — opportunity signal (${symU})`,
        `${String(assetType || '').toUpperCase()} ${symU} — flags: ${flagStr} — vs baseline: ${vs}`,
        `${complianceOptInSentence()}`,
        `Signals: ${appBaseUrl()}/opportunity-signals`,
        `Unsubscribe / email preferences: ${profilePreferencesUrl()}`
      ].join('\n\n');

      await this.transporter.sendMail({
        from: smtpFromHeader(),
        to: toAddress,
        subject: subjectLine,
        text: plain,
        html,
        headers: mergeMailHeaders()
      });
      logger.info(`Opportunity signal email sent to ${toAddress} for ${symbol}`);
    } catch (error) {
      logger.error('Error sending opportunity signal email:', error);
    }
  }

  /**
   * Scheduled daily briefing: Grok macro + holdings + headlines + optional X citations + top 2 off-list names.
   * @param {string} toAddress
   * @param {{ digest: Record<string, unknown>, runMetadata?: object }} payload
   */
  async sendDailyWatchlistDigestEmail(toAddress, payload) {
    if (!this.isConfigured()) {
      logger.warn('Daily watchlist digest email skipped: SMTP not configured');
      return;
    }
    try {
      const digest = payload.digest || {};
      const meta = payload.runMetadata || {};
      const prose = (s) => escapeHtml(String(s || '').trim() || '—').replace(/\n/g, '<br>');
      const macro = prose(digest.macroAnalysis);
      const overview = prose(digest.marketOverview);
      const holdings = prose(digest.holdingsAnalysis);
      const disclaimer = prose(
        String(digest.disclaimer || '').trim() ||
          'Educational commentary only; not personalized investment advice.'
      );
      const xSocial = prose(digest.xSocialSummary);

      const newsHits = Array.isArray(digest.newsHighlights) ? digest.newsHighlights : [];
      const newsBlocks = newsHits
        .slice(0, 8)
        .map((n) => {
          const title = escapeHtml(String(n.title || '').trim());
          const sym = escapeHtml(String(n.symbol || '').trim());
          const take = prose(n.takeaway || n.summary || '');
          if (!title && !take) return '';
          return `
            <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0;">
              <p style="margin: 0 0 4px; font-size: 14px; font-weight: 600; color: #0f172a;">
                ${title || 'Highlight'}
                ${sym ? ` <span style="font-weight:500;color:#475569;font-size:13px;">(${sym})</span>` : ''}
              </p>
              <div style="font-size: 14px; color: #475569; line-height: 1.5;">${take}</div>
            </div>`;
        })
        .join('');

      const xPosts = Array.isArray(digest.xPostLinks) ? digest.xPostLinks : [];
      const xPostBlocks = xPosts
          .slice(0, 8)
          .map((item) => {
            const rawUrl = item && typeof item === 'object' ? sanitizeXPostUrl(item.url) : null;
            const url = escapeHtml(rawUrl || '');
            const note = prose(item.note || '');
            if (!rawUrl) return '';
            return `
            <div style="margin-bottom: 8px;">
              <a href="${url}" style="color: #0f766e; font-size: 13px;">${url}</a>
              ${note && note !== '—' ? `<div style="font-size: 12px; color: #64748b; margin-top: 4px;">${note}</div>` : ''}
            </div>`;
          })
          .join('');

      let topPicks = Array.isArray(digest.topStockPicks) ? digest.topStockPicks : [];
      if (!topPicks.length && Array.isArray(digest.suggestedAdditions)) {
        topPicks = digest.suggestedAdditions.slice(0, 2).map((s) => ({
          symbol: s.symbol,
          rationale1to3Years: s.thesis || '',
          rationaleLongTerm: '',
          riskNote: s.riskNote || '',
          keyCatalystOrTheme: s.timeHorizon || ''
        }));
      }

      const topPickBlocks = topPicks
        .slice(0, 2)
        .map((p) => {
          const sym = escapeHtml(String(p.symbol || '').toUpperCase());
          const r1 = prose(p.rationale1to3Years || p.rationale_1_to_3_years);
          const rL = prose(p.rationaleLongTerm || p.rationale_long_term);
          const risk = prose(p.riskNote || '');
          const catalyst = prose(p.keyCatalystOrTheme || '');
          return `
            <div style="border: 1px solid #0f766e33; border-radius: 10px; padding: 16px; margin-bottom: 14px; background: linear-gradient(180deg,#f8fffe 0%,#f8fafc 100%);">
              <p style="margin: 0 0 10px; font-size: 17px; font-weight: 800; color: #134e4a;">${sym}</p>
              <p style="margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #475569;">1–3 year view</p>
              <div style="font-size: 14px; color: #334155; line-height: 1.52; margin-bottom: 14px;">${r1}</div>
              <p style="margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #475569;">Long-term / compounding</p>
              <div style="font-size: 14px; color: #334155; line-height: 1.52; margin-bottom: 12px;">${rL || r1}</div>
              ${catalyst && catalyst !== '—' ? `<p style="margin:0 0 8px;font-size:13px;color:#0f766e;"><strong>Catalyst / theme:</strong> ${catalyst}</p>` : ''}
              ${risk && risk !== '—' ? `<p style="margin: 0; font-size: 13px; color: #b45309;"><strong>Risk:</strong> ${risk}</p>` : ''}
            </div>`;
        })
        .join('');

      const baseUrl = appBaseUrl();
      const dateLabel = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      const metaLine =
        meta.providerUsed != null
          ? `<p style="font-size: 11px; color: #94a3b8; margin-top: 16px;">Model: ${escapeHtml(String(meta.providerUsed))}${meta.fallbackUsed ? ' • template/fallback portions possible' : ''}</p>`
          : '';

      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #1e3a5f 0%, #0f766e 100%); padding: 26px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 22px;">Daily market briefing</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0; font-size: 14px;">Watchlist positioning &mdash; macro &mdash; news &mdash; ideas</p>
            <p style="color: rgba(255,255,255,0.88); margin: 8px 0 0; font-size: 13px;">${escapeHtml(dateLabel)}</p>
          </div>
          <div style="background: white; padding: 28px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.08);">
            <p style="font-size: 13px; color: #475569; margin: 0 0 18px; line-height: 1.55;">
              You enabled the <strong>daily market briefing</strong> for your KeepItBased login. Turn it off anytime in Profile — link below.
            </p>

            <h2 style="font-size: 15px; color: #0f172a; margin: 0 0 10px;">Macro backdrop</h2>
            <p style="font-size: 15px; color: #334155; line-height: 1.55; margin: 0 0 18px;">${macro}</p>

            <h2 style="font-size: 15px; color: #0f172a; margin: 0 0 10px;">Tape &mdash; equities tone</h2>
            <p style="font-size: 15px; color: #334155; line-height: 1.55; margin: 0 0 22px;">${overview}</p>

            <h2 style="font-size: 15px; color: #0f172a; margin: 0 0 10px;">Your watchlist positions</h2>
            <p style="font-size: 15px; color: #334155; line-height: 1.55; margin: 0 0 22px;">${holdings}</p>

            <h2 style="font-size: 15px; color: #0f172a; margin: 0 0 10px;">Pertinent headlines (ingested feeds)</h2>
            <p style="font-size: 12px; color: #64748b; margin: 0 0 12px;">Wire/vendor headlines stored for your symbols — verify originals before trading.</p>
            ${newsBlocks || '<p style="color: #64748b; font-size: 14px;">No recent headlines matched this snapshot.</p>'}

            <h2 style="font-size: 15px; color: #0f172a; margin: 22px 0 10px;">X / social pulse</h2>
            <p style="font-size: 15px; color: #334155; line-height: 1.55; margin: 0 0 14px;">${xSocial}</p>
            ${xPostBlocks ? `<div style="margin-bottom: 8px;"><p style="font-size:12px;color:#64748b;margin-bottom:8px;">Linked posts</p>${xPostBlocks}</div>` : ''}

            <h2 style="font-size: 15px; color: #0f172a; margin: 22px 0 10px;">Two ideas off your list (education only)</h2>
            <p style="font-size: 12px; color: #64748b; margin: 0 0 14px;">
              Illustrative liquid US equities <strong>not</strong> on your watchlist: 1&ndash;3 year trajectory plus a long-run lens — not guarantees of return.
            </p>
            ${topPickBlocks || '<p style="color: #64748b; font-size: 14px;">No off-list picks in this run.</p>'}

            <p style="font-size: 12px; color: #64748b; margin-top: 22px; line-height: 1.55;">${disclaimer}</p>
            ${metaLine}

            <div style="text-align: center; margin-top: 24px;">
              <a href="${baseUrl}/"
                 style="background: linear-gradient(135deg, #0f766e 0%, #115e59 100%);
                        color: white; padding: 12px 24px; text-decoration: none;
                        border-radius: 8px; font-weight: 600; display: inline-block;">
                Open KeepItBased
              </a>
            </div>
            <div style="margin-top: 22px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center;">
              <p style="margin: 0 0 8px;"><strong style="color: #64748b;">KeepItBased</strong> · educational digest · not brokerage advice.</p>
              <p style="margin: 0;">
                <a href="${profilePreferencesUrl()}" style="color: #0f766e;">Unsubscribe / notification settings</a>
              </p>
            </div>
          </div>
        </div>
      `;

      const digestPlain = [
        'KeepItBased — Daily market briefing',
        dateLabel,
        `Open app: ${baseUrl}/`,
        `Manage or unsubscribe: ${profilePreferencesUrl()}`
      ].join('\n\n');

      await this.transporter.sendMail({
        from: smtpFromHeader(),
        to: toAddress,
        subject: `KeepItBased — Daily market briefing (${new Date().toLocaleDateString('en-US')})`,
        text: digestPlain,
        html,
        headers: mergeMailHeaders()
      });
      logger.info(`Daily watchlist digest sent to ${toAddress}`);
    } catch (error) {
      logger.error('Error sending daily watchlist digest email:', error);
      throw error;
    }
  }

  /**
   * Grok-backed dip briefing (§11 speed path). Numbers in dipContext are tool-backed; prose is educational only.
   */
  async sendDipInsightEmail(toAddress, params) {
    if (!this.isConfigured()) {
      logger.warn('Dip insight email skipped: SMTP not configured');
      return;
    }
    try {
      const {
        symbol,
        assetType,
        dipContext = {},
        insight = {},
        maxAllocationPct = 10,
        citationUrls = []
      } = params;
      const sym = String(symbol || '').toUpperCase();
      const cap = Math.min(50, Math.max(1, Number(maxAllocationPct) || 10));
      let pct = Number(
        insight.suggestedTranchePct != null
          ? insight.suggestedTranchePct
          : insight.recommendedPositionPct
      );
      if (!Number.isFinite(pct)) pct = Math.min(2, cap);
      pct = Math.min(Math.max(0, pct), cap);

      const verdict = escapeHtml(String(insight.verdict || '—'));
      const confN = Number(insight.confidence);
      const confLabel = Number.isFinite(confN) ? `${Math.round(confN)}%` : '—';
      const reasoningBlock = escapeHtml(
        String(insight.reasoning || '').trim() || String(insight.situationSummary || '').trim()
      );

      const summ = escapeHtml(insight.situationSummary || '');
      const sentLab = escapeHtml(
        (insight.xSentiment && insight.xSentiment.label) || 'unknown'
      );
      const drivers = escapeHtml((insight.xSentiment && insight.xSentiment.drivers) || '');
      const fire = insight.fireSaleHypothesis
        ? escapeHtml(String(insight.fireSaleHypothesis))
        : '';
      const risks = Array.isArray(insight.riskNotes)
        ? insight.riskNotes.map((r) => `<li>${escapeHtml(r)}</li>`).join('')
        : '';
      const vs =
        dipContext.vsBaselinePct != null && Number.isFinite(Number(dipContext.vsBaselinePct))
          ? `${Number(dipContext.vsBaselinePct).toFixed(2)}%`
          : '—';
      const px =
        dipContext.price != null && Number.isFinite(Number(dipContext.price))
          ? Number(dipContext.price).toFixed(4)
          : '—';

      const postLinks = [];
      if (Array.isArray(insight.xPostLinks)) {
        for (const row of insight.xPostLinks) {
          if (row && row.url) {
            const href = sanitizeXPostUrl(row.url);
            if (href)
              postLinks.push({
                href,
                note: escapeHtml(row.note || '')
              });
          }
        }
      }
      if (postLinks.length === 0 && Array.isArray(citationUrls)) {
        for (const u of citationUrls.slice(0, 12)) {
          const href = sanitizeXPostUrl(u);
          if (href) postLinks.push({ href, note: 'x_search citation' });
        }
      }
      const linksHtml =
        postLinks.length > 0
          ? `<div style="margin: 18px 0; padding: 14px 16px; background: #f1f5f9; border-radius: 8px;">
              <p style="margin: 0 0 10px; font-size: 14px; font-weight: 600; color: #0f172a;">Posts on X (Grok x_search)</p>
              <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #334155;">
                ${postLinks
                  .map(
                    (l) =>
                      `<li style="margin: 6px 0;"><a href="${escapeHtml(l.href)}" style="color: #0f766e;">${escapeHtml(l.href)}</a>${l.note && l.note !== 'x_search citation' ? ` — ${l.note}` : ''}</li>`
                  )
                  .join('')}
              </ul>
            </div>`
          : '';

      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #0f766e 0%, #115e59 100%); padding: 24px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 22px;">UltimateDipBuyer AI — Assessment</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0; font-size: 14px;">${String(assetType || '').toUpperCase()} ${sym}</p>
          </div>
          <div style="background: white; padding: 28px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.08);">
            <p style="font-size: 13px; color: #475569; margin: 0 0 16px; line-height: 1.5;">
              ${complianceOptInSentence()}
            </p>
            <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 18px;">
              <div style="flex: 1; min-width: 140px; background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 8px; padding: 12px 14px;">
                <p style="margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #0f766e;">Verdict</p>
                <p style="margin: 6px 0 0; font-size: 20px; font-weight: 700; color: #0f172a;">${verdict}</p>
              </div>
              <div style="flex: 1; min-width: 140px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px;">
                <p style="margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b;">Confidence</p>
                <p style="margin: 6px 0 0; font-size: 20px; font-weight: 700; color: #0f172a;">${escapeHtml(confLabel)}</p>
              </div>
            </div>
            ${
              reasoningBlock
                ? `<div style="background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 14px 16px; margin-bottom: 16px;">
              <p style="margin: 0 0 6px; font-size: 12px; font-weight: 600; color: #92400e;">When to buy / invalidation (educational)</p>
              <p style="margin: 0; font-size: 14px; line-height: 1.55; color: #1e293b; white-space: pre-wrap;">${reasoningBlock}</p>
            </div>`
                : ''
            }
            <p style="font-size: 15px; line-height: 1.55; color: #1e293b; margin: 0 0 16px;">${summ}</p>
            <div style="background: #f8fafc; border-radius: 8px; padding: 14px 16px; margin-bottom: 16px;">
              <p style="margin: 4px 0; font-size: 14px;"><strong>Live snapshot (tool-backed):</strong> last ~$${px} · vs your baseline ${vs}</p>
              <p style="margin: 4px 0; font-size: 14px;"><strong>X sentiment (Grok x_search):</strong> ${sentLab}</p>
              <p style="margin: 8px 0 0; font-size: 13px; color: #475569;">${drivers}</p>
            </div>
            ${
              fire
                ? `<p style="font-size: 14px; color: #334155;"><strong>Context:</strong> ${fire}</p>`
                : ''
            }
            ${linksHtml}
            <div style="margin: 20px 0; padding: 16px; border: 1px solid #e2e8f0; border-radius: 8px;">
              <p style="margin: 0 0 8px; font-size: 15px; font-weight: 600;">Suggested tranche (educational, capped at ${cap}% of portfolio)</p>
              <p style="margin: 0; font-size: 28px; font-weight: 700; color: #0f766e;">${pct.toFixed(2)}%</p>
              <p style="margin: 8px 0 0; font-size: 12px; color: #64748b;">You set max ${cap}% as sizing reference; we never exceed it here.</p>
            </div>
            ${
              risks
                ? `<ul style="margin: 12px 0; padding-left: 20px; color: #475569; font-size: 14px;">${risks}</ul>`
                : ''
            }
            <div style="text-align: center; margin-top: 24px;">
              <a href="${appBaseUrl()}/dashboard"
                 style="background: linear-gradient(135deg, #0f766e 0%, #115e59 100%);
                        color: white; padding: 12px 24px; text-decoration: none;
                        border-radius: 8px; font-weight: 600; display: inline-block;">
                Open dashboard
              </a>
            </div>
            <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center;">
              <p style="margin: 0 0 8px;"><strong style="color: #64748b;">KeepItBased · UltimateDipBuyer</strong> (educational)</p>
              <p style="margin: 0 0 8px;">
                <a href="${profilePreferencesUrl()}" style="color: #0f766e;">Unsubscribe / manage email</a>
              </p>
              <p style="margin: 12px 0 0; font-size: 11px; color: #cbd5e1;">
                Not investment advice. Educational commentary only. Past performance does not guarantee future results.
              </p>
            </div>
          </div>
        </div>
      `;

      const subVerdict = String(insight.verdict || '').trim() || 'Assessment';
      const dipPlain = [
        `KeepItBased — Dip briefing for ${sym} (${subVerdict}, ${confLabel} confidence)`,
        `${complianceOptInSentence()}`,
        `${appBaseUrl()}/dashboard`,
        `Manage email: ${profilePreferencesUrl()}`
      ].join('\n\n');
      await this.transporter.sendMail({
        from: smtpFromHeader(),
        to: toAddress,
        subject: `KeepItBased — Dip briefing: ${sym} — ${subVerdict}`,
        text: dipPlain,
        html,
        headers: mergeMailHeaders()
      });
      logger.info(`Dip insight email sent to ${toAddress} for ${sym}`);
    } catch (error) {
      logger.error('Error sending dip insight email:', error);
      throw error;
    }
  }
}

module.exports = new EmailService();