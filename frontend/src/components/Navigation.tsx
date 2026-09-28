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
  XMarkIcon,
  ChatBubbleLeftRightIcon,
  CpuChipIcon,
  CommandLineIcon
} from '@heroicons/react/24/outline';

const Navigation: React.FC = () => {
  const { isAuthenticated, user, logout } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!isAuthenticated) {
    return null;
  }

  const displayName =
    (user?.username && String(user.username).trim()) ||
    [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() ||
    (user?.email ? user.email.split('@')[0] : 'Account');

  /** Primary app sections — may truncate on narrow desktops. */
  const mainNav = [
    { name: 'Dashboard', href: '/dashboard', icon: HomeIcon },
    { name: 'Quant AGI', href: '/quant-agi', icon: CpuChipIcon },
    { name: 'Stock Charts', href: '/charts', icon: ChartBarIcon },
    { name: 'Crypto Charts', href: '/crypto', icon: CurrencyDollarIcon },
    { name: 'Signals', href: '/opportunity-signals', icon: InboxIcon },
    { name: 'Chat', href: '/chat', icon: ChatBubbleLeftRightIcon }
  ];

  /** Always visible next to account controls (MCP immediately left of Profile). Deploy 2026-09-28. */
  const accountNav = [
    { name: 'MCP', href: '/mcp', icon: CommandLineIcon },
    { name: 'Profile', href: '/profile', icon: UserCircleIcon }
  ];

  const mobileNav = [...mainNav, ...accountNav];

  const isActive = (href: string) =>
    location.pathname === href ||
    (href === '/dashboard' && location.pathname === '/ai-agent') ||
    (href === '/mcp' && location.pathname.startsWith('/mcp'));

  const linkClass = (href: string) =>
    `flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
      isActive(href)
        ? 'bg-white/[0.08] text-kib-fg'
        : 'text-kib-muted hover:bg-white/[0.06] hover:text-kib-fg'
    }`;

  return (
    <nav data-build="20260928b" className="sticky top-0 z-50 nav-shell pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-14 max-w-[1360px] items-center justify-between gap-2 px-4 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <Link
            to="/dashboard"
            className="shrink-0 text-[15px] font-semibold tracking-tight text-kib-fg hover:text-white"
            onClick={() => setMobileOpen(false)}
          >
            KeepItBased
          </Link>

          <div className="hidden min-w-0 lg:flex lg:items-center lg:gap-0.5 lg:overflow-x-auto">
            {mainNav.map((item) => {
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

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <div className="hidden sm:flex sm:items-center sm:gap-0.5">
            {accountNav.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.name} to={item.href} className={linkClass(item.href)}>
                  <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                  {item.name}
                </Link>
              );
            })}
          </div>
          <span className="hidden truncate text-sm text-kib-muted xl:inline max-w-[160px]" title={user?.email}>
            {displayName}
          </span>
          <button
            type="button"
            className="flex rounded-md p-2 text-kib-muted hover:bg-white/[0.06] hover:text-kib-fg lg:hidden"
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
            <span className="hidden md:inline">Log out</span>
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-white/[0.06] lg:hidden">
          <div className="mx-auto max-w-[1360px] space-y-0.5 px-3 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
            {mobileNav.map((item) => {
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
