/**
 * Base URL for Quant AGI FastAPI (browser calls nginx `/quant-sidecar/` in production).
 *
 * 1) `NEXT_PUBLIC_QUANT_AGI_URL` wins when set at build time.
 * 2) On the live app host, default to same-origin `/quant-sidecar` so a missed env
 *    does not point the browser at `127.0.0.1` (wrong machine).
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
      return `${protocol}//${hostname}/quant-sidecar`;
    }
  }

  return "http://127.0.0.1:8844";
}
