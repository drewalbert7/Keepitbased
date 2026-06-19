const {
  normalizeSearchQuery,
  significantTokens,
  resolveAliasTicker,
  scoreSearchHit
} = require('./stockReferenceService');

describe('stockReferenceService search helpers', () => {
  test('normalizeSearchQuery strips punctuation and expands ampersand', () => {
    expect(normalizeSearchQuery('Johnson & Johnson')).toBe('johnson and johnson');
    expect(normalizeSearchQuery('Coca-Cola')).toBe('coca-cola');
  });

  test('significantTokens drops stop words', () => {
    expect(significantTokens('johnson and johnson')).toEqual(['johnson']);
    expect(significantTokens('bank of america')).toEqual(['america', 'bank']);
  });

  test('resolveAliasTicker maps brand names', () => {
    expect(resolveAliasTicker('google')).toBe('GOOGL');
    expect(resolveAliasTicker('jpmorgan')).toBe('JPM');
    expect(resolveAliasTicker('coca cola')).toBe('KO');
  });

  test('scoreSearchHit prefers common stock over ETF for company names', () => {
    const etf = { ticker: 'GOOP', name: 'Kurv Yield Premium Strategy Google (GOOGL) ETF', type: 'ETF' };
    const stock = { ticker: 'GOOGL', name: 'Alphabet Inc. Class A Common Stock', type: 'CS', primary_exchange: 'XNAS' };
    expect(scoreSearchHit('google', stock)).toBeGreaterThan(scoreSearchHit('google', etf));
  });

  test('scoreSearchHit ranks exact ticker highest', () => {
    const row = { ticker: 'AAPL', name: 'Apple Inc.', type: 'CS', primary_exchange: 'XNAS' };
    expect(scoreSearchHit('AAPL', row)).toBeGreaterThan(scoreSearchHit('apple', row));
  });
});
