/**
 * US vs non-US stock identity for watchlist tokens and alert rows.
 *
 * Watchlist JSON tokens:
 *   STOCK:AAPL        — US (Polygon/Massive)
 *   STOCK:TW:2330     — Taiwan (iTick, region TW)
 *
 * Alert / Redis symbol keys use `TW:2330` for Taiwan listings.
 */

const fs = require('fs');
const path = require('path');

const STOCK_PREFIX = 'STOCK';
const CRYPTO_PREFIX = 'CRYPTO';
const TW_REGION = 'TW';

const TW_CODE_RE = /^\d{4,6}$/;

const TW_ALIASES_PATH = path.join(__dirname, '../data/twEnglishAliases.json');
let twEnglishAliasesCache = null;

/**
 * English / acronym aliases → numeric TWSE/TPEX code.
 * Built via `node scripts/buildTwEnglishAliases.js` (~1.9k entries).
 */
function getTwEnglishAliases() {
  if (twEnglishAliasesCache) return twEnglishAliasesCache;
  const raw = JSON.parse(fs.readFileSync(TW_ALIASES_PATH, 'utf8'));
  twEnglishAliasesCache = Object.freeze(raw.aliases || raw);
  return twEnglishAliasesCache;
}

/** @deprecated use getTwEnglishAliases() */
const TW_ENGLISH_ALIASES = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === Symbol.toStringTag) return 'Object';
      return getTwEnglishAliases()[prop];
    },
    ownKeys() {
      return Reflect.ownKeys(getTwEnglishAliases());
    },
    getOwnPropertyDescriptor(_t, prop) {
      const v = getTwEnglishAliases()[prop];
      if (v === undefined) return undefined;
      return { configurable: true, enumerable: true, value: v, writable: false };
    }
  }
);

/**
 * Exact or prefix matches on English alias keys (min 3 chars).
 * @param {string} raw
 * @returns {Array<{ alias: string, code: string }>}
 */
function findTwAliasMatches(raw) {
  const upper = String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (upper.length < 3) return [];

  const aliases = getTwEnglishAliases();
  const byCode = new Map();
  const consider = (alias, code) => {
    if (!code || byCode.has(code)) return;
    byCode.set(code, { alias, code });
  };

  if (aliases[upper]) {
    consider(upper, aliases[upper]);
  }

  let prefixHits = 0;
  for (const [alias, code] of Object.entries(aliases)) {
    if (alias === upper) continue;
    if (alias.startsWith(upper) || (upper.length >= 4 && upper.startsWith(alias))) {
      consider(alias, code);
      prefixHits += 1;
      if (prefixHits >= 40) break;
    }
  }

  return [...byCode.values()];
}

function normalizeTwCode(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!TW_CODE_RE.test(digits)) {
    return {
      ok: false,
      message: 'Taiwan stock code must be 4–6 digits (e.g. 2330 for TSMC)'
    };
  }
  return { ok: true, code: digits };
}

/**
 * Resolve numeric code or English alias (e.g. FOCI → 3363).
 * @param {string} raw
 */
function resolveTwSymbolInput(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return { ok: false, message: 'Enter a Taiwan stock code or symbol' };
  }
  const upper = trimmed.toUpperCase();
  if (upper.startsWith('TW:')) {
    return normalizeTwCode(upper.slice(3));
  }
  const aliasKey = upper.replace(/[^A-Z0-9]/g, '');
  const aliasCode = getTwEnglishAliases()[aliasKey];
  if (aliasCode) {
    return { ok: true, code: aliasCode, matchedAlias: aliasKey };
  }
  return normalizeTwCode(trimmed);
}

/** Alert row + Redis price key symbol for a Taiwan listing. */
function twAlertSymbol(code) {
  return `TW:${String(code).replace(/\D/g, '')}`;
}

function parseTwAlertSymbol(symbol) {
  const s = String(symbol || '').trim().toUpperCase();
  if (!s.startsWith('TW:')) return null;
  const code = s.slice(3).replace(/\D/g, '');
  if (!TW_CODE_RE.test(code)) return null;
  return { market: TW_REGION, code, alertSymbol: `TW:${code}` };
}

/**
 * @param {string} symbol — US ticker or TW:code
 */
function parseStockAlertSymbol(symbol) {
  const tw = parseTwAlertSymbol(symbol);
  if (tw) return tw;
  const us = String(symbol || '').trim().toUpperCase();
  if (!us || us.includes(':')) return null;
  return { market: 'US', code: us, alertSymbol: us };
}

function tokenForUsStock(ticker) {
  return `${STOCK_PREFIX}:${String(ticker).toUpperCase()}`;
}

function tokenForTwStock(code) {
  const v = resolveTwSymbolInput(code);
  if (!v.ok) return null;
  return `${STOCK_PREFIX}:${TW_REGION}:${v.code}`;
}

/**
 * @param {string} token — watchlist JSON entry
 * @returns {{ assetType: 'stock'|'crypto', market?: string, symbol: string, alertSymbol: string }|null}
 */
function parseWatchlistToken(token) {
  const s = String(token || '').trim();
  if (!s) return null;

  const parts = s.split(':').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const head = parts[0].toUpperCase();
  if (head === CRYPTO_PREFIX && parts.length === 2) {
    const sym = parts[1].toUpperCase();
    return { assetType: 'crypto', symbol: sym, alertSymbol: sym };
  }

  if (head === STOCK_PREFIX) {
    if (parts.length === 2) {
      const sym = parts[1].toUpperCase();
      return { assetType: 'stock', market: 'US', symbol: sym, alertSymbol: sym };
    }
    if (parts.length === 3 && parts[1].toUpperCase() === TW_REGION) {
      const v = resolveTwSymbolInput(parts[2]);
      if (!v.ok) return null;
      const alertSymbol = twAlertSymbol(v.code);
      return {
        assetType: 'stock',
        market: TW_REGION,
        code: v.code,
        symbol: alertSymbol,
        alertSymbol
      };
    }
  }

  return null;
}

function alertKey(assetType, alertSymbol) {
  return `${String(assetType).toLowerCase()}:${String(alertSymbol).toUpperCase()}`;
}

function isTwStockAlertSymbol(symbol) {
  return parseTwAlertSymbol(symbol) != null;
}

module.exports = {
  STOCK_PREFIX,
  CRYPTO_PREFIX,
  TW_REGION,
  TW_ENGLISH_ALIASES,
  getTwEnglishAliases,
  findTwAliasMatches,
  normalizeTwCode,
  resolveTwSymbolInput,
  twAlertSymbol,
  parseTwAlertSymbol,
  parseStockAlertSymbol,
  tokenForUsStock,
  tokenForTwStock,
  parseWatchlistToken,
  alertKey,
  isTwStockAlertSymbol
};
