/**
 * POST /api/subscription/redeem - promo code redemption route.
 * db + auth middleware are mocked; we assert the reason→status/message
 * mapping and that the handler forwards (householdId, userId, code).
 */
// queries.js requires ./client at load (needs Supabase env). Stub it so the
// auto-mock of ../db/queries can be built without real credentials.
jest.mock('../db/client', () => ({ supabaseAdmin: {}, supabase: {}, getUserClient: () => ({}), testConnection: () => {} }));
jest.mock('../db/queries');
jest.mock('../services/stripe', () => ({}));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'user-1' }; next(); },
  requireHousehold: (req, _res, next) => { req.householdId = 'hh-1'; next(); },
}));

const request = require('supertest');
const express = require('express');
const db = require('../db/queries');
const subscriptionRouter = require('./subscription');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/subscription', subscriptionRouter);
  return app;
}

describe('POST /api/subscription/redeem', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = makeApp();
  });

  test('400 when no code supplied', async () => {
    const res = await request(app).post('/api/subscription/redeem').send({});
    expect(res.status).toBe(400);
    expect(db.redeemPromoCode).not.toHaveBeenCalled();
  });

  test('success returns ok + granted_until and forwards trimmed code', async () => {
    db.redeemPromoCode.mockResolvedValue({ ok: true, granted_until: '2027-06-03T00:00:00Z', grant_days: 365 });
    const res = await request(app).post('/api/subscription/redeem').send({ code: '  FREEYEAR  ' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, grant_days: 365 });
    expect(db.redeemPromoCode).toHaveBeenCalledWith('hh-1', 'user-1', 'FREEYEAR');
  });

  test.each([
    ['invalid', 404],
    ['expired', 410],
    ['exhausted', 409],
    ['already_subscribed', 409],
    ['already_redeemed', 409],
    ['already_promo', 409],
    ['no_household', 400],
  ])('reason "%s" maps to HTTP %i with an error message', async (reason, status) => {
    db.redeemPromoCode.mockResolvedValue({ ok: false, reason });
    const res = await request(app).post('/api/subscription/redeem').send({ code: 'X' });
    expect(res.status).toBe(status);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('unknown reason falls back to 400', async () => {
    db.redeemPromoCode.mockResolvedValue({ ok: false, reason: 'something_new' });
    const res = await request(app).post('/api/subscription/redeem').send({ code: 'X' });
    expect(res.status).toBe(400);
  });

  test('500 when the redeem helper throws', async () => {
    db.redeemPromoCode.mockRejectedValue(new Error('boom'));
    const res = await request(app).post('/api/subscription/redeem').send({ code: 'X' });
    expect(res.status).toBe(500);
  });
});
