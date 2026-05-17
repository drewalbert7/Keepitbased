import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../services/authService';
import { fetchPublicHealthConfig, type PublicHealthConfig } from '../services/healthConfigService';
import type { User } from '../types';

type OpportunityToastTier = 'all' | 'overreaction_only';
type OpportunityEmailTier = 'all' | 'overreaction_only' | 'capitulation_only';

/** Public /health/config plus authenticated host mail/digest flags */
type ProfileHostHealth = PublicHealthConfig & {
  smtpConfigured?: boolean;
  dailyWatchlistDigestEnabled?: boolean;
  dailyWatchlistDigestCron?: string;
};

const ProfilePage: React.FC = () => {
  const { user, updateUser } = useAuth();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [notifPrefs, setNotifPrefs] = useState({
    email: true,
    push: true,
    opportunityToasts: true,
    opportunityEmail: true,
    opportunityNotifyLevel: 'all' as OpportunityToastTier,
    opportunityEmailNotifyLevel: 'overreaction_only' as OpportunityEmailTier,
    opportunityMaxEmailsPerDay: 10,
    timezone: 'America/New_York',
    quietHoursStart: '22:00',
    quietHoursEnd: '08:00',
    opportunityRespectQuietHours: true,
    opportunityStockMarketHoursOnly: true,
    dipInsightEmail: true,
    researchDigestEmail: true,
    dailyWatchlistDigestEmail: true,
    agentMaxPositionSizePct: 10
  });
  const [notifSaving, setNotifSaving] = useState(false);

  const [hostNotifCfg, setHostNotifCfg] = useState<ProfileHostHealth | null>(null);

  const [username, setUsername] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  const [signupPassActive, setSignupPassActive] = useState(false);
  const [passcodeInput, setPasscodeInput] = useState('');
  const [passcodeBusy, setPasscodeBusy] = useState(false);
  const [passcodeReveal, setPasscodeReveal] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setUsername(user.username ?? '');
  }, [user?.id, user?.username]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await authService.getSignupPasscodeStatus();
        if (!cancelled) setSignupPassActive(s.active);
      } catch {
        if (!cancelled) setSignupPassActive(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const [pub, flags] = await Promise.all([
          fetchPublicHealthConfig(),
          authService.getHostNotificationFlags()
        ]);
        if (cancelled) return;
        setHostNotifCfg(pub ? { ...pub, ...flags } : { ...flags });
      } catch {
        try {
          const pub = await fetchPublicHealthConfig();
          if (!cancelled) setHostNotifCfg(pub);
        } catch {
          if (!cancelled) setHostNotifCfg(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    const n = (user.notificationPreferences ?? {}) as Partial<
      NonNullable<User['notificationPreferences']>
    >;
    const pctRaw = n.agentMaxPositionSizePct;
    const pct =
      typeof pctRaw === 'number' && Number.isFinite(pctRaw)
        ? Math.min(50, Math.max(1, Math.round(pctRaw)))
        : 10;
    const enl = n.opportunityEmailNotifyLevel;
    setNotifPrefs({
      email: n.email !== false,
      push: n.push !== false,
      opportunityToasts: n.opportunityToasts !== false,
      opportunityEmail: n.opportunityEmail !== false,
      opportunityNotifyLevel: n.opportunityNotifyLevel === 'overreaction_only' ? 'overreaction_only' : 'all',
      opportunityEmailNotifyLevel:
        enl === 'all' || enl === 'overreaction_only' || enl === 'capitulation_only'
          ? enl
          : 'overreaction_only',
      opportunityMaxEmailsPerDay:
        typeof n.opportunityMaxEmailsPerDay === 'number' && Number.isFinite(n.opportunityMaxEmailsPerDay)
          ? Math.min(50, Math.max(1, Math.round(n.opportunityMaxEmailsPerDay)))
          : 10,
      timezone:
        typeof n.timezone === 'string' && n.timezone.trim().length > 0
          ? n.timezone.trim()
          : 'America/New_York',
      quietHoursStart:
        typeof n.quietHoursStart === 'string' && /^\d{1,2}:\d{2}$/.test(n.quietHoursStart.trim())
          ? n.quietHoursStart.trim()
          : '22:00',
      quietHoursEnd:
        typeof n.quietHoursEnd === 'string' && /^\d{1,2}:\d{2}$/.test(n.quietHoursEnd.trim())
          ? n.quietHoursEnd.trim()
          : '08:00',
      opportunityRespectQuietHours: n.opportunityRespectQuietHours !== false,
      opportunityStockMarketHoursOnly: n.opportunityStockMarketHoursOnly !== false,
      dipInsightEmail: n.dipInsightEmail !== false,
      researchDigestEmail: n.researchDigestEmail !== false,
      dailyWatchlistDigestEmail: n.dailyWatchlistDigestEmail !== false,
      agentMaxPositionSizePct: pct
    });
  }, [user]);

  const handleSaveUsername = async () => {
    const u = username.trim().toLowerCase();
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(u)) {
      toast.error('Username: 3–32 characters, letters, numbers, or underscore only.');
      return;
    }
    setProfileSaving(true);
    try {
      const updated = await authService.updateProfile({ username: u });
      updateUser({
        username: updated.username,
        firstName: updated.firstName,
        lastName: updated.lastName,
        notificationPreferences: updated.notificationPreferences ?? user?.notificationPreferences
      });
      setUsername(updated.username ?? u);
      toast.success('Username saved');
    } catch (error: unknown) {
      const msg =
        typeof error === 'object' && error !== null && 'response' in error
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      toast.error(msg || 'Could not save profile');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSaveSignupPasscode = async () => {
    const p = passcodeInput.trim();
    if (p.length < 8) {
      toast.error('Passcode must be at least 8 characters.');
      return;
    }
    setPasscodeBusy(true);
    setPasscodeReveal(null);
    try {
      const out = await authService.setSignupPasscode(p);
      setPasscodeInput('');
      setSignupPassActive(true);
      if (out.lastPasscodeShown) {
        setPasscodeReveal(out.lastPasscodeShown);
        toast.success('Passcode saved — copy it from the box below (shown once).');
      } else {
        toast.success(out.message);
      }
    } catch (error: unknown) {
      const msg =
        typeof error === 'object' && error !== null && 'response' in error
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      toast.error(msg || 'Could not save passcode');
    } finally {
      setPasscodeBusy(false);
    }
  };

  const handleClearSignupPasscode = async () => {
    setPasscodeBusy(true);
    try {
      await authService.clearSignupPasscode();
      setSignupPassActive(false);
      setPasscodeReveal(null);
      toast.success('Signup passcode removed');
    } catch (error: unknown) {
      const msg =
        typeof error === 'object' && error !== null && 'response' in error
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      toast.error(msg || 'Could not remove passcode');
    } finally {
      setPasscodeBusy(false);
    }
  };

  const handleSaveNotifications = async () => {
    if (!user) return;
    setNotifSaving(true);
    try {
      const base = { ...(user.notificationPreferences || {}) } as Record<string, unknown>;
      delete base.researchQuietHoursLocal;
      const updated = await authService.updateProfile({
        notificationPreferences: {
          ...(base as NonNullable<User['notificationPreferences']>),
          email: notifPrefs.email,
          push: notifPrefs.push,
          opportunityToasts: notifPrefs.opportunityToasts,
          opportunityEmail: notifPrefs.opportunityEmail,
          opportunityNotifyLevel: notifPrefs.opportunityNotifyLevel,
          opportunityEmailNotifyLevel: notifPrefs.opportunityEmailNotifyLevel,
          opportunityMaxEmailsPerDay: notifPrefs.opportunityMaxEmailsPerDay,
          timezone: notifPrefs.timezone.trim() || 'America/New_York',
          quietHoursStart: notifPrefs.quietHoursStart.trim() || '22:00',
          quietHoursEnd: notifPrefs.quietHoursEnd.trim() || '08:00',
          opportunityRespectQuietHours: notifPrefs.opportunityRespectQuietHours,
          opportunityStockMarketHoursOnly: notifPrefs.opportunityStockMarketHoursOnly,
          dipInsightEmail: notifPrefs.dipInsightEmail,
          researchDigestEmail: notifPrefs.researchDigestEmail,
          dailyWatchlistDigestEmail: notifPrefs.dailyWatchlistDigestEmail,
          agentMaxPositionSizePct: notifPrefs.agentMaxPositionSizePct
        }
      });
      updateUser({
        notificationPreferences: updated.notificationPreferences,
        username: updated.username,
        firstName: updated.firstName,
        lastName: updated.lastName
      });
      toast.success('Notification preferences saved');
    } catch (error: unknown) {
      const msg =
        typeof error === 'object' && error !== null && 'response' in error
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      toast.error(msg || 'Could not save preferences');
    } finally {
      setNotifSaving(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMessage(null);

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'New passwords do not match' });
      return;
    }

    if (passwordForm.newPassword.length < 6) {
      setPasswordMessage({ type: 'error', text: 'New password must be at least 6 characters' });
      return;
    }

    setPasswordLoading(true);

    try {
      await authService.changePassword(passwordForm.currentPassword, passwordForm.newPassword);
      setPasswordMessage({ type: 'success', text: 'Password changed successfully!' });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setShowChangePassword(false);
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || 'Failed to change password';
      setPasswordMessage({ type: 'error', text: errorMessage });
    } finally {
      setPasswordLoading(false);
    }
  };

  const hostMailFlagsLoaded =
    hostNotifCfg != null &&
    typeof hostNotifCfg.smtpConfigured === 'boolean' &&
    typeof hostNotifCfg.dailyWatchlistDigestEnabled === 'boolean';

  const showHostDigestSmtpWarning =
    hostMailFlagsLoaded &&
    hostNotifCfg != null &&
    (!hostNotifCfg.dailyWatchlistDigestEnabled || hostNotifCfg.smtpConfigured === false) &&
    notifPrefs.email &&
    notifPrefs.dailyWatchlistDigestEmail;

  return (
    <div className="mx-auto max-w-[1360px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-kib-fg">Profile</h1>
        <p className="text-kib-muted mt-2">Manage your account settings</p>
      </div>
      
      <div className="space-y-6">
        {/* User Information */}
        <div className="card">
          <h2 className="text-xl font-semibold text-kib-fg mb-4">Account Information</h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="profile-username" className="block text-sm font-medium text-slate-300">
                Username
              </label>
              <input
                id="profile-username"
                type="text"
                autoComplete="username"
                minLength={3}
                maxLength={32}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input-field mt-1 font-mono"
                placeholder="your_handle"
              />
              <p className="mt-1 text-xs text-kib-muted">
                3–32 characters: letters, numbers, underscore. Shown in the app and chat; sign-in is still with email +
                password.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleSaveUsername()}
              disabled={profileSaving}
              className="btn-primary disabled:opacity-50"
            >
              {profileSaving ? 'Saving…' : 'Save username'}
            </button>
            <div>
              <label className="block text-sm font-medium text-slate-300">Email</label>
              <div className="mt-1 text-kib-fg">{user?.email}</div>
              <p className="mt-1 text-xs text-kib-muted">Email sign-in address cannot be changed here.</p>
            </div>

            <div className="rounded-lg border border-white/[0.08] bg-black/20 p-4">
              <h3 className="text-sm font-semibold text-kib-fg">Invite friends (signup passcode)</h3>
              <p className="mt-1 text-xs text-kib-muted">
                Set a passcode and share it with people you trust. They enter it on the register page instead of (or as
                well as) the host invite. Only one passcode per account; changing it replaces the old one.
              </p>
              <p className="mt-2 text-xs text-kib-muted">
                Status:{' '}
                <span className={signupPassActive ? 'text-emerald-400' : 'text-kib-muted'}>
                  {signupPassActive ? 'Active — new signups can use your passcode' : 'Not set'}
                </span>
              </p>
              {passcodeReveal ? (
                <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 font-mono text-sm text-emerald-100 break-all">
                  Copy now: <strong>{passcodeReveal}</strong>
                </div>
              ) : null}
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                <input
                  type="password"
                  autoComplete="new-password"
                  className="input-field flex-1 font-mono"
                  placeholder="New passcode (8+ characters)"
                  value={passcodeInput}
                  onChange={(e) => setPasscodeInput(e.target.value)}
                  minLength={8}
                  maxLength={128}
                />
                <button
                  type="button"
                  disabled={passcodeBusy}
                  onClick={() => void handleSaveSignupPasscode()}
                  className="btn-primary shrink-0 disabled:opacity-50"
                >
                  {passcodeBusy ? 'Saving…' : 'Save passcode'}
                </button>
              </div>
              {signupPassActive ? (
                <button
                  type="button"
                  disabled={passcodeBusy}
                  onClick={() => void handleClearSignupPasscode()}
                  className="btn-secondary mt-2 text-sm disabled:opacity-50"
                >
                  Remove passcode
                </button>
              ) : null}
            </div>

            {user?.isSignupInviteAdmin ? (
              <div className="pt-4 border-t border-kib-line mt-4">
                <p className="text-sm font-medium text-kib-fg">Administration</p>
                <p className="text-xs text-kib-muted mt-1 mb-2">
                  Invite-only signup: rotate the shared invitation code. This panel is omitted for other accounts.
                </p>
                <Link
                  to="/profile/signup-invite-admin"
                  className="inline-flex items-center rounded-md border border-white/15 bg-white/[0.04] px-3 py-2 text-sm font-medium text-kib-fg hover:border-kib-cyber/50 hover:bg-white/[0.07]"
                >
                  Manage signup invitation code →
                </Link>
              </div>
            ) : null}
          </div>
        </div>

        {/* Notifications */}
        <div className="card">
          <h2 className="text-xl font-semibold text-kib-fg mb-1">Notifications</h2>
          <p className="text-sm text-kib-muted mb-6">
            Control channels, dip-alert tiers, and optional Grok briefings. Opportunity rows are always recorded for
            review.
          </p>

          <div className="space-y-8">
            <section>
              <h3 className="text-sm font-semibold text-kib-fg mb-3">Channels</h3>
              <div className="space-y-3">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={notifPrefs.email}
                    onChange={(e) => setNotifPrefs((p) => ({ ...p, email: e.target.checked }))}
                    className="rounded border-kib-line bg-kib-raise text-kib-cyber focus:ring-kib-cyber"
                  />
                  <span className="text-kib-fg">Email</span>
                </label>
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={notifPrefs.push}
                    onChange={(e) => setNotifPrefs((p) => ({ ...p, push: e.target.checked }))}
                    className="rounded border-kib-line bg-kib-raise text-kib-cyber focus:ring-kib-cyber"
                  />
                  <span className="text-kib-fg">Push (when supported)</span>
                </label>
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={notifPrefs.opportunityToasts}
                    onChange={(e) =>
                      setNotifPrefs((p) => ({ ...p, opportunityToasts: e.target.checked }))
                    }
                    className="rounded border-kib-line bg-kib-raise text-kib-cyber focus:ring-kib-cyber"
                  />
                  <span className="text-kib-fg">In-app opportunity toasts</span>
                </label>
              </div>
            </section>

            <section className="border-t border-kib-line pt-6">
              <h3 className="text-sm font-semibold text-kib-fg mb-1">Opportunity dip alerts</h3>
              <p className="mb-4 text-xs text-kib-muted">
                Fires when live quotes cross dip tiers vs the <strong className="font-medium text-slate-300">baseline price</strong>{' '}
                on each symbol in your watchlist alerts (set when you add or refresh an alert). Without a baseline,
                opportunity emails will not send for that symbol. Crypto is 24/7; US stocks can be limited to regular
                session below.
              </p>
              <div className="space-y-4 text-sm">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={notifPrefs.opportunityEmail && notifPrefs.email}
                    disabled={!notifPrefs.email}
                    onChange={(e) => setNotifPrefs((p) => ({ ...p, opportunityEmail: e.target.checked }))}
                    className="mt-0.5 rounded border-kib-line bg-kib-raise text-kib-cyber focus:ring-kib-cyber"
                  />
                  <span className={!notifPrefs.email ? 'text-kib-muted' : 'text-kib-fg'}>
                    Email me dip alerts
                    {!notifPrefs.email ? (
                      <span className="mt-0.5 block text-[11px] text-amber-200/90">
                        Turn on Email above to enable dip emails.
                      </span>
                    ) : null}
                  </span>
                </label>

                <div>
                  <label htmlFor="prof-toast-tier" className="mb-1 block text-xs font-medium text-slate-300">
                    In-app toasts
                  </label>
                  <select
                    id="prof-toast-tier"
                    value={notifPrefs.opportunityNotifyLevel}
                    onChange={(e) =>
                      setNotifPrefs((p) => ({
                        ...p,
                        opportunityNotifyLevel: e.target.value as OpportunityToastTier
                      }))
                    }
                    className="input-field max-w-md w-full text-sm"
                  >
                    <option value="all">All tiers (including smaller dips)</option>
                    <option value="overreaction_only">Larger dips only (fewer toasts)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="prof-email-tier" className="mb-1 block text-xs font-medium text-slate-300">
                    Dip emails
                  </label>
                  <select
                    id="prof-email-tier"
                    value={notifPrefs.opportunityEmailNotifyLevel}
                    onChange={(e) =>
                      setNotifPrefs((p) => ({
                        ...p,
                        opportunityEmailNotifyLevel: e.target.value as OpportunityEmailTier
                      }))
                    }
                    className="input-field max-w-md w-full text-sm"
                  >
                    <option value="all">All qualifying tiers</option>
                    <option value="overreaction_only">Important dips only (no email for smallest tier)</option>
                    <option value="capitulation_only">Major long-term tier only</option>
                  </select>
                </div>

                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={notifPrefs.opportunityStockMarketHoursOnly}
                    onChange={(e) =>
                      setNotifPrefs((p) => ({
                        ...p,
                        opportunityStockMarketHoursOnly: e.target.checked
                      }))
                    }
                    className="mt-0.5 rounded border-kib-line bg-kib-raise text-kib-cyber focus:ring-kib-cyber"
                  />
                  <span className="text-kib-fg">
                    US stocks: only notify during regular session (Mon–Fri 9:30–16:00 ET). Crypto unaffected.
                  </span>
                </label>

                <div>
                  <label htmlFor="prof-opp-max-day" className="mb-1 block text-xs font-medium text-slate-300">
                    Max dip emails per day
                  </label>
                  <input
                    id="prof-opp-max-day"
                    type="number"
                    min={1}
                    max={50}
                    step={1}
                    value={notifPrefs.opportunityMaxEmailsPerDay}
                    disabled={!notifPrefs.email || !notifPrefs.opportunityEmail}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      setNotifPrefs((p) => ({
                        ...p,
                        opportunityMaxEmailsPerDay: Math.min(50, Math.max(1, Math.round(v)))
                      }));
                    }}
                    className="input-field max-w-xs w-full text-sm disabled:opacity-50"
                  />
                  <p className="mt-1 text-[11px] text-kib-muted">UTC day; counts plain and Grok dip emails.</p>
                </div>

                <div className="rounded-lg border border-kib-line/80 bg-kib-raise/40 px-3 py-3 space-y-3 max-w-2xl">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={notifPrefs.opportunityRespectQuietHours}
                      disabled={!notifPrefs.email || !notifPrefs.opportunityEmail}
                      onChange={(e) =>
                        setNotifPrefs((p) => ({
                          ...p,
                          opportunityRespectQuietHours: e.target.checked
                        }))
                      }
                      className="mt-0.5 rounded border-kib-line bg-kib-raise text-kib-cyber focus:ring-kib-cyber disabled:opacity-50"
                    />
                    <span
                      className={`text-sm ${!notifPrefs.email || !notifPrefs.opportunityEmail ? 'text-kib-muted' : 'text-kib-fg'}`}
                    >
                      Quiet hours — pause dip emails overnight (toasts still fire if enabled)
                    </span>
                  </label>
                  <div className="grid gap-3 sm:grid-cols-3 text-sm">
                    <div>
                      <label htmlFor="prof-tz" className="mb-1 block text-xs font-medium text-slate-300">
                        Timezone
                      </label>
                      <input
                        id="prof-tz"
                        type="text"
                        value={notifPrefs.timezone}
                        disabled={
                          !notifPrefs.email ||
                          !notifPrefs.opportunityEmail ||
                          !notifPrefs.opportunityRespectQuietHours
                        }
                        onChange={(e) => setNotifPrefs((p) => ({ ...p, timezone: e.target.value }))}
                        className="input-field w-full font-mono text-xs disabled:opacity-50"
                        placeholder="America/New_York"
                      />
                    </div>
                    <div>
                      <label htmlFor="prof-quiet-start" className="mb-1 block text-xs font-medium text-slate-300">
                        Quiet from
                      </label>
                      <input
                        id="prof-quiet-start"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]{1,2}:[0-9]{2}"
                        value={notifPrefs.quietHoursStart}
                        disabled={
                          !notifPrefs.email ||
                          !notifPrefs.opportunityEmail ||
                          !notifPrefs.opportunityRespectQuietHours
                        }
                        onChange={(e) => setNotifPrefs((p) => ({ ...p, quietHoursStart: e.target.value }))}
                        className="input-field w-full font-mono text-xs disabled:opacity-50"
                        placeholder="22:00"
                      />
                    </div>
                    <div>
                      <label htmlFor="prof-quiet-end" className="mb-1 block text-xs font-medium text-slate-300">
                        Quiet until
                      </label>
                      <input
                        id="prof-quiet-end"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]{1,2}:[0-9]{2}"
                        value={notifPrefs.quietHoursEnd}
                        disabled={
                          !notifPrefs.email ||
                          !notifPrefs.opportunityEmail ||
                          !notifPrefs.opportunityRespectQuietHours
                        }
                        onChange={(e) => setNotifPrefs((p) => ({ ...p, quietHoursEnd: e.target.value }))}
                        className="input-field w-full font-mono text-xs disabled:opacity-50"
                        placeholder="08:00"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-kib-muted m-0">
                    Local time in your timezone (24h, e.g. 22:00–08:00). Overnight windows wrap past midnight.
                  </p>
                </div>
              </div>
            </section>

            <section className="border-t border-kib-line pt-6">
              <h3 className="text-sm font-semibold text-kib-fg mb-3">Research & briefings</h3>
              <div className="space-y-3">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={notifPrefs.dipInsightEmail}
                    onChange={(e) =>
                      setNotifPrefs((p) => ({ ...p, dipInsightEmail: e.target.checked }))
                    }
                    className="rounded border-kib-line bg-kib-raise text-kib-cyber focus:ring-kib-cyber"
                    disabled={!notifPrefs.email}
                  />
                  <span className={`text-kib-fg ${!notifPrefs.email ? 'opacity-50' : ''}`}>
                    Grok dip briefing (rich email when the server enables it)
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={notifPrefs.researchDigestEmail}
                    onChange={(e) =>
                      setNotifPrefs((p) => ({ ...p, researchDigestEmail: e.target.checked }))
                    }
                    className="mt-0.5 rounded border-kib-line bg-kib-raise text-kib-cyber focus:ring-kib-cyber"
                    disabled={!notifPrefs.email || !notifPrefs.dipInsightEmail}
                  />
                  <span
                    className={`text-sm ${!notifPrefs.email || !notifPrefs.dipInsightEmail ? 'text-kib-muted' : 'text-kib-fg'}`}
                  >
                    Require a stored headline before sending the full Grok email (otherwise short dip email only)
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={notifPrefs.dailyWatchlistDigestEmail}
                    onChange={(e) =>
                      setNotifPrefs((p) => ({ ...p, dailyWatchlistDigestEmail: e.target.checked }))
                    }
                    className="mt-0.5 rounded border-kib-line bg-kib-raise text-kib-cyber focus:ring-kib-cyber"
                    disabled={!notifPrefs.email}
                  />
                  <span className={`text-sm ${!notifPrefs.email ? 'text-kib-muted' : 'text-kib-fg'}`}>
                    Daily market briefing (watchlist overview and ideas; host must schedule it)
                  </span>
                </label>
                {showHostDigestSmtpWarning && hostNotifCfg && (
                    <div className="rounded-lg border border-amber-500/35 bg-amber-950/25 px-3 py-2 text-xs leading-relaxed text-amber-100/95">
                      {!hostNotifCfg.dailyWatchlistDigestEnabled && (
                        <p className="m-0">
                          The daily digest job is{' '}
                          <strong className="font-semibold text-amber-50">off on this server</strong>
                          {hostNotifCfg.dailyWatchlistDigestCron != null &&
                          String(hostNotifCfg.dailyWatchlistDigestCron).length > 0
                            ? ` (schedule would be ${hostNotifCfg.dailyWatchlistDigestCron}, UTC)`
                            : ''}
                          . On the API host, remove{' '}
                          <code className="rounded bg-black/35 px-1 py-0.5 font-mono text-[11px]">
                            ENABLE_DAILY_WATCHLIST_DIGEST_EMAIL=false
                          </code>{' '}
                          and ensure{' '}
                          <code className="font-mono text-[11px]">DISABLE_DAILY_WATCHLIST_DIGEST_EMAIL</code>{' '}
                          is not true, then restart (e.g. <code className="font-mono text-[11px]">pm2 reload</code>
                          ). Digest is on by default once you deploy the latest API.
                        </p>
                      )}
                      {hostNotifCfg.dailyWatchlistDigestEnabled &&
                        hostNotifCfg.smtpConfigured === false && (
                          <p className="m-0 mt-2 first:mt-0">
                            SMTP is not configured on the host, so Grok summaries cannot be delivered by email.
                          </p>
                        )}
                    </div>
                  )}
              </div>
              <div className="mt-5 max-w-xs">
                <label className="mb-1 block text-xs font-medium text-slate-300">
                  Max suggested tranche % (1–50)
                </label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  step={1}
                  value={notifPrefs.agentMaxPositionSizePct}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v)) return;
                    setNotifPrefs((p) => ({
                      ...p,
                      agentMaxPositionSizePct: Math.min(50, Math.max(1, Math.round(v)))
                    }));
                  }}
                  className="block w-full rounded-md border border-kib-line bg-kib-raise px-3 py-2 text-sm text-kib-fg focus:outline-none focus:ring-2 focus:ring-kib-cyber"
                />
                <p className="mt-1 text-xs text-kib-muted">
                  Caps suggested sizing text in AI emails; not an order.
                </p>
              </div>
              <p className="mt-4 text-[11px] text-kib-muted">
                Briefings need SMTP plus Python/Grok on the host; daily briefing also needs the digest job enabled
                server-side.
              </p>
            </section>

            <button
              type="button"
              onClick={() => void handleSaveNotifications()}
              disabled={notifSaving}
              className="btn-primary disabled:opacity-50"
            >
              {notifSaving ? 'Saving…' : 'Save notification preferences'}
            </button>
          </div>
        </div>

        {/* Security Settings */}
        <div className="card">
          <h2 className="text-xl font-semibold text-kib-fg mb-4">Security</h2>
          
          {passwordMessage && (
            <div className={`mb-4 p-3 rounded-md font-mono text-sm ${
              passwordMessage.type === 'success'
                ? 'bg-emerald-950/40 border border-emerald-500/35 text-emerald-200'
                : 'bg-red-950/40 border border-red-500/35 text-red-200'
            }`}>
              {passwordMessage.text}
            </div>
          )}

          {!showChangePassword ? (
            <button
              onClick={() => setShowChangePassword(true)}
              className="btn-primary"
            >
              Change Password
            </button>
          ) : (
            <form onSubmit={handlePasswordChange} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300">
                  Current Password
                </label>
                <input
                  type="password"
                  required
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm(prev => ({ ...prev, currentPassword: e.target.value }))}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-robinhood-green-500 focus:border-robinhood-green-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300">
                  New Password
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm(prev => ({ ...prev, newPassword: e.target.value }))}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-robinhood-green-500 focus:border-robinhood-green-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  required
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-robinhood-green-500 focus:border-robinhood-green-500"
                />
              </div>
              
              <div className="flex space-x-3">
                <button
                  type="submit"
                  disabled={passwordLoading}
                  className="btn-primary disabled:opacity-50"
                >
                  {passwordLoading ? 'Changing...' : 'Change Password'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowChangePassword(false);
                    setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
                    setPasswordMessage(null);
                  }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;