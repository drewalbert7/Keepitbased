"use client";

import { useEffect } from "react";
import { connectPaperBotSocket, type PaperBotSocketUpdate } from "../lib/paperBotSocket";

type Props = {
  onUpdate: (payload: PaperBotSocketUpdate) => void;
  onConnected?: (connected: boolean) => void;
};

/** Subscribes to `paperBotUpdate` on the main app Socket.IO server (per-user room). */
export function PaperBotSocketBridge({ onUpdate, onConnected }: Props) {
  useEffect(() => {
    return connectPaperBotSocket({ onUpdate, onConnected });
  }, [onUpdate, onConnected]);

  return null;
}
