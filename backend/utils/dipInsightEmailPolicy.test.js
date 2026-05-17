const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { qualifiesForDipInsightTier } = require('./dipInsightEmailPolicy');

describe('qualifiesForDipInsightTier', () => {
  it('rejects on_sale only', () => {
    assert.equal(qualifiesForDipInsightTier(['on_sale']), false);
  });

  it('accepts overreaction or capitulation', () => {
    assert.equal(qualifiesForDipInsightTier(['on_sale', 'overreaction']), true);
    assert.equal(qualifiesForDipInsightTier(['capitulation']), true);
  });
});
