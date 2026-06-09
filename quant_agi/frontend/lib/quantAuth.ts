/**
 * Authenticated fetch for Quant AGI sidecar routes proxied through Node (/api/quant-agi/sidecar).
 * JWT lives in localStorage on app.keepitbased.com, or is bridged from the parent iframe shell.
 */
import { getBridgedAuthToken } from "./authBridge";

export function getKeepItBasedJwt(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("token") || getBridgedAuthToken();
  } catch {
    return getBridgedAuthToken();
  }
}

export async function quantAuthedFetch(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = getKeepItBasedJwt();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(url, {
    ...init,
    headers,
    credentials: "same-origin"
  });
}
