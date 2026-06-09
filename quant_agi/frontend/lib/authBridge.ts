/** JWT bridged from parent CRA app when iframe storage is partitioned or cross-origin. */
const BRIDGE_KEY = "kib_bridged_token";
const AUTH_EVENT = "kib-auth-token";

let bridgedToken: string | null = null;

export function setBridgedAuthToken(token: string | null): void {
  bridgedToken = token && token.trim() ? token.trim() : null;
  try {
    if (bridgedToken) sessionStorage.setItem(BRIDGE_KEY, bridgedToken);
    else sessionStorage.removeItem(BRIDGE_KEY);
  } catch {
    /* private mode */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_EVENT));
  }
}

export function getBridgedAuthToken(): string | null {
  if (bridgedToken) return bridgedToken;
  try {
    const stored = sessionStorage.getItem(BRIDGE_KEY);
    bridgedToken = stored && stored.trim() ? stored.trim() : null;
    return bridgedToken;
  } catch {
    return null;
  }
}

export function onAuthTokenReady(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(AUTH_EVENT, listener);
  return () => window.removeEventListener(AUTH_EVENT, listener);
}

const PARENT_ORIGINS = [
  "https://app.keepitbased.com",
  "https://keepitbased.com",
  "https://www.keepitbased.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
];

export function requestAuthTokenFromParent(): void {
  if (typeof window === "undefined" || window.parent === window) return;
  for (const origin of PARENT_ORIGINS) {
    try {
      window.parent.postMessage({ type: "KIB_REQUEST_AUTH_TOKEN" }, origin);
    } catch {
      /* ignore */
    }
  }
}

export function installAuthBridgeListener(): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onMessage = (event: MessageEvent) => {
    const allowed = new Set([window.location.origin, ...PARENT_ORIGINS]);
    if (!allowed.has(event.origin)) return;
    const data = event.data as { type?: string; token?: string | null } | null;
    if (data?.type !== "KIB_AUTH_TOKEN") return;
    setBridgedAuthToken(typeof data.token === "string" ? data.token : null);
  };

  window.addEventListener("message", onMessage);
  requestAuthTokenFromParent();

  const retry = window.setInterval(requestAuthTokenFromParent, 1500);
  window.setTimeout(() => window.clearInterval(retry), 12000);

  return () => {
    window.removeEventListener("message", onMessage);
    window.clearInterval(retry);
  };
}
