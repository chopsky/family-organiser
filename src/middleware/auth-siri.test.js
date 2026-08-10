/**
 * Scope containment for the long-lived Siri token (iOS App Intent
 * "Hey Siri, add to Housemait").
 *
 * The contract under test:
 *   • signSiriToken embeds scope:'siri' and verifies with the same secret.
 *   • requireAuth REJECTS a siri-scoped token unless allowSiriScope ran
 *     first — so the token works on the one opted-in shopping route and
 *     nowhere else, and in particular cannot mint a fresh siri token.
 *   • Normal tokens are unaffected by allowSiriScope in either direction.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const { signToken, signSiriToken, allowSiriScope, requireAuth } = require('./auth');

const CLAIMS = { userId: 'u-1', householdId: 'hh-1', name: 'Sarah', role: 'admin', isPlatformAdmin: false };

function run(middlewares, req) {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  let idx = 0;
  const next = () => {
    const mw = middlewares[idx++];
    if (mw) mw(req, res, next);
    else req._reachedHandler = true;
  };
  next();
  return res;
}

const reqWith = (token) => ({ headers: { authorization: `Bearer ${token}` } });

describe('siri token scope containment', () => {
  test('siri token is rejected on a route without allowSiriScope', () => {
    const req = reqWith(signSiriToken(CLAIMS));
    const res = run([requireAuth], req);
    expect(res.statusCode).toBe(401);
    expect(req._reachedHandler).toBeUndefined();
  });

  test('siri token is accepted when allowSiriScope runs first', () => {
    const req = reqWith(signSiriToken(CLAIMS));
    run([allowSiriScope, requireAuth], req);
    expect(req._reachedHandler).toBe(true);
    expect(req.user).toEqual(expect.objectContaining({ id: 'u-1', role: 'admin' }));
    expect(req.householdId).toBe('hh-1');
  });

  test('normal token still works with and without allowSiriScope', () => {
    const plain = reqWith(signToken(CLAIMS));
    run([requireAuth], plain);
    expect(plain._reachedHandler).toBe(true);

    const throughAllow = reqWith(signToken(CLAIMS));
    run([allowSiriScope, requireAuth], throughAllow);
    expect(throughAllow._reachedHandler).toBe(true);
  });

  test('garbage bearer token is still a 401 on the allowlisted path', () => {
    const req = reqWith('not-a-jwt');
    const res = run([allowSiriScope, requireAuth], req);
    expect(res.statusCode).toBe(401);
  });
});
