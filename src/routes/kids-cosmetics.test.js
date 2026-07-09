/**
 * Route tests for the kids' cosmetic star-shop: the GET listing and the
 * buy → star-spend path. DB + auth mocked; the real catalogue (a premium theme
 * costing 60) drives the price so we assert the ledger writes exactly once.
 */
jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'me' }; next(); },
  requireHousehold: (req, _res, next) => { req.householdId = 'h1'; next(); },
}));
jest.mock('../services/r2', () => ({}));
jest.mock('../services/push', () => ({}));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/kids', require('./kids'));
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  db.getHouseholdMembers.mockResolvedValue([{ id: 'm', name: 'Mason', member_type: 'dependent' }]);
  db.getHouseholdById.mockResolvedValue({ timezone: 'Europe/London' });
  db.getStarBalances.mockResolvedValue({ m: 100 });
  db.getKidCosmetics.mockResolvedValue([]); // table exists, owns nothing
  db.addKidCosmetic.mockResolvedValue({ inserted: true });
  db.addStarTransaction.mockResolvedValue({ applied: true });
});

describe('GET /api/kids/cosmetics', () => {
  test('returns balance, owned keys and the priced catalogue', async () => {
    db.getKidCosmetics.mockResolvedValue([{ cosmetic_key: 'galaxy', kind: 'theme' }]);
    const res = await request(app()).get('/api/kids/cosmetics?member_id=m');
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.balance).toBe(100);
    expect(res.body.owned).toEqual(['galaxy']);
    expect(res.body.catalogue.find((c) => c.key === 'galaxy')).toMatchObject({ kind: 'theme', cost: 60 });
  });

  test('available:false when the table is missing (pre-migration)', async () => {
    db.getKidCosmetics.mockResolvedValue(null);
    const res = await request(app()).get('/api/kids/cosmetics?member_id=m');
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.owned).toEqual([]);
  });
});

describe('POST /api/kids/cosmetics/:key/buy', () => {
  test('buys an affordable cosmetic: grants once, charges its real price once', async () => {
    const res = await request(app()).post('/api/kids/cosmetics/galaxy/buy').send({ member_id: 'm' });
    expect(res.status).toBe(201);
    expect(db.addKidCosmetic).toHaveBeenCalledWith('h1', 'm', 'galaxy', 'theme', 'star');
    expect(db.addStarTransaction).toHaveBeenCalledWith(expect.objectContaining({
      memberId: 'm', delta: -60, reason: 'spend', refType: 'cosmetic', refId: 'm:galaxy',
    }));
  });

  test('rejects when the kid cannot afford it — no grant, no charge', async () => {
    db.getStarBalances.mockResolvedValue({ m: 10 });
    const res = await request(app()).post('/api/kids/cosmetics/galaxy/buy').send({ member_id: 'm' });
    expect(res.status).toBe(400);
    expect(db.addKidCosmetic).not.toHaveBeenCalled();
    expect(db.addStarTransaction).not.toHaveBeenCalled();
  });

  test('already-owned is a no-op (no double charge)', async () => {
    db.getKidCosmetics.mockResolvedValue([{ cosmetic_key: 'galaxy', kind: 'theme' }]);
    const res = await request(app()).post('/api/kids/cosmetics/galaxy/buy').send({ member_id: 'm' });
    expect(res.status).toBe(200);
    expect(res.body.alreadyOwned).toBe(true);
    expect(db.addKidCosmetic).not.toHaveBeenCalled();
    expect(db.addStarTransaction).not.toHaveBeenCalled();
  });

  test('an unknown cosmetic is a 404', async () => {
    const res = await request(app()).post('/api/kids/cosmetics/nope/buy').send({ member_id: 'm' });
    expect(res.status).toBe(404);
    expect(db.addStarTransaction).not.toHaveBeenCalled();
  });

  test('pre-migration → 503, never charges', async () => {
    db.getKidCosmetics.mockResolvedValue(null);
    const res = await request(app()).post('/api/kids/cosmetics/galaxy/buy').send({ member_id: 'm' });
    expect(res.status).toBe(503);
    expect(db.addKidCosmetic).not.toHaveBeenCalled();
    expect(db.addStarTransaction).not.toHaveBeenCalled();
  });
});
