/**
 * Tests for the per-member avatar endpoints on the household router. The fix
 * here: uploading a profile photo while editing another member (e.g. a child on
 * the Family page) must update THAT member, not the logged-in user - and only
 * for a member of the caller's own household (IDOR guard).
 *
 * DB, Supabase Storage, email, cache and auth middleware are mocked so the test
 * exercises the route's targeting + guard logic without real services.
 */
const mockStorage = {
  upload: jest.fn(),
  getPublicUrl: jest.fn(),
  list: jest.fn(),
  remove: jest.fn(),
};

jest.mock('../db/queries');
jest.mock('../db/client', () => ({
  supabaseAdmin: { storage: { from: () => mockStorage } },
}));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'me', name: 'Grant' }; next(); },
  requireHousehold: (req, _res, next) => { req.householdId = 'h1'; next(); },
  requireAdmin: (req, _res, next) => next(),
}));
jest.mock('../services/email', () => ({}));
jest.mock('../services/cache', () => ({ invalidate: jest.fn() }));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');
const router = require('./household');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/household', router);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.upload.mockResolvedValue({ error: null });
  mockStorage.getPublicUrl.mockReturnValue({ data: { publicUrl: 'https://cdn/a.jpg' } });
  mockStorage.list.mockResolvedValue({ data: [] });
  mockStorage.remove.mockResolvedValue({ error: null });
});

describe('POST /api/household/profile/avatar', () => {
  it('updates the targeted member (not the caller) when userId is in the household', async () => {
    db.getHouseholdMembers.mockResolvedValue([{ id: 'me' }, { id: 'mason' }]);
    db.updateUser.mockResolvedValue({ avatar_url: 'https://cdn/a.jpg?t=1' });

    const res = await request(makeApp())
      .post('/api/household/profile/avatar')
      .field('userId', 'mason')
      .attach('avatar', Buffer.from('img'), { filename: 'p.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('mason');
    expect(db.updateUser).toHaveBeenCalledWith('mason', { avatar_url: expect.any(String) });
    // stored under the target member's id, not the caller's
    expect(mockStorage.upload).toHaveBeenCalledWith('h1/mason.jpg', expect.anything(), expect.anything());
  });

  it('404s when the target member is not in the household (IDOR guard)', async () => {
    db.getHouseholdMembers.mockResolvedValue([{ id: 'me' }]);

    const res = await request(makeApp())
      .post('/api/household/profile/avatar')
      .field('userId', 'outsider')
      .attach('avatar', Buffer.from('img'), { filename: 'p.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(404);
    expect(db.updateUser).not.toHaveBeenCalled();
    expect(mockStorage.upload).not.toHaveBeenCalled();
  });

  it('defaults to the caller when no userId is given (own-profile flow)', async () => {
    db.updateUser.mockResolvedValue({ avatar_url: 'https://cdn/a.jpg?t=1' });

    const res = await request(makeApp())
      .post('/api/household/profile/avatar')
      .attach('avatar', Buffer.from('img'), { filename: 'p.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('me');
    expect(db.updateUser).toHaveBeenCalledWith('me', { avatar_url: expect.any(String) });
    // self path skips the household membership lookup
    expect(db.getHouseholdMembers).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/household/profile/avatar', () => {
  it('clears the targeted member when userId is in the household', async () => {
    db.getHouseholdMembers.mockResolvedValue([{ id: 'me' }, { id: 'mason' }]);
    db.updateUser.mockResolvedValue({ avatar_url: null });

    const res = await request(makeApp()).delete('/api/household/profile/avatar?userId=mason');

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('mason');
    expect(db.updateUser).toHaveBeenCalledWith('mason', { avatar_url: null });
  });

  it('404s when the target member is not in the household', async () => {
    db.getHouseholdMembers.mockResolvedValue([{ id: 'me' }]);
    const res = await request(makeApp()).delete('/api/household/profile/avatar?userId=outsider');
    expect(res.status).toBe(404);
    expect(db.updateUser).not.toHaveBeenCalled();
  });
});
