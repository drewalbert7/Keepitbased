import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { 
  ChartBarIcon, 
  BellIcon, 
  HomeIcon, 
  UserCircleIcon,
  ArrowRightOnRectangleIcon,
  CurrencyDollarIcon
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
    { name: 'Alerts', href: '/alerts', icon: BellIcon },
    { name: 'Profile', href: '/profile', icon: UserCircleIcon },
  ];

  const isActive = (href: string) => location.pathname === href;

  return (
    <nav className="gradient-bg shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Link to="/dashboard" className="text-xl font-bold text-white hover:text-gray-200">
              KeepItBased
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
                        ? 'bg-white bg-opacity-20 text-white'
                        : 'text-gray-200 hover:bg-white hover:bg-opacity-10 hover:text-white'
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
            <span className="text-white text-sm">Welcome, {user?.firstName}</span>
            <button
              onClick={logout}
              className="flex items-center px-3 py-2 rounded-md text-sm font-medium text-gray-200 hover:bg-white hover:bg-opacity-10 hover:text-white transition-colors"
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
                      ? 'bg-white bg-opacity-20 text-white'
                      : 'text-gray-200 hover:bg-white hover:bg-opacity-10 hover:text-white'
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