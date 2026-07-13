/**
 * Turnstile middleware native-bypass tests. The middleware no-ops under
 * NODE_ENV=test, so each case forces NODE_ENV=production (restored after) with
 * a secret set, and mocks global fetch so no real Cloudflare call happens.
 *
 * The regression this locks: Android Capacitor uses an https://localhost
 * origin with no 'Capacitor' UA marker, so the origin/UA-only check enforced
 * Turnstile on Android and blocked login. The X-Client-Platform header is the
 * reliable native signal.
 */
const { requireTurnstile } = require('./turnstile');

function mockReqRes(headers = {}, body = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  const req = { get: (h) => lower[h.toLowerCase()], body, ip: '1.2.3.4' };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return { req, res };
}

describe('requireTurnstile native bypass', () => {
  const OLD_ENV = process.env.NODE_ENV;
  const OLD_SECRET = process.env.TURNSTILE_SECRET_KEY;
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({ success: true }) }));
  });
  afterAll(() => {
    process.env.NODE_ENV = OLD_ENV;
    if (OLD_SECRET === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = OLD_SECRET;
  });

  test('Android (X-Client-Platform) bypasses without a token or a Cloudflare call', async () => {
    const { req, res } = mockReqRes({ 'X-Client-Platform': 'android', Origin: 'https://localhost' });
    const next = jest.fn();
    await requireTurnstile(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('iOS (X-Client-Platform) bypasses', async () => {
    const { req, res } = mockReqRes({ 'X-Client-Platform': 'ios' });
    const next = jest.fn();
    await requireTurnstile(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('iOS capacitor:// origin still bypasses (legacy signal, no header)', async () => {
    const { req, res } = mockReqRes({ Origin: 'capacitor://localhost' });
    const next = jest.fn();
    await requireTurnstile(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('web (platform=web) with no token is rejected 403', async () => {
    const { req, res } = mockReqRes({ 'X-Client-Platform': 'web', Origin: 'https://housemait.com' });
    const next = jest.fn();
    await requireTurnstile(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  test('web with a token verifies against Cloudflare', async () => {
    const { req, res } = mockReqRes({ 'X-Client-Platform': 'web' }, { turnstile_token: 'tok' });
    const next = jest.fn();
    await requireTurnstile(req, res, next);
    expect(global.fetch).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
