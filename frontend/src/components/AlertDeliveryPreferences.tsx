import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../services/authService';
import type { User } from '../types';

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney'
];

/**
 * Per-user delivery settings for watchlist opportunity alerts (emails, toasts, quiet hours, minimum tier).
 * Persists to `users.notification_preferences` via `/users/profile`.
 */
export const AlertDeliveryPreferences: React.FC = () => {
  const { user, updateUser } = useAuth();
  const [saving, setSaving] = useState(false);

  const [opportunityEmail, setOpportunityEmail] = useState(true);
  const [notifyLevel, setNotifyLevel] = useState<'all' | 'overreaction_only'>('all');
  const [emailNotifyLevel, setEmailNotifyLevel] = useState<
    'all' | 'overreaction_only' | 'capitulation_only'
  >('overreaction_only');
  const [respectQuietHours, setRespectQuietHours] = useState(true);
  const [stockMarketHoursOnly, setStockMarketHoursOnly] = useState(true);
  const [startHour, setStartHour] = useState(22);
  const [endHour, setEndHour] = useState(7);
  const [timezone, setTimezone] = useState('America/New_York');

  useEffect(() => {
    if (!user?.notificationPreferences) return;
    const n = user.notificationPreferences;
    setOpportunityEmail(n.opportunityEmail !== false);
    setNotifyLevel(n.opportunityNotifyLevel === 'overreaction_only' ? 'overreaction_only' : 'all');
    const enl = n.opportunityEmailNotifyLevel;
    setEmailNotifyLevel(
      enl === 'all' || enl === 'capitulation_only' ? enl : 'overreaction_only'
    );
    setRespectQuietHours(n.opportunityRespectQuietHours !== false);
    setStockMarketHoursOnly(n.opportunityStockMarketHoursOnly !== false);
    setStartHour(
      typeof n.researchQuietHoursLocal?.startHour === 'number' && Number.isFinite(n.researchQuietHoursLocal.startHour)
        ? Math.min(23, Math.max(0, Math.round(n.researchQuietHoursLocal.startHour)))
        : 22
    );
    setEndHour(
      typeof n.researchQuietHoursLocal?.endHour === 'number' && Number.isFinite(n.researchQuietHoursLocal.endHour)
        ? Math.min(23, Math.max(0, Math.round(n.researchQuietHoursLocal.endHour)))
        : 7
    );
    setTimezone(typeof n.timezone === 'string' && n.timezone.trim() ? n.timezone.trim() : 'America/New_York');
  }, [user]);

  const masterEmailEnabled = user?.notificationPreferences?.email !== false;

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const base = (user.notificationPreferences || {}) as NonNullable<User['notificationPreferences']>;
      const updated = await authService.updateProfile({
        notificationPreferences: {
          ...base,
          opportunityEmail,
          opportunityNotifyLevel: notifyLevel,
          opportunityEmailNotifyLevel: emailNotifyLevel,
          opportunityRespectQuietHours: respectQuietHours,
          opportunityStockMarketHoursOnly: stockMarketHoursOnly,
          researchQuietHoursLocal: { startHour, endHour },
          timezone
        }
      });
      updateUser({ notificationPreferences: updated.notificationPreferences });
      toast.success('Alert delivery settings saved');
    } catch {
      toast.error('Could not save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 border-t border-white/[0.06] pt-4">
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-kib-muted">Your notifications</p>
      <p className="mb-3 text-[11px] leading-relaxed text-kib-muted">
        Quiet hours, stock session timing, and separate tiers for <strong className="text-kib-fg/90">in-app toasts</strong>{' '}
        vs <strong className="text-kib-fg/90">emails</strong> — by default, opportunity <strong>emails</strong> skip the
        smaller <span className="font-mono text-kib-fg/80">on_sale</span> tier (you still see those on the Signals page).
        US stock toasts/emails default to regular session; crypto is 24/7.
      </p>
      <p className="mb-3 text-[11px] leading-relaxed text-kib-muted">
        Checking <strong className="text-kib-fg/90">Email me opportunity dip alerts</strong> covers the short
        opportunity email when SMTP is configured. The richer <strong className="text-kib-fg/90">UltimateDipBuyer / Grok</strong>{' '}
        email also needs <strong className="text-kib-fg/90">Profile → Dip briefing emails (Grok)</strong> (and host{' '}
        <code className="rounded bg-black/20 px-1 font-mono text-[10px]">ENABLE_DIP_INSIGHT_EMAIL</code>). If Grok is off,
        you still get the shorter template when this email toggle is on.
      </p>

      <div className="space-y-3 text-sm">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={opportunityEmail && masterEmailEnabled}
            disabled={!masterEmailEnabled}
            onChange={(e) => setOpportunityEmail(e.target.checked)}
            className="mt-0.5 rounded border-kib-line bg-kib-raise text-kib-cyber focus:ring-kib-cyber"
          />
          <span className={!masterEmailEnabled ? 'text-kib-muted' : 'text-kib-fg'}>
            Email me opportunity dip alerts
            {!masterEmailEnabled && (
              <span className="mt-0.5 block text-[11px] text-amber-200/90">
                Turn on &quot;Email alerts&quot; in Profile → Notifications to enable email.
              </span>
            )}
          </span>
        </label>

        <div>
          <label htmlFor="opp-notify-level" className="mb-1 block text-xs font-medium text-slate-300">
            In-app toasts for
          </label>
          <select
            id="opp-notify-level"
            value={notifyLevel}
            onChange={(e) => setNotifyLevel(e.target.value as 'all' | 'overreaction_only')}
            className="input-field w-full max-w-md text-sm"
          >
            <option value="all">All qualifying dip signals (including smaller &quot;on sale&quot; tier)</option>
            <option value="overreaction_only">
              Larger / structural dips only (overreaction or capitulation — fewer toasts)
            </option>
          </select>
        </div>

        <div>
          <label htmlFor="opp-email-level" className="mb-1 block text-xs font-medium text-slate-300">
            Opportunity emails for
          </label>
          <select
            id="opp-email-level"
            value={emailNotifyLevel}
            onChange={(e) =>
              setEmailNotifyLevel(e.target.value as 'all' | 'overreaction_only' | 'capitulation_only')
            }
            className="input-field w-full max-w-md text-sm"
          >
            <option value="overreaction_only">
              Important dips only — overreaction or major capitulation (default; no email for on_sale-only)
            </option>
            <option value="capitulation_only">
              Major capitulation only (long-term tier — rarest emails)
            </option>
            <option value="all">Every qualifying tier including smaller &quot;on sale&quot; signals</option>
          </select>
        </div>

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={stockMarketHoursOnly}
            onChange={(e) => setStockMarketHoursOnly(e.target.checked)}
            className="mt-0.5 rounded border-kib-line bg-kib-raise text-kib-cyber focus:ring-kib-cyber"
          />
          <span className="text-kib-fg">
            <strong className="font-medium text-kib-fg/90">US stocks:</strong> only send opportunity{' '}
            <strong className="font-medium text-kib-fg/90">toasts and opportunity emails</strong> during regular session
            (Mon–Fri
            9:30 AM–4:00 PM ET). <span className="text-kib-muted">Crypto signals are not restricted by this.</span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={respectQuietHours}
            onChange={(e) => setRespectQuietHours(e.target.checked)}
            className="mt-0.5 rounded border-kib-line bg-kib-raise text-kib-cyber focus:ring-kib-cyber"
          />
          <span className="text-kib-fg">
            Don&apos;t send <strong className="font-medium text-kib-fg/90">opportunity emails</strong> during quiet hours
            (below — applies on top of stock session timing for email only)
          </span>
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
          <div>
            <label htmlFor="qh-start" className="mb-1 block text-xs font-medium text-slate-300">
              Quiet start (hour, local)
            </label>
            <select
              id="qh-start"
              value={startHour}
              onChange={(e) => setStartHour(Number(e.target.value))}
              className="input-field w-full text-sm"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>
                  {i}:00
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="qh-end" className="mb-1 block text-xs font-medium text-slate-300">
              Quiet end (hour, local)
            </label>
            <select
              id="qh-end"
              value={endHour}
              onChange={(e) => setEndHour(Number(e.target.value))}
              className="input-field w-full text-sm"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>
                  {i}:00
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-1">
            <label htmlFor="qh-tz" className="mb-1 block text-xs font-medium text-slate-300">
              Time zone
            </label>
            <input
              id="qh-tz"
              list="kib-tz-preset"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="America/New_York"
              className="input-field w-full font-mono text-sm"
            />
            <datalist id="kib-tz-preset">
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </div>
        </div>
        <p className="text-[10px] leading-relaxed text-kib-muted">
          Overnight windows supported (e.g. start 22, end 7). Uses{' '}
          <a
            href="https://en.wikipedia.org/wiki/List_of_tz_database_time_zones"
            target="_blank"
            rel="noreferrer"
            className="text-kib-cyber underline-offset-2 hover:underline"
          >
            IANA
          </a>{' '}
          zones. Master toast toggle: Profile →{' '}
          <span className="text-kib-fg/80">In-app opportunity toasts</span>.
        </p>

        <button type="button" onClick={() => void save()} disabled={saving} className="btn-primary text-sm disabled:opacity-50">
          {saving ? 'Saving…' : 'Save delivery settings'}
        </button>
      </div>
    </div>
  );
};
