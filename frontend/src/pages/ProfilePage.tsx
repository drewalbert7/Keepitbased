import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../services/authService';

const ProfilePage: React.FC = () => {
  const { user } = useAuth();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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