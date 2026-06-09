/**
 * Authenticated fetch for Quant AGI sidecar routes proxied through Node (/api/quant-agi/sidecar).
 * JWT lives in localStorage on app.keepitbased.com (same origin as the Quant terminal iframe).
 */
export function getKeepItBasedJwt(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("token");
  } catch {
    return null;
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
