/**
 * Shared validation for alert symbols (stocks + major crypto tickers).
 * Allows dots for classes like BRK.B.
 */

const SYMBOL_RE = /^[A-Z0-9.]{1,16}$/;

function normalizeAlertSymbol(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase();
}

/**
 * @returns {{ ok: true, symbol: string } | { ok: false, message: string }}
 */
function validateAlertSymbol(raw) {
  const symbol = normalizeAlertSymbol(raw);
  if (!SYMBOL_RE.test(symbol)) {
    return {
      ok: false,
      message:
        'Symbol must be 1–16 characters (letters, digits, or dot), e.g. AAPL, BTC, BRK.B'
    };
  }
  return { ok: true, symbol };
}

module.exports = {
  normalizeAlertSymbol,
  validateAlertSymbol
};
