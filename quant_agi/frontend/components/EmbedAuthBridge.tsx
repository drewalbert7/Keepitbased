"use client";

import { useEffect } from "react";
import { installAuthBridgeListener } from "../lib/authBridge";

/** Requests JWT from parent CRA shell when embedded (?embed=1). */
export function EmbedAuthBridge({ embed }: { embed: boolean }) {
  useEffect(() => {
    if (!embed) return;
    return installAuthBridgeListener();
  }, [embed]);

  return null;
}
