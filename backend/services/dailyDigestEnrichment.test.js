const { enrichDigestFromWatchlist, isGrokFallbackDigest } = require('./dailyDigestEnrichment');

describe('dailyDigestEnrichment', () => {
  test('isGrokFallbackDigest detects template disclaimer', () => {
    expect(
      isGrokFallbackDigest({ disclaimer: 'LLM unavailable — template digest only.' }, { fallbackUsed: false })
    ).toBe(true);
  });

  test('enrichDigestFromWatchlist builds holdings from quotes', () => {
    const out = enrichDigestFromWatchlist(
      {
        macroAnalysis: 'LLM unavailable — template digest only.',
        marketOverview: '',
        holdingsAnalysis: 'Tracked alerts: 2 symbol(s)',
        disclaimer: 'LLM unavailable — template digest only.'
      },
      {
        items: [
          {
            symbol: 'NVDA',
            currentPrice: 140.5,
            dayChangePct: 2.1,
            dropPctFromBaseline: -3.2,
            thresholds: { small: 5 },
            sizing: { tierLabel: 'Watching' }
          }
        ]
      },
      [{ title: 'NVDA supply chain update', symbol: 'NVDA', contentSummary: 'Lead times improving.' }]
    );
    expect(out.macroAnalysis).toMatch(/2\.10%/);
    expect(out.holdingsAnalysis).toMatch(/NVDA/);
    expect(out.newsHighlights.length).toBeGreaterThan(0);
    expect(out.enrichedFromWatchlist).toBe(true);
  });
});
