/**
 * Base URL for Quant AGI FastAPI (browser uses authenticated Node proxy in production).
 *
 * 1) `NEXT_PUBLIC_QUANT_AGI_URL` wins when set at build time.
 * 2) On the live app host, default to `/api/quant-agi/sidecar` (JWT required; nginx blocks `/quant-sidecar/`).
 * 3) Local dev default: sidecar on localhost:8844.
 */
export function getQuantAgiBaseUrl(): string {
  const fromEnv =
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_QUANT_AGI_URL
      ? process.env.NEXT_PUBLIC_QUANT_AGI_URL.replace(/\/$/, "").trim()
      : "";
  if (fromEnv) return fromEnv;

  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    if (hostname === "app.keepitbased.com") {
      return `${protocol}//${hostname}/api/quant-agi/sidecar`;
    }
  }

  return "http://127.0.0.1:8844";
}
