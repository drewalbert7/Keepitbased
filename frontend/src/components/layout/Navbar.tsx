import React from 'react';
import { useAuth } from '../../contexts/AuthContext';

const Navbar: React.FC = () => {
  const { isAuthenticated, user, logout } = useAuth();

  if (!isAuthenticated) {
    return null;
  }

  return (
    <nav className="gradient-bg shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <h1 className="text-xl font-bold text-white">KeepItBased</h1>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-white">Welcome, {user?.firstName}</span>
            <button onClick={logout} className="text-white hover:text-gray-200">
              Logout
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;