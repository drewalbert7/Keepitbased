import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import Navigation from './components/Navigation';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import ProfilePage from './pages/ProfilePage';
import ProfileAdminSignupInvitePage from './pages/ProfileAdminSignupInvitePage';
import { ChartPage } from './pages/ChartPage';
import { CryptoPage } from './pages/CryptoPage';
import AIAgentPage from './pages/AIAgentPage';
import OpportunitySignalsPage from './pages/OpportunitySignalsPage';
import LoadingSpinner from './components/ui/LoadingSpinner';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();
  
  if (loading) {
    return <LoadingSpinner />;
  }
  
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
};

const PublicRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();
  
  if (loading) {
    return <LoadingSpinner />;
  }
  
  return isAuthenticated ? <Navigate to="/dashboard" /> : <>{children}</>;
};

const AppRoutes: React.FC = () => {
  return (
    <Router>
      <div className="relative min-h-screen text-kib-fg app-shell">
        <Navigation />
        <main>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={
              <PublicRoute>
                <LoginPage />
              </PublicRoute>
            } />
            <Route path="/register" element={
              <PublicRoute>
                <RegisterPage />
              </PublicRoute>
            } />
            <Route path="/reset-password" element={
              <PublicRoute>
                <ResetPasswordPage />
              </PublicRoute>
            } />
            <Route path="/dashboard" element={
              <ProtectedRoute>
                <SocketProvider>
                  <AIAgentPage />
                </SocketProvider>
              </ProtectedRoute>
            } />
            <Route path="/ai-agent" element={<Navigate to="/dashboard" replace />} />
            <Route path="/profile" element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            } />
            <Route path="/profile/signup-invite-admin" element={
              <ProtectedRoute>
                <ProfileAdminSignupInvitePage />
              </ProtectedRoute>
            } />
            <Route path="/charts" element={
              <ProtectedRoute>
                <SocketProvider>
                  <ChartPage />
                </SocketProvider>
              </ProtectedRoute>
            } />
            <Route path="/crypto" element={
              <ProtectedRoute>
                <SocketProvider>
                  <CryptoPage />
                </SocketProvider>
              </ProtectedRoute>
            } />
            <Route path="/opportunity-signals" element={
              <ProtectedRoute>
                <SocketProvider>
                  <OpportunitySignalsPage />
                </SocketProvider>
              </ProtectedRoute>
            } />
          </Routes>
        </main>
        <Toaster 
          position="top-center"
          containerStyle={{ top: 'max(12px, env(safe-area-inset-top))' }}
          toastOptions={{
            duration: 4000,
            style: {
              background: '#161b22',
              color: '#e6edf3',
              borderRadius: '8px',
              border: '1px solid rgba(240, 246, 252, 0.1)',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
              maxWidth: 'min(100vw - 24px, 420px)',
            },
            success: {
              iconTheme: {
                primary: '#00c805',
                secondary: '#0c1526',
              },
            },
            error: {
              iconTheme: {
                primary: '#ff5000',
                secondary: '#0c1526',
              },
            },
          }}
        />
      </div>
    </Router>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
};

export default App;
