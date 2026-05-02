import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  ChartBarIcon,
  HomeIcon,
  UserCircleIcon,
  ArrowRightOnRectangleIcon,
  CurrencyDollarIcon,
  InboxIcon
} from '@heroicons/react/24/outline';

const Navigation: React.FC = () => {
  const { isAuthenticated, user, logout } = useAuth();
  const location = useLocation();

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

  const isActive = (href: string) => location.pathname === href || (href === '/dashboard' && location.pathname === '/ai-agent');

  return (
    <nav className="gradient-bg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Link to="/dashboard" className="font-mono text-lg font-semibold tracking-tight text-white hover:text-kib-cyber transition-colors">
              {'>'} KEEPITBASED<span className="text-kib-cyber animate-pulse">_</span>
            </Link>
            
            {/* Navigation Links */}
            <div className="hidden md:ml-8 md:flex md:space-x-1">
              {navigation.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.name}
                    to={item.href}
                    className={`flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive(item.href)
                        ? 'bg-kib-cyber/15 text-kib-cyber border border-kib-cyber/25'
                        : 'text-slate-300 hover:bg-kib-cyber/10 hover:text-kib-cyber border border-transparent'
                    }`}
                  >
                    <Icon className="w-5 h-5 mr-2" />
                    {item.name}
                  </Link>
                );
              })}
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <span className="text-kib-muted text-sm hidden sm:inline">
              <span className="font-mono text-kib-cyber/70">●</span> {user?.firstName}
            </span>
            <button
              onClick={logout}
              className="flex items-center px-3 py-2 rounded-md text-sm font-medium text-slate-300 hover:bg-kib-cyber/10 hover:text-kib-cyber border border-transparent transition-colors"
            >
              <ArrowRightOnRectangleIcon className="w-5 h-5 mr-2" />
              Logout
            </button>
          </div>
        </div>
        
        {/* Mobile menu */}
        <div className="md:hidden">
          <div className="px-2 pt-2 pb-3 space-y-1">
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  className={`flex items-center px-3 py-2 rounded-md text-base font-medium transition-colors ${
                    isActive(item.href)
                      ? 'bg-kib-cyber/15 text-kib-cyber border border-kib-cyber/25'
                      : 'text-slate-300 hover:bg-kib-cyber/10 hover:text-kib-cyber border border-transparent'
                  }`}
                >
                  <Icon className="w-5 h-5 mr-2" />
                  {item.name}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navigation;