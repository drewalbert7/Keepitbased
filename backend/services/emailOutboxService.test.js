const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildOpportunityOutboxSchedule,
  hourBucketUtc
} = require('./emailOutboxService');

describe('buildOpportunityOutboxSchedule', () => {
  it('instant mode has no batch key', () => {
    const s = buildOpportunityOutboxSchedule('instant', 42, new Date('2026-01-15T15:30:00.000Z'));
    assert.equal(s.batchKey, null);
    assert.ok(s.scheduledFor instanceof Date);
  });

  it('hourly digest uses batch key and next hour', () => {
    const now = new Date('2026-01-15T15:30:00.000Z');
    const s = buildOpportunityOutboxSchedule('hourly_digest', 7, now);
    assert.equal(s.batchKey, `opp-digest:7:${hourBucketUtc(now)}`);
    assert.equal(s.scheduledFor.toISOString(), '2026-01-15T16:00:00.000Z');
  });
});
