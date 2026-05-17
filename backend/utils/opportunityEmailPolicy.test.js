const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isOpportunityQuietHours } = require('./opportunityEmailPolicy');

describe('isOpportunityQuietHours', () => {
  it('returns false when respect flag is off', () => {
    assert.equal(
      isOpportunityQuietHours({ opportunityRespectQuietHours: false }, new Date()),
      false
    );
  });

  it('detects overnight window in America/New_York', () => {
    const prefs = {
      opportunityRespectQuietHours: true,
      timezone: 'America/New_York',
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00'
    };
    const lateNightUtc = new Date('2026-01-15T04:00:00.000Z');
    assert.equal(isOpportunityQuietHours(prefs, lateNightUtc), true);
    const middayUtc = new Date('2026-01-15T17:00:00.000Z');
    assert.equal(isOpportunityQuietHours(prefs, middayUtc), false);
  });
});
