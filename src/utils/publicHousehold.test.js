const { publicHousehold } = require('./publicHousehold');

describe('publicHousehold', () => {
  test('strips child_mode_pin_hash and derives child_mode_pin_set=true', () => {
    const out = publicHousehold({ id: 'h1', name: 'Home', child_mode_pin_hash: '$2b$12$abc' });
    expect(out).not.toHaveProperty('child_mode_pin_hash');
    expect(out.child_mode_pin_set).toBe(true);
    expect(out.id).toBe('h1');
    expect(out.name).toBe('Home');
  });

  test('child_mode_pin_set is false with no hash (the regression: login showed no PIN)', () => {
    expect(publicHousehold({ id: 'h1', child_mode_pin_hash: null }).child_mode_pin_set).toBe(false);
    expect(publicHousehold({ id: 'h1' }).child_mode_pin_set).toBe(false);
  });

  test('passes null/undefined straight through', () => {
    expect(publicHousehold(null)).toBeNull();
    expect(publicHousehold(undefined)).toBeUndefined();
  });
});
