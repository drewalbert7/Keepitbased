import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const { register, loading } = useAuth();
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    inviteCode: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.username || !formData.email || !formData.password || !formData.inviteCode) {
      toast.error('Please fill in all fields, including invitation code or passcode');
      return;
    }

    const u = formData.username.trim().toLowerCase();
    if (!USERNAME_RE.test(u)) {
      toast.error('Username: 3–32 characters, letters, numbers, or underscore only');
      return;
    }

    if (formData.inviteCode.trim().length < 8) {
      toast.error('Invitation code or passcode must be at least 8 characters');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (formData.password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    const result = await register(u, formData.email, formData.password, formData.inviteCode.trim());
    if (!result.ok) {
      toast.error(result.message);
    } else {
      toast.success('Account created successfully!');
      navigate('/dashboard', { replace: true });
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center app-shell px-4 py-12 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 rounded-2xl border border-white/[0.08] bg-kib-card/95 p-8 backdrop-blur-sm sm:p-10 shadow-soft">
        <div className="text-center">
          <h1 className="text-4xl font-bold font-mono text-kib-fg mb-2 tracking-tight">
            <span className="text-kib-cyber">{'>'}</span> KeepItBased
          </h1>
          <h2 className="text-2xl font-semibold text-slate-300">Create your account</h2>
          <p className="mt-2 text-kib-muted">Choose a username and use a host invite or a friend&apos;s passcode</p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-slate-300">
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              required
              minLength={3}
              maxLength={32}
              pattern="[a-zA-Z0-9_]{3,32}"
              className="input-field mt-1 font-mono"
              placeholder="e.g. dip_buyer_42"
              value={formData.username}
              onChange={handleChange}
            />
            <p className="mt-1 text-xs text-kib-muted">3–32 chars: letters, numbers, underscore. Stored lowercase.</p>
          </div>

          <div>
            <label htmlFor="inviteCode" className="block text-sm font-medium text-slate-300">
              Invitation code or passcode
            </label>
            <input
              id="inviteCode"
              name="inviteCode"
              type="password"
              autoComplete="off"
              required
              minLength={8}
              maxLength={512}
              className="input-field mt-1 font-mono"
              placeholder="Host invite (12+) or friend passcode (8+)"
              value={formData.inviteCode}
              onChange={handleChange}
            />
            <p className="mt-1 text-xs text-kib-muted">
              Use the shared host invite from your operator, or a passcode a current user created in Profile → Invite
              friends.
            </p>
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-300">
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
              value={formData.email}
              onChange={handleChange}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-300">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              className="input-field mt-1"
              placeholder="Create a password"
              value={formData.password}
              onChange={handleChange}
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-300">
              Confirm password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              className="input-field mt-1"
              placeholder="Confirm your password"
              value={formData.confirmPassword}
              onChange={handleChange}
            />
          </div>

          <div>
            <button type="submit" disabled={loading} className="w-full btn-primary">
              {loading ? 'Creating account...' : 'Create account'}
            </button>
          </div>

          <div className="text-center">
            <p className="text-sm text-kib-muted">
              Already have an account?{' '}
              <Link to="/login" className="font-medium text-kib-cyber hover:text-kib-glow">
                Sign in
              </Link>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RegisterPage;
