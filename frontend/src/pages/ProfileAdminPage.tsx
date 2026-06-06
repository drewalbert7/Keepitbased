import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../services/authService';
import type { AdminInvitesOverview, AdminUserRow } from '../types';

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function displayUser(row: { username: string | null; email: string }): string {
  if (row.username) return `@${row.username}`;
  return row.email;
}

const ProfileAdminPage: React.FC = () => {
  const { user, updateUser } = useAuth();
  const [invites, setInvites] = useState<AdminInvitesOverview | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [usersLimit, setUsersLimit] = useState(500);
  const [loadingInvites, setLoadingInvites] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [adminBusyId, setAdminBusyId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await authService.getAdminInvites();
        if (!cancelled) setInvites(data);
      } catch {
        if (!cancelled) toast.error('Could not load invite codes');
      } finally {
        if (!cancelled) setLoadingInvites(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await authService.getAdminUsers();
        if (!cancelled) {
          setUsers(data.users);
          setUsersLimit(data.limit);
        }
      } catch {
        if (!cancelled) toast.error('Could not load users');
      } finally {
        if (!cancelled) setLoadingUsers(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!user?.isSignupInviteAdmin) {
    return <Navigate to="/profile" replace />;
  }

  const handleAdminToggle = async (row: AdminUserRow) => {
    const nextAdmin = !row.isSignupInviteAdmin;
    if (!nextAdmin) {
      const ok = window.confirm(
        `Revoke administrator access for ${row.email}? They will lose access to this panel.`
      );
      if (!ok) return;
    }

    setAdminBusyId(row.id);
    try {
      const res = await authService.setUserSignupAdmin(row.id, nextAdmin);
      toast.success(res.message);
      setUsers((prev) =>
        prev.map((u) => (u.id === row.id ? { ...u, isSignupInviteAdmin: nextAdmin } : u))
      );
      if (user?.id === row.id) {
        updateUser({ isSignupInviteAdmin: nextAdmin });
      }
    } catch (err: unknown) {
      const msg =
        typeof err === 'object' && err !== null && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      toast.error(msg || 'Could not update administrator access');
    } finally {
      setAdminBusyId(null);
    }
  };

  const personalCount = invites?.personalPasscodes.length ?? 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <nav className="mb-6 text-sm text-kib-muted">
        <Link to="/profile" className="text-kib-cyber hover:text-kib-glow">
          ← Profile
        </Link>
      </nav>

      <h1 className="text-2xl font-bold text-kib-fg">Administration</h1>
      <p className="mt-2 text-sm text-kib-muted max-w-2xl">
        Invite codes and user accounts for this host. Passcodes are stored as hashes only — you cannot recover
        plaintext from here. After rotating the host invite, copy the new code from your password manager.
      </p>

      {/* Active invite codes */}
      <section className="card mt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-kib-fg">Active invite codes</h2>
            <p className="text-sm text-kib-muted mt-1">
              Host invite plus personal passcodes users set under Profile → Invite friends.
            </p>
          </div>
          <Link
            to="/profile/signup-invite-admin"
            className="inline-flex shrink-0 items-center rounded-md border border-white/15 bg-white/[0.04] px-3 py-2 text-sm font-medium text-kib-fg hover:border-kib-cyber/50 hover:bg-white/[0.07]"
          >
            Rotate host invite code →
          </Link>
        </div>

        {loadingInvites ? (
          <p className="text-sm text-kib-muted mt-4">Loading invite codes…</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-kib-line text-left text-kib-muted">
                  <th className="py-3 pr-4 font-medium">Type</th>
                  <th className="py-3 pr-4 font-medium">Status</th>
                  <th className="py-3 pr-4 font-medium">Owner</th>
                  <th className="py-3 font-medium">Last updated</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-800">
                  <td className="py-3 pr-4 font-medium text-kib-fg">Host (global)</td>
                  <td className="py-3 pr-4">
                    {invites?.globalInvite.active ? (
                      <span className="text-emerald-300">Active</span>
                    ) : (
                      <span className="text-amber-200">Not configured</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-kib-muted">Shared operator invite</td>
                  <td className="py-3 text-slate-300 whitespace-nowrap">
                    {formatWhen(invites?.globalInvite.updatedAt)}
                  </td>
                </tr>
                {personalCount === 0 ? (
                  <tr className="border-b border-slate-800">
                    <td colSpan={4} className="py-4 text-kib-muted">
                      No personal signup passcodes are active.
                    </td>
                  </tr>
                ) : (
                  invites?.personalPasscodes.map((row) => (
                    <tr key={row.userId} className="border-b border-slate-800">
                      <td className="py-3 pr-4 font-medium text-kib-fg">Personal</td>
                      <td className="py-3 pr-4">
                        <span className="text-emerald-300">Active</span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-kib-fg">{displayUser(row)}</span>
                        <span className="block text-xs text-kib-muted font-mono">{row.email}</span>
                      </td>
                      <td className="py-3 text-slate-300 whitespace-nowrap">{formatWhen(row.updatedAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Users */}
      <section className="card mt-6">
        <h2 className="text-lg font-semibold text-kib-fg">Users</h2>
        <p className="text-sm text-kib-muted mt-1">
          All accounts on this host
          {users.length >= usersLimit ? ` (showing newest ${usersLimit})` : ` (${users.length})`}. Grant or revoke
          administrator access for invite management and this panel.
        </p>

        {loadingUsers ? (
          <p className="text-sm text-kib-muted mt-4">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-kib-muted mt-4">No users found.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-kib-line text-left text-kib-muted">
                  <th className="py-3 pr-4 font-medium">User</th>
                  <th className="py-3 pr-4 font-medium">Email</th>
                  <th className="py-3 pr-4 font-medium">Joined</th>
                  <th className="py-3 pr-4 font-medium">Invited by</th>
                  <th className="py-3 pr-4 font-medium">Passcode</th>
                  <th className="py-3 pr-4 font-medium">Invitees</th>
                  <th className="py-3 font-medium">Admin</th>
                </tr>
              </thead>
              <tbody>
                {users.map((row) => (
                  <tr key={row.id} className="border-b border-slate-800">
                    <td className="py-3 pr-4">
                      <span className="font-medium text-kib-fg">
                        {row.username ? `@${row.username}` : '—'}
                      </span>
                      {row.isSignupInviteAdmin ? (
                        <span className="ml-2 rounded border border-kib-cyber/40 bg-kib-cyber/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-kib-cyber">
                          admin
                        </span>
                      ) : null}
                      <span className="block text-xs text-kib-muted">id {row.id}</span>
                    </td>
                    <td className="py-3 pr-4 font-mono text-slate-300">{row.email}</td>
                    <td className="py-3 pr-4 text-slate-300 whitespace-nowrap">{formatWhen(row.createdAt)}</td>
                    <td className="py-3 pr-4 text-slate-300">
                      {row.invitedByUserId ? (
                        <>
                          {row.invitedByUsername ? `@${row.invitedByUsername}` : row.invitedByEmail || '—'}
                          <span className="block text-xs text-kib-muted">id {row.invitedByUserId}</span>
                        </>
                      ) : (
                        <span className="text-kib-muted">Host invite</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {row.personalPasscodeActive ? (
                        <span className="text-emerald-300">Active</span>
                      ) : (
                        <span className="text-kib-muted">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-slate-300">{row.inviteesCount}</td>
                    <td className="py-3">
                      <button
                        type="button"
                        disabled={adminBusyId === row.id}
                        onClick={() => void handleAdminToggle(row)}
                        className={
                          row.isSignupInviteAdmin
                            ? 'rounded-md border border-amber-500/40 bg-amber-950/30 px-2.5 py-1 text-xs font-medium text-amber-100 hover:bg-amber-950/50 disabled:opacity-50'
                            : 'rounded-md border border-kib-cyber/40 bg-kib-cyber/10 px-2.5 py-1 text-xs font-medium text-kib-cyber hover:bg-kib-cyber/20 disabled:opacity-50'
                        }
                      >
                        {adminBusyId === row.id
                          ? '…'
                          : row.isSignupInviteAdmin
                            ? 'Revoke'
                            : 'Make admin'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default ProfileAdminPage;
