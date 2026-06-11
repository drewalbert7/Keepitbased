import { io, type Socket } from "socket.io-client";
import { getKeepItBasedJwt } from "./quantAuth";
import { onAuthTokenReady } from "./authBridge";

export type PaperBotSocketUpdate = {
  ts: string;
  eventType: string;
  hint?: string | null;
};

function socketOrigin(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

export function connectPaperBotSocket(handlers: {
  onUpdate: (payload: PaperBotSocketUpdate) => void;
  onConnected?: (connected: boolean) => void;
}): () => void {
  if (typeof window === "undefined") return () => undefined;

  let socket: Socket | null = null;
  let disposed = false;

  const connect = () => {
    if (disposed) return;
    const token = getKeepItBasedJwt();
    if (!token) {
      socket?.disconnect();
      socket = null;
      handlers.onConnected?.(false);
      return;
    }
    if (socket?.connected) return;

    socket?.disconnect();
    socket = io(socketOrigin(), {
      transports: ["websocket", "polling"],
      auth: { token },
      reconnectionAttempts: 8,
      reconnectionDelay: 1000
    });

    socket.on("connect", () => handlers.onConnected?.(true));
    socket.on("disconnect", () => handlers.onConnected?.(false));
    socket.on("connect_error", () => handlers.onConnected?.(false));
    socket.on("paperBotUpdate", (payload: PaperBotSocketUpdate) => {
      if (!payload || typeof payload !== "object") return;
      handlers.onUpdate({
        ts: typeof payload.ts === "string" ? payload.ts : new Date().toISOString(),
        eventType: String(payload.eventType || "update"),
        hint: payload.hint ?? null
      });
    });
  };

  connect();
  const offAuth = onAuthTokenReady(connect);
  const retry = window.setInterval(connect, 5000);

  return () => {
    disposed = true;
    window.clearInterval(retry);
    offAuth();
    socket?.disconnect();
    socket = null;
    handlers.onConnected?.(false);
  };
}
