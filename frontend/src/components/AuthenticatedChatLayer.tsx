import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ChatProvider } from '../contexts/ChatContext';
import { FloatingChatDock } from './chat/FloatingChatDock';

/**
 * One ChatProvider for the whole signed-in session + floating dock overlay.
 */
export const AuthenticatedChatLayer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading || !isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <ChatProvider>
      {children}
      <FloatingChatDock />
    </ChatProvider>
  );
};
