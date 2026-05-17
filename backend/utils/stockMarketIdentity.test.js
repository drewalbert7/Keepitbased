const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseWatchlistToken,
  tokenForTwStock,
  twAlertSymbol,
  parseStockAlertSymbol,
  resolveTwSymbolInput
} = require('./stockMarketIdentity');

test('parseWatchlistToken US stock', () => {
  const p = parseWatchlistToken('STOCK:AAPL');
  assert.equal(p?.assetType, 'stock');
  assert.equal(p?.market, 'US');
  assert.equal(p?.alertSymbol, 'AAPL');
});

test('parseWatchlistToken Taiwan stock', () => {
  const p = parseWatchlistToken('STOCK:TW:2330');
  assert.equal(p?.assetType, 'stock');
  assert.equal(p?.market, 'TW');
  assert.equal(p?.alertSymbol, 'TW:2330');
});

test('tokenForTwStock and alert symbol', () => {
  assert.equal(tokenForTwStock('2330'), 'STOCK:TW:2330');
  assert.equal(twAlertSymbol('2330'), 'TW:2330');
  assert.equal(parseStockAlertSymbol('TW:2330')?.code, '2330');
});

test('resolveTwSymbolInput English alias FOCI', () => {
  const v = resolveTwSymbolInput('FOCI');
  assert.equal(v.ok, true);
  assert.equal(v.code, '3363');
});
