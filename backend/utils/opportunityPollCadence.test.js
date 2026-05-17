const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { shouldPollStockSymbolThisCycle } = require('./opportunityPollCadence');

describe('shouldPollStockSymbolThisCycle', () => {
  it('always polls during US RTH weekday', () => {
    const rth = new Date('2026-01-15T15:00:00.000Z');
    assert.equal(shouldPollStockSymbolThisCycle(rth, 5), true);
  });

  it('throttles off-hours to every N minutes', () => {
    const off = new Date('2026-01-15T04:03:00.000Z');
    assert.equal(shouldPollStockSymbolThisCycle(off, 5), false);
    const offHit = new Date('2026-01-15T04:05:00.000Z');
    assert.equal(shouldPollStockSymbolThisCycle(offHit, 5), true);
  });
});
