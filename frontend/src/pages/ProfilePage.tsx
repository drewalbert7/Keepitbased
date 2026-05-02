import React, { useEffect, useState } from 'react';
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
    opportunityToasts: true
  });
  const [notifSaving, setNotifSaving] = useState(false);

  useEffect(() => {
    if (!user?.notificationPreferences) return;
    const n = user.notificationPreferences;
    setNotifPrefs({
      email: n.email !== false,
      push: n.push !== false,
      opportunityToasts: n.opportunityToasts !== false
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-robinhood-gray-900">Profile</h1>
        <p className="text-robinhood-gray-600 mt-2">Manage your account settings</p>
      </div>
      
      <div className="space-y-6">
        {/* User Information */}
        <div className="card">
          <h2 className="text-xl font-semibold text-robinhood-gray-900 mb-4">Account Information</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-robinhood-gray-700">First Name</label>
              <div className="mt-1 text-robinhood-gray-900">{user?.firstName}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-robinhood-gray-700">Last Name</label>
              <div className="mt-1 text-robinhood-gray-900">{user?.lastName}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-robinhood-gray-700">Email</label>
              <div className="mt-1 text-robinhood-gray-900">{user?.email}</div>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="card">
          <h2 className="text-xl font-semibold text-robinhood-gray-900 mb-2">Notifications</h2>
          <p className="text-sm text-robinhood-gray-600 mb-4">
            Opportunity toasts fire when price action matches your alert baseline (deduped hourly). Signals are always saved for review.
          </p>
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={notifPrefs.email}
                onChange={(e) => setNotifPrefs((p) => ({ ...p, email: e.target.checked }))}
                className="rounded border-gray-300 text-robinhood-green focus:ring-robinhood-green"
              />
              <span className="text-robinhood-gray-800">
                Email alerts (price alerts + opportunity signal emails)
              </span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={notifPrefs.push}
                onChange={(e) => setNotifPrefs((p) => ({ ...p, push: e.target.checked }))}
                className="rounded border-gray-300 text-robinhood-green focus:ring-robinhood-green"
              />
              <span className="text-robinhood-gray-800">Push notifications</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={notifPrefs.opportunityToasts}
                onChange={(e) =>
                  setNotifPrefs((p) => ({ ...p, opportunityToasts: e.target.checked }))
                }
                className="rounded border-gray-300 text-robinhood-green focus:ring-robinhood-green"
              />
              <span className="text-robinhood-gray-800">In-app opportunity toasts</span>
            </label>
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
          <h2 className="text-xl font-semibold text-robinhood-gray-900 mb-4">Security</h2>
          
          {passwordMessage && (
            <div className={`mb-4 p-3 rounded-md ${
              passwordMessage.type === 'success' 
                ? 'bg-green-50 border border-green-200 text-green-800' 
                : 'bg-red-50 border border-red-200 text-red-800'
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
                <label className="block text-sm font-medium text-robinhood-gray-700">
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
                <label className="block text-sm font-medium text-robinhood-gray-700">
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
                <label className="block text-sm font-medium text-robinhood-gray-700">
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