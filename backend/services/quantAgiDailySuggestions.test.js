const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  pickTopPerStrategy,
  filterMomentumFromExplanations,
  DAILY_DIGEST_QUANT_STRATEGIES
} = require('../services/quantAgiDailySuggestions');

describe('pickTopPerStrategy', () => {
  it('returns perStrategy picks for each daily digest strategy', () => {
    const gardnerRows = ['AAPL', 'MSFT', 'NVDA', 'MU'].map((sym, i) => ({
      symbol: sym,
      score: 90 - i,
      why: [`Gardner pick ${sym}`],
      strategy_factors: { kind: 'rule_breaker_gardner', breakdown: [] }
    }));
    const earlyRows = ['APP', 'DUOL', 'RKLB', 'SMCI'].map((sym, i) => ({
      symbol: sym,
      score: 85 - i,
      why: [`Early pick ${sym}`],
      strategy_factors: { kind: 'rule_breaker_gardner_early', breakdown: [] }
    }));
    const chokeRows = ['COHR', 'LITE', 'AAOI', 'OLED'].map((sym, i) => ({
      symbol: sym,
      score: 80 - i,
      why: [`Choke pick ${sym}`],
      strategy_factors: { kind: 'photonics_chokepoint', theme_hits: ['photonics'] }
    }));

    const { sections, suggestions, perStrategy } = pickTopPerStrategy({
      rankPayloadsByStrategy: {
        rule_breaker_gardner: { positions: gardnerRows },
        rule_breaker_gardner_early: { positions: earlyRows },
        photonics_chokepoint: { positions: chokeRows }
      },
      watchlistSymbols: ['AAPL'],
      perStrategy: 3
    });

    assert.equal(perStrategy, 3);
    assert.equal(sections.length, DAILY_DIGEST_QUANT_STRATEGIES.length);
    assert.equal(suggestions.length, 9);
    for (const sec of sections) {
      assert.equal(sec.picks.length, 3);
    }
    assert.equal(sections[0].picks[0].symbol, 'MSFT');
    assert.ok(sections.some((s) => s.strategy === 'rule_breaker_gardner_early'));
  });
});

describe('filterMomentumFromExplanations', () => {
  it('removes tape/momentum context lines', () => {
    const out = filterMomentumFromExplanations([
      'Rule Breaker composite 91/100',
      'Tape context: mom20 +5.00%, vol20 2.00%, DD60 -3.00% (tier score 0.123 for context only).',
      'Leg scores (0–100 × weight): top_dog_first_mover=80',
      'Tape: mom20 +1.00%, DD60 -2.00% — live Massive'
    ]);
    assert.equal(out.length, 2);
    assert.match(out[0], /Rule Breaker composite/);
    assert.match(out[1], /Leg scores/);
  });
});
