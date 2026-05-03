import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../services/authService';

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
    dipInsightEmail: true,
    researchDigestEmail: false,
    dailyWatchlistDigestEmail: false,
    agentMaxPositionSizePct: 10
  });
  const [notifSaving, setNotifSaving] = useState(false);

  useEffect(() => {
    if (!user?.notificationPreferences) return;
    const n = user.notificationPreferences;
    const pctRaw = n.agentMaxPositionSizePct;
    const pct =
      typeof pctRaw === 'number' && Number.isFinite(pctRaw)
        ? Math.min(50, Math.max(1, Math.round(pctRaw)))
        : 10;
    setNotifPrefs({
      email: n.email !== false,
      push: n.push !== false,
      opportunityToasts: n.opportunityToasts !== false,
      dipInsightEmail: n.dipInsightEmail !== false,
      researchDigestEmail: n.researchDigestEmail === true,
      dailyWatchlistDigestEmail: n.dailyWatchlistDigestEmail === true,
      agentMaxPositionSizePct: pct
    });
  }, [user]);

  const handleSaveNotifications = async () => {
    setNotifSaving(true);
    try {
      const updated = await authService.updateProfile({ notificationPreferences: notifPrefs });
      updateUser({ notificationPreferences: updated.notificationPreferences });
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
              <label className="block text-sm font-medium text-slate-300">First Name</label>
              <div className="mt-1 text-kib-fg">{user?.firstName}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">Last Name</label>
              <div className="mt-1 text-kib-fg">{user?.lastName}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">Email</label>
              <div className="mt-1 text-kib-fg">{user?.email}</div>
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
          <h2 className="text-xl font-semibold text-kib-fg mb-2">Notifications</h2>
          <p className="text-sm text-kib-muted mb-4">
            Opportunity toasts fire when price action matches your alert baseline (deduped hourly). Signals are always saved for review.
          </p>
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={notifPrefs.email}
                onChange={(e) => setNotifPrefs((p) => ({ ...p, email: e.target.checked }))}
                className="rounded border-kib-line bg-kib-raise text-kib-cyber focus:ring-kib-cyber"
              />
              <span className="text-kib-fg">
                Email alerts (price alerts + opportunity signal emails)
              </span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={notifPrefs.push}
                onChange={(e) => setNotifPrefs((p) => ({ ...p, push: e.target.checked }))}
                className="rounded border-kib-line bg-kib-raise text-kib-cyber focus:ring-kib-cyber"
              />
              <span className="text-kib-fg">Push notifications</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
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

            <div className="pt-4 mt-4 border-t border-kib-line">
              <h3 className="text-sm font-semibold text-kib-fg mb-1">Dip briefing emails (Grok)</h3>
              <p className="text-xs text-kib-muted mb-3">
                When your symbol hits a deterministic dip vs baseline, we can send a richer email with a short
                Grok briefing (including X context via x_search), suggested tranche % (capped below), and links.
                Requires <code className="text-kib-fg/90">ENABLE_DIP_INSIGHT_EMAIL</code> on the server. If that
                flag is off, the toggle has no effect.
              </p>
              <label className="flex items-center gap-3 cursor-pointer mb-4">
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
                  Use Grok dip briefing email (instead of short opportunity-only email when enabled)
                </span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer mb-2">
                <input
                  type="checkbox"
                  checked={notifPrefs.researchDigestEmail}
                  onChange={(e) =>
                    setNotifPrefs((p) => ({ ...p, researchDigestEmail: e.target.checked }))
                  }
                  className="rounded border-kib-line bg-kib-raise text-kib-cyber focus:ring-kib-cyber"
                  disabled={!notifPrefs.email || !notifPrefs.dipInsightEmail}
                />
                <span
                  className={`text-kib-fg text-sm ${!notifPrefs.email || !notifPrefs.dipInsightEmail ? 'opacity-50' : ''}`}
                >
                  Require stored news for Grok email (fusion gate — at least one headline in our DB for that symbol
                  in the server lookback window; otherwise you get the short opportunity email only)
                </span>
              </label>
              <label className="flex items-start gap-3 cursor-pointer mb-2">
                <input
                  type="checkbox"
                  checked={notifPrefs.dailyWatchlistDigestEmail}
                  onChange={(e) =>
                    setNotifPrefs((p) => ({ ...p, dailyWatchlistDigestEmail: e.target.checked }))
                  }
                  className="mt-0.5 rounded border-kib-line bg-kib-raise text-kib-cyber focus:ring-kib-cyber"
                  disabled={!notifPrefs.email}
                />
                <span className={`text-kib-fg text-sm ${!notifPrefs.email ? 'opacity-50' : ''}`}>
                  Daily watchlist digest email (Grok overview of your tracked symbols + a few research ideas not on
                  your list). Requires <code className="text-kib-fg/90">ENABLE_DAILY_WATCHLIST_DIGEST_EMAIL</code> and a
                  configured Python service with Grok.
                </span>
              </label>
              <div className="max-w-xs">
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Max portfolio % for suggested tranche (1–50)
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
                  className="block w-full px-3 py-2 rounded-md border border-kib-line bg-kib-raise text-kib-fg text-sm focus:outline-none focus:ring-2 focus:ring-kib-cyber"
                />
                <p className="text-xs text-kib-muted mt-1">
                  Caps the model&apos;s suggested allocation line in the email; not a buy order.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSaveNotifications}
              disabled={notifSaving}
              className="btn-primary mt-2 disabled:opacity-50"
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