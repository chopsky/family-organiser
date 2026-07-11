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

describe('PATCH /api/household/profile — kid_color premium-theme gating', () => {
  beforeEach(() => {
    db.getHouseholdMembers.mockResolvedValue([{ id: 'me' }, { id: 'olivia', member_type: 'dependent' }]);
    db.updateUser.mockResolvedValue({ id: 'olivia' });
    db.getKidCosmetics.mockResolvedValue([]); // owns nothing unless a test overrides
  });

  test('a free preset colour is allowed without ownership', async () => {
    const res = await request(makeApp()).patch('/api/household/profile').send({ user_id: 'olivia', kid_color: 'sky' });
    expect(res.status).toBe(200);
    expect(db.updateUser).toHaveBeenCalledWith('olivia', expect.objectContaining({ kid_color: 'sky' }));
  });

  test('a premium theme is allowed when the kid owns it', async () => {
    db.getKidCosmetics.mockResolvedValue([{ cosmetic_key: 'galaxy', kind: 'theme' }]);
    const res = await request(makeApp()).patch('/api/household/profile').send({ user_id: 'olivia', kid_color: 'galaxy' });
    expect(res.status).toBe(200);
    expect(db.updateUser).toHaveBeenCalledWith('olivia', expect.objectContaining({ kid_color: 'galaxy' }));
  });

  test('a premium theme the kid does NOT own is rejected (star economy not bypassable)', async () => {
    db.getKidCosmetics.mockResolvedValue([]); // not owned
    const res = await request(makeApp()).patch('/api/household/profile').send({ user_id: 'olivia', kid_color: 'galaxy' });
    expect(res.status).toBe(400);
    expect(db.updateUser).not.toHaveBeenCalled();
  });

  test('an unknown kid colour is rejected', async () => {
    const res = await request(makeApp()).patch('/api/household/profile').send({ user_id: 'olivia', kid_color: 'nope' });
    expect(res.status).toBe(400);
    expect(db.updateUser).not.toHaveBeenCalled();
  });
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
    expect(db.updateUser).toHaveBeenCalledWith('mason', { avatar_url: expect.any(String), avatar_id: null });
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
    expect(db.updateUser).toHaveBeenCalledWith('me', { avatar_url: expect.any(String), avatar_id: null });
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

  it('removes ONLY the target member\'s files, never other members\' avatars', async () => {
    db.getHouseholdMembers.mockResolvedValue([{ id: 'me' }, { id: 'mason' }]);
    db.updateUser.mockResolvedValue({ avatar_url: null });
    // storage list() ignores `prefix`, so the route gets the WHOLE folder back
    // and must filter to the target's files itself.
    mockStorage.list.mockResolvedValue({ data: [
      { name: 'me.jpg' }, { name: 'mason.jpg' }, { name: 'mason.png' }, { name: 'household.jpg' },
    ] });

    const res = await request(makeApp()).delete('/api/household/profile/avatar?userId=mason');

    expect(res.status).toBe(200);
    expect(mockStorage.remove).toHaveBeenCalledTimes(1);
    expect(mockStorage.remove).toHaveBeenCalledWith(['h1/mason.jpg', 'h1/mason.png']);
    const removed = mockStorage.remove.mock.calls[0][0];
    expect(removed).not.toContain('h1/me.jpg');
    expect(removed).not.toContain('h1/household.jpg');
  });
});

describe('DELETE /api/household/avatar (household photo)', () => {
  it('removes ONLY the household photo, never member avatars', async () => {
    db.updateHouseholdSettings.mockResolvedValue({ avatar_url: null });
    mockStorage.list.mockResolvedValue({ data: [
      { name: 'household.jpg' }, { name: 'me.jpg' }, { name: 'mason.png' },
    ] });

    const res = await request(makeApp()).delete('/api/household/avatar');

    expect(res.status).toBe(200);
    expect(mockStorage.remove).toHaveBeenCalledWith(['h1/household.jpg']);
    const removed = mockStorage.remove.mock.calls[0][0];
    expect(removed).not.toContain('h1/me.jpg');
    expect(removed).not.toContain('h1/mason.png');
  });
});

describe('learned assistant preferences (review + correct)', () => {
  it('GET /preferences resolves member names and returns the list', async () => {
    db.getHouseholdPreferences.mockResolvedValue([
      { id: 'p1', key: 'allergy', value: 'nuts', member_id: 'lynn' },
      { id: 'p2', key: 'schedule', value: 'Tuesdays are soccer', member_id: null },
    ]);
    db.getHouseholdMembers.mockResolvedValue([{ id: 'lynn', name: 'Lynn' }]);

    const res = await request(makeApp()).get('/api/household/preferences');
    expect(res.status).toBe(200);
    expect(res.body.preferences).toHaveLength(2);
    expect(res.body.preferences[0].member_name).toBe('Lynn');
    expect(res.body.preferences[1].member_name).toBeNull();
  });

  it('DELETE /preferences/:id scopes the delete to the caller household', async () => {
    db.deleteHouseholdPreference.mockResolvedValue(true);
    const res = await request(makeApp()).delete('/api/household/preferences/p1');
    expect(res.status).toBe(200);
    // householdId comes from the auth middleware (h1), never the client —
    // a member can only ever delete their own household's rows.
    expect(db.deleteHouseholdPreference).toHaveBeenCalledWith('p1', 'h1');
  });
});
