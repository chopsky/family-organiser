/**
 * Unit tests for the CORS origin allowlist.
 *
 * Guards the browser-side "Access-Control-Allow-Origin" behaviour that
 * previously rejected every Vercel preview URL (see commit: "Accept Vercel
 * preview URLs in the CORS allowlist so preview deploys can log in"). The
 * check is a plain function in ./cors-origins so we test it directly
 * rather than booting Express.
 */

describe('isAllowedOrigin', () => {
  const ORIGINAL_WEB_URL = process.env.WEB_URL;

  beforeEach(() => {
    process.env.WEB_URL = 'https://www.housmait.com';
    jest.resetModules();
  });

  afterAll(() => {
    process.env.WEB_URL = ORIGINAL_WEB_URL;
  });

  function load() {
    return require('./cors-origins').isAllowedOrigin;
  }

  test('allows the configured production WEB_URL', () => {
    const isAllowed = load();
    expect(isAllowed('https://www.housmait.com')).toBe(true);
  });

  test('allows same-origin / mobile / server-to-server (no origin header)', () => {
    const isAllowed = load();
    expect(isAllowed(undefined)).toBe(true);
    expect(isAllowed(null)).toBe(true);
    expect(isAllowed('')).toBe(true);
  });

  test('allows Capacitor (iOS app) and localhost (dev)', () => {
    const isAllowed = load();
    expect(isAllowed('capacitor://localhost')).toBe(true);
    expect(isAllowed('http://localhost')).toBe(true);
  });

  test('allows Vercel preview URLs for this project (hash-based)', () => {
    // Shape: https://family-organiser-<hash>-<scope>.vercel.app
    const isAllowed = load();
    expect(isAllowed('https://family-organiser-70xzz1nfo-chopskys-projects.vercel.app')).toBe(true);
    expect(isAllowed('https://family-organiser-abc123def-chopskys-projects.vercel.app')).toBe(true);
  });

  test('allows Vercel preview URLs for this project (git-branch form)', () => {
    // Shape: https://family-organiser-git-<branch>-<scope>.vercel.app
    const isAllowed = load();
    expect(isAllowed('https://family-organiser-git-redesign-housemait-chopskys-projects.vercel.app')).toBe(true);
    expect(isAllowed('https://family-organiser-git-main-chopskys-projects.vercel.app')).toBe(true);
  });

  test('rejects other vercel.app subdomains (different project, different scope)', () => {
    // We must NOT accept every *.vercel.app — that would let any Vercel
    // user spin up a malicious preview and hit our API. The allowlist only
    // matches deployments whose name starts with family-organiser-.
    const isAllowed = load();
    expect(isAllowed('https://other-project-abc.vercel.app')).toBe(false);
    expect(isAllowed('https://family-organiserx-abc.vercel.app')).toBe(false);
    expect(isAllowed('https://evil.vercel.app')).toBe(false);
  });

  test('rejects arbitrary origins that just happen to contain the project name', () => {
    const isAllowed = load();
    expect(isAllowed('https://family-organiser-abc.evil.com')).toBe(false);
    expect(isAllowed('https://evil.com/family-organiser-abc.vercel.app')).toBe(false);
    expect(isAllowed('http://family-organiser-abc.vercel.app')).toBe(false); // http (not https)
  });

  test('rejects production URL variants that do not match WEB_URL', () => {
    const isAllowed = load();
    // Different protocol must be rejected.
    expect(isAllowed('http://www.housmait.com')).toBe(false);
    // Substring spoof must be rejected — exact hostname match (after
    // stripping leading www.) is required.
    expect(isAllowed('https://www.housmait.com.evil.com')).toBe(false);
  });

  test('accepts www and bare-domain variants of WEB_URL', () => {
    // WEB_URL is set to https://www.housmait.com in beforeEach — both
    // forms of the production hostname must be allowed because the iOS
    // app's WebView origin can be either depending on capacitor.config
    // (server.hostname). Without this, switching between forms silently
    // breaks the iOS app via CORS rejection.
    const isAllowed = load();
    expect(isAllowed('https://www.housmait.com')).toBe(true);
    expect(isAllowed('https://housmait.com')).toBe(true);
  });

  test('allows all origins when WEB_URL is unset (development mode)', () => {
    delete process.env.WEB_URL;
    jest.resetModules();
    const isAllowed = load();
    expect(isAllowed('https://anything.example.com')).toBe(true);
    expect(isAllowed('http://localhost:3000')).toBe(true);
  });
});
