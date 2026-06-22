const {
  buildTraderSections,
  extractCashtags,
  normalizePostUrl
} = require('./trustedTradersDigestService');

describe('trustedTradersDigestService', () => {
  test('extractCashtags finds tickers', () => {
    expect(extractCashtags('Long $NVDA and $AAPL here')).toEqual(['NVDA', 'AAPL']);
  });

  test('normalizePostUrl accepts x.com links', () => {
    expect(normalizePostUrl('https://x.com/trader/status/123', 'trader')).toBe(
      'https://x.com/trader/status/123'
    );
  });

  test('buildTraderSections groups and ranks by cashtags', () => {
    const traders = [{ username: 'alpha', label: 'Alpha' }];
    const posts = [
      {
        monitor_username: 'alpha',
        url: 'https://x.com/alpha/status/1',
        snippet: 'Watching $TSLA momentum',
        title: '@alpha: Watching $TSLA momentum'
      },
      {
        monitor_username: 'alpha',
        url: 'https://x.com/alpha/status/2',
        snippet: 'General market thoughts',
        title: '@alpha: General market thoughts'
      }
    ];
    const sections = buildTraderSections(traders, posts);
    expect(sections).toHaveLength(1);
    expect(sections[0].posts[0].cashtags).toContain('TSLA');
  });
});
