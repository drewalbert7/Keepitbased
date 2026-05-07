const {
  correlationRuleV1,
  allowsResearchDigestEmail
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
});
