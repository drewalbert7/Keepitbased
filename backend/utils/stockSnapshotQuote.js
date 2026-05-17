/**
 * Normalize Massive/Polygon US stock snapshot `ticker` objects.
 * Off-hours / weekends often return `day` OHLC as 0 while `prevDay` is valid.
 */

function pickPositive(...values) {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * @param {object} t — `response.ticker` from `/v2/snapshot/.../tickers/{SYM}`
 * @returns {object|null}
 */
function resolveUsStockSnapshotTicker(t) {
  if (!t || typeof t !== 'object') return null;

  const prevClose = pickPositive(t.prevDay?.c);
  const close = pickPositive(t.day?.c, t.min?.c, t.lastTrade?.p, prevClose);
  if (close == null) return null;

  const open = pickPositive(t.day?.o, prevClose) ?? close;
  const high = pickPositive(t.day?.h, close) ?? close;
  const low = pickPositive(t.day?.l, close) ?? close;
  const volume = Math.max(0, Number(t.day?.v) || 0);

  let change;
  if (t.todaysChange != null && Number.isFinite(Number(t.todaysChange))) {
    change = Number(t.todaysChange);
  } else if (prevClose != null) {
    change = close - prevClose;
  } else {
    change = close - open;
  }

  let changePercent;
  if (t.todaysChangePerc != null && Number.isFinite(Number(t.todaysChangePerc))) {
    changePercent = Number(t.todaysChangePerc);
  } else if (prevClose) {
    changePercent = (change / prevClose) * 100;
  } else if (open) {
    changePercent = ((close - open) / open) * 100;
  } else {
    changePercent = 0;
  }

  const dayOpen = pickPositive(t.day?.o);
  const sessionVwap = pickPositive(t.day?.vw);

  return {
    close,
    open,
    high,
    low,
    volume,
    prevClose,
    change,
    changePercent,
    dayOpen,
    sessionVwap,
    lastQuote: t.lastQuote
  };
}

module.exports = {
  pickPositive,
  resolveUsStockSnapshotTicker
};
