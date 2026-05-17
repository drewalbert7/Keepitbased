const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseWatchlistToken,
  tokenForTwStock,
  twAlertSymbol,
  parseStockAlertSymbol,
  resolveTwSymbolInput,
  getTwPrimaryEnglishAlias,
  twWatchlistDisplay
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

test('findTwAliasMatches Shunsin', () => {
  const { findTwAliasMatches } = require('./stockMarketIdentity');
  assert.deepEqual(findTwAliasMatches('SHUNSIN'), [{ alias: 'SHUNSIN', code: '6451' }]);
  assert.ok(findTwAliasMatches('SHUN').some((m) => m.code === '6451'));
});

test('getTwPrimaryEnglishAlias for known listings', () => {
  assert.equal(getTwPrimaryEnglishAlias('2330'), 'TSMC');
  assert.equal(getTwPrimaryEnglishAlias('3363'), 'FOCI');
  assert.equal(getTwPrimaryEnglishAlias('6451'), 'SHUNSIN');
});

test('twWatchlistDisplay', () => {
  const d = twWatchlistDisplay('TW:2330');
  assert.equal(d.englishAlias, 'TSMC');
  assert.equal(d.alertSymbol, 'TW:2330');
});
