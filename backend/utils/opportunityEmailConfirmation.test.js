const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  registerOpportunityEmailConfirmationPoll,
  emailSentRedisKey
} = require('./opportunityEmailConfirmation');

describe('registerOpportunityEmailConfirmationPoll', () => {
  it('confirms after two distinct minute buckets without redis', async () => {
    const r1 = await registerOpportunityEmailConfirmationPoll(null, 1, 'stock', 'AAPL', {
      requiredHits: 2,
      windowPolls: 3,
      now: new Date('2026-01-15T15:00:00.000Z')
    });
    assert.equal(r1.confirmed, true);
    assert.equal(r1.degraded, true);
  });

  it('builds hourly email-sent key', () => {
    const k = emailSentRedisKey(9, 'stock', 'MSFT', new Date('2026-01-15T15:04:00.000Z'));
    assert.match(k, /^oppmail:sent:9:stock:MSFT:\d+$/);
  });
});
