/** True when terminal is embedded in the main app iframe (?embed=1). */
export function isEmbedMode(searchParams: URLSearchParams | null): boolean {
  return searchParams?.get("embed") === "1";
}

/** Anchor for Quant AGI Bot section on Quant AGI terminal. */
export const QUANT_BOT_HREF = "#quant-agi-bot";
