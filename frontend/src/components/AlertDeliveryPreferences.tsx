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
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-kib-muted">Your alert delivery</p>
      <p className="mb-3 text-[11px] leading-relaxed text-kib-muted">
        Control how dip opportunity alerts reach you. Threshold math is still set globally on the server above;
        this only affects when notifications are sent. By default, <strong className="text-kib-fg/90">US stocks</strong> use
        regular market hours; <strong className="text-kib-fg/90">crypto</strong> is 24/7.
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
            Notify me for
          </label>
          <select
            id="opp-notify-level"
            value={notifyLevel}
            onChange={(e) => setNotifyLevel(e.target.value as 'all' | 'overreaction_only')}
            className="input-field w-full max-w-md text-sm"
          >
            <option value="all">All qualifying dip signals (including smaller &quot;on sale&quot; tier)</option>
            <option value="overreaction_only">
              Larger / structural dips only (overreaction or long-term capitulation — fewer pings)
            </option>
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
            <strong className="font-medium text-kib-fg/90">toasts &amp; emails</strong> during regular session (Mon–Fri
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
