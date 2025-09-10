import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../services/authService';
import toast from 'react-hot-toast';

const LoginPage: React.FC = () => {
  const { login, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showRecovery, setShowRecovery] = useState<'username' | 'password' | null>(null);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast.error('Please fill in all fields');
      return;
    }

    const success = await login(email, password);
    if (!success) {
      toast.error('Invalid email or password');
    } else {
      toast.success('Welcome back!');
    }
  };

  const handleRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!recoveryEmail) {
      toast.error('Please enter your email address');
      return;
    }

    setRecoveryLoading(true);

    try {
      if (showRecovery === 'username') {
        const response = await authService.recoverUsername(recoveryEmail);
        toast.success(response.message);
      } else if (showRecovery === 'password') {
        const response = await authService.recoverPassword(recoveryEmail);
        toast.success(response.message);
      }
      
      setShowRecovery(null);
      setRecoveryEmail('');
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || 'Recovery request failed';
      toast.error(errorMessage);
    } finally {
      setRecoveryLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-robinhood-gray-900 mb-2">KeepItBased</h1>
          <h2 className="text-2xl font-semibold text-robinhood-gray-700">
            {showRecovery ? (
              showRecovery === 'username' ? 'Recover Username' : 'Reset Password'
            ) : (
              'Sign in to your account'
            )}
          </h2>
          <p className="mt-2 text-robinhood-gray-600">
            {showRecovery ? (
              showRecovery === 'username' 
                ? 'Enter your email to receive your username' 
                : 'Enter your email to receive reset instructions'
            ) : (
              'Never miss a buying opportunity'
            )}
          </p>
        </div>
        
        {showRecovery ? (
          <form className="mt-8 space-y-6" onSubmit={handleRecoverySubmit}>
            <div>
              <label htmlFor="recovery-email" className="block text-sm font-medium text-robinhood-gray-700">
                Email address
              </label>
              <input
                id="recovery-email"
                name="recovery-email"
                type="email"
                autoComplete="email"
                required
                className="input-field mt-1"
                placeholder="Enter your email"
                value={recoveryEmail}
                onChange={(e) => setRecoveryEmail(e.target.value)}
              />
            </div>

            <div className="space-y-3">
              <button
                type="submit"
                disabled={recoveryLoading}
                className="w-full btn-primary"
              >
                {recoveryLoading ? (
                  showRecovery === 'username' ? 'Sending username...' : 'Sending reset link...'
                ) : (
                  showRecovery === 'username' ? 'Send Username' : 'Send Reset Link'
                )}
              </button>
              
              <button
                type="button"
                onClick={() => {
                  setShowRecovery(null);
                  setRecoveryEmail('');
                }}
                className="w-full btn-secondary"
              >
                Back to Login
              </button>
            </div>
          </form>
        ) : (
          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-robinhood-gray-700">
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="input-field mt-1"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-robinhood-gray-700">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="input-field mt-1"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full btn-primary"
              >
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </div>

            <div className="space-y-3">
              {/* Recovery Options */}
              <div className="flex space-x-4 justify-center">
                <button
                  type="button"
                  onClick={() => setShowRecovery('username')}
                  className="text-sm text-robinhood-green hover:text-green-600 underline"
                >
                  Forgot Username?
                </button>
                <span className="text-robinhood-gray-400">•</span>
                <button
                  type="button"
                  onClick={() => setShowRecovery('password')}
                  className="text-sm text-robinhood-green hover:text-green-600 underline"
                >
                  Forgot Password?
                </button>
              </div>

              {/* Sign Up Link */}
              <div className="text-center">
                <p className="text-sm text-robinhood-gray-600">
                  Don't have an account?{' '}
                  <Link to="/register" className="font-medium text-robinhood-green hover:text-green-600">
                    Sign up
                  </Link>
                </p>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default LoginPage;