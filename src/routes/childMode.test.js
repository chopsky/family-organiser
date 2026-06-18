/**
 * Child Mode PIN endpoints (household router). Auth middleware + DB are mocked;
 * bcrypt is real so verify exercises a genuine hash/compare.
 */

jest.mock('../db/queries', () => ({
  getHouseholdById: jest.fn(),
  getHouseholdMembers: jest.fn().mockResolvedValue([]),
  setChildModePinHash: jest.fn().mockResolvedValue(),
  clearChildModePinHash: jest.fn().mockResolvedValue(),
  getChildModePinHash: jest.fn(),
}));
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'u-1' }; next(); },
  requireHousehold: (req, _res, next) => { req.householdId = 'hh-1'; next(); },
  requireAdmin: (_req, _res, next) => next(),
  signToken: () => 'tok',
}));
jest.mock('../services/email', () => ({}));
jest.mock('../services/cache', () => ({ get: jest.fn(() => null), set: jest.fn(), invalidate: jest.fn() }));

const express = require('express');
const request = require('supertest');
const bcrypt = require('bcrypt');
const db = require('../db/queries');
const cache = require('../services/cache');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/household', require('./household'));
  return app;
}

const app = makeApp();
const HASH_1234 = bcrypt.hashSync('1234', 4);

beforeEach(() => jest.clearAllMocks());

describe('GET /api/household', () => {
  test('omits child_mode_pin_hash and exposes child_mode_pin_set', async () => {
    db.getHouseholdById.mockResolvedValue({ id: 'hh-1', name: 'Home', child_mode_pin_hash: HASH_1234 });
    db.getHouseholdMembers.mockResolvedValue([]);
    const res = await request(app).get('/api/household');
    expect(res.status).toBe(200);
    expect(res.body.household).not.toHaveProperty('child_mode_pin_hash');
    expect(res.body.household.child_mode_pin_set).toBe(true);
  });

  test('child_mode_pin_set is false when no PIN', async () => {
    db.getHouseholdById.mockResolvedValue({ id: 'hh-1', name: 'Home', child_mode_pin_hash: null });
    const res = await request(app).get('/api/household');
    expect(res.body.household.child_mode_pin_set).toBe(false);
  });
});

describe('POST /api/household/child-mode/pin', () => {
  test('rejects a non 4-6 digit PIN', async () => {
    const res = await request(app).post('/api/household/child-mode/pin').send({ pin: 'abc' });
    expect(res.status).toBe(400);
    expect(db.setChildModePinHash).not.toHaveBeenCalled();
  });

  test('stores a hashed PIN and invalidates cache', async () => {
    const res = await request(app).post('/api/household/child-mode/pin').send({ pin: '1234' });
    expect(res.status).toBe(200);
    expect(res.body.child_mode_pin_set).toBe(true);
    expect(db.setChildModePinHash).toHaveBeenCalledWith('hh-1', expect.any(String));
    // not stored in plaintext
    expect(db.setChildModePinHash.mock.calls[0][1]).not.toBe('1234');
    expect(cache.invalidate).toHaveBeenCalledWith('members:hh-1');
  });
});

describe('DELETE /api/household/child-mode/pin', () => {
  test('clears the PIN and invalidates cache', async () => {
    const res = await request(app).delete('/api/household/child-mode/pin');
    expect(res.status).toBe(200);
    expect(res.body.child_mode_pin_set).toBe(false);
    expect(db.clearChildModePinHash).toHaveBeenCalledWith('hh-1');
    expect(cache.invalidate).toHaveBeenCalledWith('members:hh-1');
  });
});

describe('POST /api/household/child-mode/verify-pin', () => {
  test('400 when no PIN is set', async () => {
    db.getChildModePinHash.mockResolvedValue(null);
    const res = await request(app).post('/api/household/child-mode/verify-pin').send({ pin: '1234' });
    expect(res.status).toBe(400);
  });

  test('200 on correct PIN, 401 on wrong', async () => {
    db.getChildModePinHash.mockResolvedValue(HASH_1234);
    const ok = await request(app).post('/api/household/child-mode/verify-pin').send({ pin: '1234' });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    const bad = await request(app).post('/api/household/child-mode/verify-pin').send({ pin: '0000' });
    expect(bad.status).toBe(401);
    expect(bad.body.ok).toBe(false);
  });

  test('rate-limits rapid attempts (429)', async () => {
    db.getChildModePinHash.mockResolvedValue(HASH_1234);
    // Fresh router so this test owns the limiter window.
    let fresh;
    jest.isolateModules(() => { fresh = makeApp(); });
    let last;
    for (let i = 0; i < 9; i++) {
      // eslint-disable-next-line no-await-in-loop
      last = await request(fresh).post('/api/household/child-mode/verify-pin').send({ pin: '0000' });
    }
    expect(last.status).toBe(429);
  });
});
