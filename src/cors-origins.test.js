const { isAllowedOrigin } = require('./cors-origins');

describe('isAllowedOrigin (with WEB_URL set)', () => {
  const OLD = process.env.WEB_URL;
  beforeAll(() => { process.env.WEB_URL = 'https://www.housemait.com'; });
  afterAll(() => { if (OLD === undefined) delete process.env.WEB_URL; else process.env.WEB_URL = OLD; });

  test('allows the Capacitor iOS origin', () => {
    expect(isAllowedOrigin('capacitor://localhost')).toBe(true);
  });

  test('allows the Capacitor ANDROID origin (regression: Android uses https://localhost)', () => {
    // Android's WebView origin is https://localhost, not iOS's capacitor://.
    // Missing this rejected every Android API call as a CORS failure, which
    // surfaced as "Something went wrong" on login.
    expect(isAllowedOrigin('https://localhost')).toBe(true);
  });

  test('allows the dev server + WEB_URL (www and bare) ', () => {
    expect(isAllowedOrigin('http://localhost')).toBe(true);
    expect(isAllowedOrigin('https://www.housemait.com')).toBe(true);
    expect(isAllowedOrigin('https://housemait.com')).toBe(true);
  });

  test('rejects an arbitrary origin and a lookalike vercel host', () => {
    expect(isAllowedOrigin('https://evil.example.com')).toBe(false);
    expect(isAllowedOrigin('https://not-family-organiser.vercel.app')).toBe(false);
  });

  test('no-origin (mobile/server-to-server) is allowed', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
  });
});
