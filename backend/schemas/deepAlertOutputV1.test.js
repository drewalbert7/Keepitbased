const {
  validateDeepAlertOutputV1,
  exampleDeepAlertOutputV1,
  isValueWithProvenance
} = require('./deepAlertOutputV1');

describe('deepAlertOutputV1', () => {
  test('example validates', () => {
    const ex = exampleDeepAlertOutputV1();
    const r = validateDeepAlertOutputV1(ex);
    expect(r.ok).toBe(true);
  });

  test('rejects wrong schemaVersion', () => {
    const r = validateDeepAlertOutputV1({ ...exampleDeepAlertOutputV1(), schemaVersion: 99 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/schemaVersion/);
  });

  test('isValueWithProvenance', () => {
    expect(isValueWithProvenance({ value: 1, provenance: { source: 'x' } })).toBe(true);
    expect(isValueWithProvenance({ value: NaN, provenance: { source: 'x' } })).toBe(false);
  });
});
