const {
  buildTraderSections,
  extractCashtags,
  normalizePostUrl,
  handleFromXUrl,
  supplementTrustedDigestFromDigestLinks
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

  test('buildTraderSections matches handle from x.com URL', () => {
    const traders = [{ username: 'renstocks_', label: 'Ren' }];
    const posts = [
      {
        url: 'https://x.com/renstocks_/status/999',
        snippet: 'Long $NVDA',
        title: 'post'
      }
    ];
    const sections = buildTraderSections(traders, posts);
    expect(sections).toHaveLength(1);
    expect(sections[0].username).toBe('renstocks_');
  });

  test('supplementTrustedDigestFromDigestLinks uses digest xPostLinks', () => {
    const pack = {
      traders: [{ username: 'alpha', label: 'Alpha' }],
      sections: []
    };
    const digest = {
      xPostLinks: [{ url: 'https://x.com/alpha/status/42', note: 'macro thread' }]
    };
    const out = supplementTrustedDigestFromDigestLinks(pack, digest);
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0].posts[0].url).toContain('/alpha/status/42');
    expect(out.supplementedFromDigest).toBe(true);
  });
});
