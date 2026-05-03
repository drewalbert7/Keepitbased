import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { authService } from '../services/authService';
import toast from 'react-hot-toast';

const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);

  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) {
      setTokenValid(false);
      toast.error('Invalid reset link. Please request a new password reset.');
      return;
    }
    
    // Token validation is implicit - if the token is invalid, the reset will fail
    setTokenValid(true);
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!token) {
      toast.error('Invalid reset token');
      return;
    }

    if (!password || !confirmPassword) {
      toast.error('Please fill in all fields');
      return;
    }

    if (password.length < 6) {
      toast.error('Password must be at least 6 characters long');
      return;
    }

    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const response = await authService.resetPassword(token, password);
      toast.success(response.message);
      
      // Redirect to login page after successful reset
      setTimeout(() => {
        navigate('/login');
      }, 2000);
      
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || 'Password reset failed. Please try again.';
      toast.error(errorMessage);
      
      // If token is invalid/expired, redirect to login after a delay
      if (error.response?.status === 400) {
        setTimeout(() => {
          navigate('/login');
        }, 3000);
      }
    } finally {
      setLoading(false);
    }
  };

  if (tokenValid === false) {
    return (
      <div className="relative z-10 flex min-h-screen items-center justify-center app-shell px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-8 rounded-2xl border border-white/[0.08] bg-kib-card/95 p-8 text-center shadow-soft backdrop-blur-sm">
          <div>
            <h1 className="text-4xl font-bold font-mono text-kib-fg mb-2 tracking-tight">
              <span className="text-kib-cyber">{'>'}</span> KeepItBased
            </h1>
            <h2 className="text-xl font-semibold font-mono text-red-300 mb-4 border border-red-500/35 inline-block px-3 py-2 rounded-lg bg-red-950/35">
              INVALID_RESET_LINK
            </h2>
            <p className="text-kib-muted mb-8">
              This password reset link is invalid or has expired. Please request a new password reset.
            </p>
            <Link
              to="/login"
              className="btn-primary inline-block"
            >
              Back to Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (tokenValid === null) {
    return (
      <div className="flex min-h-screen items-center justify-center app-shell">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-kib-line border-t-kib-cyber mx-auto mb-4"></div>
          <p className="text-kib-muted">Validating reset link...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center app-shell px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-white/[0.08] bg-kib-card/95 p-8 shadow-soft backdrop-blur-sm sm:p-10">
        <div className="text-center">
          <h1 className="text-4xl font-bold font-mono text-kib-fg mb-2 tracking-tight">
            <span className="text-kib-cyber">{'>'}</span> KeepItBased
          </h1>
          <h2 className="text-2xl font-semibold text-slate-300">Reset Your Password</h2>
          <p className="mt-2 text-kib-muted">
            Enter your new password below
          </p>
        </div>
        
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-300">
                New Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                className="input-field mt-1"
                placeholder="Enter your new password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
              />
              <p className="mt-1 text-xs text-slate-500">
                Password must be at least 6 characters long
              </p>
            </div>
            
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-300">
                Confirm New Password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                className="input-field mt-1"
                placeholder="Confirm your new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={6}
              />
            </div>
          </div>

          {password && confirmPassword && password !== confirmPassword && (
            <div className="text-sm text-red-200 bg-red-950/40 border border-red-500/35 p-3 rounded-md font-mono">
              Passwords do not match
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={loading || !password || !confirmPassword || password !== confirmPassword}
              className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Resetting Password...' : 'Reset Password'}
            </button>
          </div>

          <div className="text-center">
            <Link
              to="/login"
              className="text-sm text-robinhood-green hover:text-green-600"
            >
              Back to Login
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ResetPasswordPage;