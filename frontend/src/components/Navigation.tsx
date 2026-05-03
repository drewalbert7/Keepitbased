import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  ChartBarIcon,
  HomeIcon,
  UserCircleIcon,
  ArrowRightOnRectangleIcon,
  CurrencyDollarIcon,
  InboxIcon,
  Bars3Icon,
  XMarkIcon
} from '@heroicons/react/24/outline';

const Navigation: React.FC = () => {
  const { isAuthenticated, user, logout } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!isAuthenticated) {
    return null;
  }

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: HomeIcon },
    { name: 'Stock Charts', href: '/charts', icon: ChartBarIcon },
    { name: 'Crypto Charts', href: '/crypto', icon: CurrencyDollarIcon },
    { name: 'Signals', href: '/opportunity-signals', icon: InboxIcon },
    { name: 'Profile', href: '/profile', icon: UserCircleIcon }
  ];

  const isActive = (href: string) =>
    location.pathname === href || (href === '/dashboard' && location.pathname === '/ai-agent');

  const linkClass = (href: string) =>
    `flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
      isActive(href)
        ? 'bg-white/[0.08] text-kib-fg'
        : 'text-kib-muted hover:bg-white/[0.06] hover:text-kib-fg'
    }`;

  return (
    <nav className="sticky top-0 z-50 nav-shell pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-14 max-w-[1360px] items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link
            to="/dashboard"
            className="shrink-0 text-[15px] font-semibold tracking-tight text-kib-fg hover:text-white"
            onClick={() => setMobileOpen(false)}
          >
            KeepItBased
          </Link>

          <div className="hidden md:flex md:items-center md:gap-0.5">
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.name} to={item.href} className={linkClass(item.href)}>
                  <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                  {item.name}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden truncate text-sm text-kib-muted lg:inline max-w-[140px]" title={user?.email}>
            {user?.firstName}
          </span>
          <button
            type="button"
            className="flex md:hidden rounded-md p-2 text-kib-muted hover:bg-white/[0.06] hover:text-kib-fg"
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMobileOpen((o) => !o)}
          >
            {mobileOpen ? <XMarkIcon className="h-6 w-6" /> : <Bars3Icon className="h-6 w-6" />}
          </button>
          <button
            type="button"
            onClick={logout}
            className="hidden sm:flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-kib-muted hover:bg-white/[0.06] hover:text-kib-fg"
          >
            <ArrowRightOnRectangleIcon className="h-5 w-5" />
            Log out
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-white/[0.06] md:hidden">
          <div className="mx-auto max-w-[1360px] space-y-0.5 px-3 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  className={linkClass(item.href)}
                  onClick={() => setMobileOpen(false)}
                >
                  <Icon className="h-5 w-5 shrink-0 opacity-80" aria-hidden />
                  {item.name}
                </Link>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setMobileOpen(false);
                logout();
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium text-kib-muted hover:bg-white/[0.06] hover:text-kib-fg sm:hidden"
            >
              <ArrowRightOnRectangleIcon className="h-5 w-5" />
              Log out
            </button>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navigation;
