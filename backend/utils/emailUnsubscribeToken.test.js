const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createEmailUnsubscribeToken,
  verifyEmailUnsubscribeToken
} = require('./emailUnsubscribeToken');

test('unsubscribe token round-trip', () => {
  const token = createEmailUnsubscribeToken(42);
  const v = verifyEmailUnsubscribeToken(token);
  assert.equal(v?.userId, 42);
});

test('invalid token rejected', () => {
  assert.equal(verifyEmailUnsubscribeToken('not-a-jwt'), null);
});
