import React, { createContext, useContext, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import toast from 'react-hot-toast';
import { useAuth } from './AuthContext';
import { getSocketOrigin } from '../config/apiBase';

type SocketContextValue = { socket: Socket | null };

const SocketContext = createContext<SocketContextValue | undefined>(undefined);

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token, isAuthenticated, user } = useAuth();
  const socketRef = useRef<Socket | null>(null);

  const toastOpportunities =
    user?.notificationPreferences?.opportunityToasts !== false;

  useEffect(() => {
    if (!isAuthenticated || !token) {
      return undefined;
    }

    const socket = io(getSocketOrigin(), {
      transports: ['websocket', 'polling'],
      auth: { token },
      reconnectionAttempts: 8,
      reconnectionDelay: 1000
    });

    socket.on('opportunitySignal', (payload: Record<string, unknown>) => {
      if (!toastOpportunities) return;
      const sym = typeof payload.symbol === 'string' ? payload.symbol : '?';
      const flags = Array.isArray(payload.flags) ? (payload.flags as string[]).join(', ') : 'signal';
      toast.success(`Opportunity: ${sym} — ${flags}`, { duration: 6500 });
    });

    socket.emit('subscribe', []);
    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [isAuthenticated, token, toastOpportunities]);

  const value: SocketContextValue = { socket: socketRef.current };

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
};

export const useSocket = (): SocketContextValue => {
  const ctx = useContext(SocketContext);
  if (!ctx) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return ctx;
};
