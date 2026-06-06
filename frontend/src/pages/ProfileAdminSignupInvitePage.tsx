import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../services/authService';

const ProfileAdminSignupInvitePage: React.FC = () => {
  const { user } = useAuth();
  const [status, setStatus] = useState<{ configured: boolean; updatedAt: string | null } | null>(
    null
  );
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    newInviteCode: '',
    confirmInviteCode: '',
    currentPassword: ''
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await authService.getAdminSignupInviteStatus();
        if (!cancelled) setStatus(s);
      } catch {
        if (!cancelled) toast.error('Could not load invite status');
      } finally {
        if (!cancelled) setLoadingStatus(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!user?.isSignupInviteAdmin) {
    return <Navigate to="/profile" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (form.newInviteCode.trim().length < 12 || form.confirmInviteCode.trim().length < 12) {
      toast.error('New invitation code must be at least 12 characters');
      return;
    }

    if (form.newInviteCode !== form.confirmInviteCode) {
      toast.error('New codes do not match');
      return;
    }

    if (!form.currentPassword) {
      toast.error('Enter your account password');
      return;
    }

    setSubmitting(true);
    try {
      const res = await authService.rotateSignupInvite(
        form.newInviteCode.trim(),
        form.currentPassword
      );
      setStatus({
        configured: res.configured,
        updatedAt: res.updatedAt
      });
      setForm({ newInviteCode: '', confirmInviteCode: '', currentPassword: '' });
      toast.success(res.message || 'Invitation code updated');
    } catch (err: unknown) {
      const msg =
        typeof err === 'object' && err !== null && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      toast.error(msg || 'Could not update code');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <nav className="mb-6 text-sm text-kib-muted">
        <Link to="/profile/admin" className="text-kib-cyber hover:text-kib-glow">
          ← Admin
        </Link>
        <span className="mx-2 text-kib-line">·</span>
        <Link to="/profile" className="text-kib-muted hover:text-kib-fg">
          Profile
        </Link>
      </nav>

      <h1 className="text-2xl font-bold text-kib-fg">Signup invitation code</h1>
      <p className="mt-2 text-sm text-kib-muted">
        This page is hidden from scrapers — it only appears for administrators. The invitation code itself
        is never sent to the browser; only you supply a new one here. Rotate it periodically and share only
        with people who should join.
      </p>
      <p className="mt-2 text-sm text-kib-muted">
        Separately, any user can create a <strong>personal signup passcode</strong> under Profile → Invite friends.
        Registration accepts <em>either</em> this global code <em>or</em> a valid personal passcode (8+ characters).
      </p>

      <div className="card mt-6 space-y-4">
        <div className="text-sm text-kib-fg">
          {loadingStatus ? (
            <span className="text-kib-muted">Loading status…</span>
          ) : (
            <>
              <p>
                <span className="text-kib-muted">Invite signup:</span>{' '}
                {status?.configured ? (
                  <span className="text-emerald-300">Active (hashed on server)</span>
                ) : (
                  <span className="text-amber-200">Not configured — set INVITE_SIGNUP_CODE or rotate below</span>
                )}
              </p>
              {status?.updatedAt ? (
                <p className="text-xs text-kib-muted mt-1">
                  Last changed (UTC-ish):{' '}
                  <span className="font-mono text-kib-fg/90">{status.updatedAt}</span>
                </p>
              ) : null}
            </>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 pt-4 border-t border-kib-line">
          <div>
            <label className="block text-sm font-medium text-slate-300">New invitation code</label>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={512}
              className="input-field mt-1 font-mono"
              value={form.newInviteCode}
              onChange={(e) => setForm((f) => ({ ...f, newInviteCode: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300">Confirm new code</label>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={512}
              className="input-field mt-1 font-mono"
              value={form.confirmInviteCode}
              onChange={(e) => setForm((f) => ({ ...f, confirmInviteCode: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300">
              Your login password <span className="text-xs text-kib-muted">(confirms rotation)</span>
            </label>
            <input
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              className="input-field mt-1 font-mono"
              value={form.currentPassword}
              onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))}
            />
          </div>

          <button type="submit" disabled={submitting || loadingStatus} className="btn-primary w-full sm:w-auto">
            {submitting ? 'Saving…' : 'Save new invitation code'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ProfileAdminSignupInvitePage;
