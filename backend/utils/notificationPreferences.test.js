const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeNotificationPreferences,
  passesOpportunityEmailTierFilter
} = require('./notificationPreferences');

describe('mergeNotificationPreferences', () => {
  it('defaults opportunity email tier to overreaction_only', () => {
    const p = mergeNotificationPreferences({});
    assert.equal(p.opportunityEmailNotifyLevel, 'overreaction_only');
    assert.equal(p.opportunityMaxEmailsPerDay, 3);
    assert.equal(p.opportunityEmailDeliveryMode, 'hourly_digest');
    assert.equal(p.thresholdAlertEmail, false);
    assert.equal(p.dailyWatchlistDigestEmail, true);
    assert.equal(mergeNotificationPreferences({ dailyWatchlistDigestEmail: false }).dailyWatchlistDigestEmail, false);
    assert.equal(p.opportunityNotifyLevel, 'overreaction_only');
    assert.equal(p.timezone, 'America/New_York');
    assert.equal(p.quietHoursStart, '22:00');
    assert.equal(p.quietHoursEnd, '08:00');
    assert.equal(p.opportunityRespectQuietHours, true);
  });

  it('preserves explicit all tier and quiet hours', () => {
    const p = mergeNotificationPreferences({
      opportunityEmailNotifyLevel: 'all',
      timezone: 'Europe/London',
      quietHoursStart: '23:30',
      quietHoursEnd: '07:00',
      opportunityRespectQuietHours: false,
      opportunityMaxEmailsPerDay: 3
    });
    assert.equal(p.opportunityEmailNotifyLevel, 'all');
    assert.equal(p.timezone, 'Europe/London');
    assert.equal(p.quietHoursStart, '23:30');
    assert.equal(p.quietHoursEnd, '07:00');
    assert.equal(p.opportunityRespectQuietHours, false);
    assert.equal(p.opportunityMaxEmailsPerDay, 3);
  });

  it('ignores legacy researchQuietHoursLocal in merge output', () => {
    const p = mergeNotificationPreferences({ researchQuietHoursLocal: true, email: true });
    assert.equal('researchQuietHoursLocal' in p, false);
  });
});

describe('passesOpportunityEmailTierFilter', () => {
  it('filters on_sale for overreaction_only', () => {
    assert.equal(passesOpportunityEmailTierFilter(['on_sale'], 'overreaction_only'), false);
    assert.equal(
      passesOpportunityEmailTierFilter(['on_sale', 'overreaction'], 'overreaction_only'),
      true
    );
  });
});
