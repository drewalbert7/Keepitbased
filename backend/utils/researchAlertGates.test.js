const {
  correlationRuleV1,
  allowsResearchDigestEmail,
  isQuietHour,
  getLocalHour,
  allowsSendDuringQuietHours
} = require('./researchAlertGates');
const { mergeNotificationPreferences } = require('./notificationPreferences');

describe('researchAlertGates', () => {
  test('correlationRuleV1 requires dip and research', () => {
    expect(correlationRuleV1({ dipFlags: [], researchArtifactCount: 2 }).fusedEligible).toBe(
      false
    );
    expect(correlationRuleV1({ dipFlags: ['on_sale'], researchArtifactCount: 0 }).fusedEligible).toBe(
      false
    );
    expect(
      correlationRuleV1({ dipFlags: ['on_sale'], researchArtifactCount: 1 }).fusedEligible
    ).toBe(true);
  });

  test('allowsResearchDigestEmail respects cap', () => {
    const prefsOn = mergeNotificationPreferences({
      researchDigestEmail: true,
      researchMaxEmailsPerDay: 3
    });
    expect(allowsResearchDigestEmail(prefsOn, { emailsSentToday: 3 }).allowed).toBe(false);
    expect(allowsResearchDigestEmail(prefsOn, { emailsSentToday: 2 }).allowed).toBe(true);
    const prefsOff = mergeNotificationPreferences({ researchDigestEmail: false });
    expect(allowsResearchDigestEmail(prefsOff).allowed).toBe(false);
  });

  test('quiet hours overnight NYC', () => {
    const d = new Date('2026-05-03T06:30:00Z');
    expect(isQuietHour(d, { startHour: 22, endHour: 7 }, 'America/New_York')).toBe(true);
  });

  test('allowsSendDuringQuietHours uses merged prefs', () => {
    const prefs = mergeNotificationPreferences({
      timezone: 'America/New_York',
      researchQuietHoursLocal: { startHour: 22, endHour: 7 }
    });
    const night = new Date('2026-05-03T06:30:00Z');
    expect(allowsSendDuringQuietHours(prefs, night).allowed).toBe(false);
  });

  test('getLocalHour returns hour', () => {
    const d = new Date('2026-05-03T15:00:00Z');
    const h = getLocalHour(d, 'UTC');
    expect(h).toBe(15);
  });
});
