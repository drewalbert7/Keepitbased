import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import toast from 'react-hot-toast';
import { useAuth } from './AuthContext';
import { getSocketOrigin } from '../config/apiBase';

type SocketContextValue = { socket: Socket | null };

const SocketContext = createContext<SocketContextValue>({ socket: null });

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token, isAuthenticated, user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);

  const toastOpportunities = user?.notificationPreferences?.opportunityToasts !== false;

  useEffect(() => {
    if (!isAuthenticated || !token) {
      setSocket(null);
      return undefined;
    }

    const sock = io(getSocketOrigin(), {
      transports: ['websocket', 'polling'],
      auth: { token },
      reconnectionAttempts: 8,
      reconnectionDelay: 1000
    });

    const onOpportunity = (payload: Record<string, unknown>) => {
      if (!toastOpportunities) return;
      const sym = typeof payload.symbol === 'string' ? payload.symbol : '?';
      const flags = Array.isArray(payload.flags) ? (payload.flags as string[]).join(', ') : 'signal';
      toast.success(`Opportunity: ${sym} — ${flags}`, { duration: 6500 });
    };

    sock.on('opportunitySignal', onOpportunity);
    /** Join backend room `price-updates`; tickers tracked server-side via watchlists. */
    sock.emit('subscribe', []);
    setSocket(sock);

    return () => {
      sock.off('opportunitySignal', onOpportunity);
      sock.disconnect();
      setSocket(null);
    };
  }, [isAuthenticated, token, toastOpportunities]);

  const value = useMemo(() => ({ socket }), [socket]);

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
};

export const useSocket = (): SocketContextValue => {
  return useContext(SocketContext);
};
