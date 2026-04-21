/**
 * Unit tests for the password strength validator.
 *
 * fetch() is mocked — we don't hit the real HaveIBeenPwned API from tests.
 * Regression anchors:
 *   - Minimum-length rule (the old `>= 8` check got tightened to >= 10)
 *   - Breached-password rejection with the count rendered in the message
 *   - Fail-open on HIBP network errors so CI / offline dev still works
 *   - Personal-info rules (email local-part, name)
 */

const { validatePassword, hibpBreachCount, MIN_LENGTH } = require('./password-strength');

describe('validatePassword()', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Default: HIBP says "not breached" (empty response body)
  function mockHibpClean() {
    fetchMock.mockResolvedValue({ ok: true, text: async () => '' });
  }

  test('accepts a strong password that is not breached', async () => {
    mockHibpClean();
    const result = await validatePassword('correct-horse-battery-staple');
    expect(result).toEqual({ valid: true });
  });

  test('rejects empty / null / non-string passwords', async () => {
    for (const input of [undefined, null, '', 0, {}, []]) {
      const result = await validatePassword(input);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/required/i);
    }
  });

  test(`rejects passwords shorter than ${MIN_LENGTH} chars`, async () => {
    mockHibpClean();
    const result = await validatePassword('abc12345'); // 8 chars
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(new RegExp(`${MIN_LENGTH} characters`));
  });

  test('rejects absurdly long passwords to prevent bcrypt DoS', async () => {
    mockHibpClean();
    const result = await validatePassword('a'.repeat(300));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/too long/i);
  });

  test('rejects passwords containing the user email local-part', async () => {
    mockHibpClean();
    const result = await validatePassword('grantsmith-2026', { email: 'grantsmith@example.com' });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/email/i);
  });

  test('does NOT reject on a super-short email local-part (avoids false positives on common substrings)', async () => {
    mockHibpClean();
    const result = await validatePassword('correct-horse-battery', { email: 'ab@example.com' });
    expect(result.valid).toBe(true);
  });

  test('rejects passwords containing the user name', async () => {
    mockHibpClean();
    const result = await validatePassword('grant-is-awesome-2026', { name: 'Grant' });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/name/i);
  });

  test('does NOT reject on a 1- or 2-char name (too broad)', async () => {
    mockHibpClean();
    const result = await validatePassword('correct-horse-battery', { name: 'Al' });
    expect(result.valid).toBe(true);
  });

  test('rejects a password that HIBP says has been breached', async () => {
    // Simulate HIBP returning the suffix of our test password's SHA-1
    // with a breach count of 3,730,471 (the real count for 'password'
    // as of writing — guards against anyone accidentally treating this
    // test's expected number as authoritative).
    const crypto = require('crypto');
    const sha1 = crypto.createHash('sha1').update('password123').digest('hex').toUpperCase();
    const suffix = sha1.slice(5);
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => `ABCDE:1\r\n${suffix}:3730471\r\nFFFFF:2`,
    });

    const result = await validatePassword('password123');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/3,730,471 known data breaches/);
  });

  test('fails open when HIBP request throws (network error)', async () => {
    fetchMock.mockRejectedValue(new Error('network unreachable'));
    const result = await validatePassword('some-plausible-password');
    // Password is long enough + no personal-info match, so it should pass
    // even though HIBP couldn't be reached.
    expect(result.valid).toBe(true);
  });

  test('fails open when HIBP responds with a non-2xx status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => '' });
    const result = await validatePassword('some-plausible-password');
    expect(result.valid).toBe(true);
  });
});

describe('hibpBreachCount()', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('sends only the first 5 chars of the SHA-1 hash (k-anonymity)', async () => {
    global.fetch.mockResolvedValue({ ok: true, text: async () => '' });
    await hibpBreachCount('mypassword');
    const url = global.fetch.mock.calls[0][0];
    // The URL must carry only a 5-char hex prefix — the full plaintext
    // or a full hash would mean we'd leaked the password.
    expect(url).toMatch(/^https:\/\/api\.pwnedpasswords\.com\/range\/[A-F0-9]{5}$/);
  });

  test('returns 0 when the suffix is not in the response', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      text: async () => 'AAAAA:1\r\nBBBBB:2\r\n',
    });
    expect(await hibpBreachCount('anything')).toBe(0);
  });
});
