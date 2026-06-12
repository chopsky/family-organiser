jest.mock('./client', () => ({ supabaseAdmin: {}, supabase: {} }));

const { sanitizeOrFilterValue } = require('./queries');

describe('sanitizeOrFilterValue (PostgREST .or() injection guard)', () => {
  test('strips the structural metacharacters that delimit .or() conditions/groups', () => {
    expect(sanitizeOrFilterValue('foo,bar')).toBe('foo bar');
    expect(sanitizeOrFilterValue('a(b)c')).toBe('a b c');
    expect(sanitizeOrFilterValue('a\\b')).toBe('a b');
  });

  test('neutralises an injection attempt (extra condition cannot survive)', () => {
    // Without sanitisation, this would close the ilike value and inject
    // `id.eq.123` as a new OR condition inside the filter string.
    const out = sanitizeOrFilterValue('x,id.eq.123');
    expect(out).toBe('x id.eq.123');
    expect(out).not.toMatch(/[,()\\]/);
  });

  test('keeps ilike wildcards (% and _) - they only ever over-match', () => {
    expect(sanitizeOrFilterValue('%wild_card%')).toBe('%wild_card%');
  });

  test('leaves ordinary terms untouched and trims', () => {
    expect(sanitizeOrFilterValue('  Sarah  ')).toBe('Sarah');
    expect(sanitizeOrFilterValue("o'brien")).toBe("o'brien");
  });

  test('handles null/undefined/non-strings without throwing', () => {
    expect(sanitizeOrFilterValue(null)).toBe('');
    expect(sanitizeOrFilterValue(undefined)).toBe('');
    expect(sanitizeOrFilterValue(123)).toBe('123');
  });
});
