/**
 * attach-to-household accepts BOTH code systems. The invite landing page
 * and native onboarding teach the NEW invites.code ("4QK-4UD"), but web
 * signup's join screen posts here, which historically only knew the
 * legacy households.join_code - a valid new-style code was told it
 * "didn't match a household" (live repro, Chesler household, 2026-08-31).
 */
jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'u-new' }; req.householdId = null; next(); },
  requireHousehold: (_req, _res, next) => next(),
  requireAdmin: (_req, _res, next) => next(),
}));
jest.mock('../middleware/turnstile', () => ({ requireTurnstile: (_req, _res, next) => next() }));
jest.mock('../services/email', () => ({}));
jest.mock('../services/whatsapp', () => ({}));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');

// authResponse walks a lot of state - stub the pieces it touches.
function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/auth', require('./auth'));
  return a;
}

const HH = { id: 'h1', name: 'The Cheslers' };

describe('attach-to-household code systems', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.getHouseholdByCode.mockResolvedValue(null);
    db.getInviteByCode.mockResolvedValue(null);
    db.getHouseholdById.mockResolvedValue(HH);
    db.pickColorForNewMember.mockResolvedValue('sage');
    db.updateUser.mockImplementation(async (id, patch) => ({ id, ...patch }));
    db.markInviteAccepted.mockResolvedValue(undefined);
    // authResponse internals - be permissive; the assertions below only
    // care about lookups and the user update.
    db.getUserById.mockResolvedValue({ id: 'u-new', household_id: 'h1' });
    db.getHouseholdMembers.mockResolvedValue([]);
    db.createRefreshToken?.mockResolvedValue?.({ token: 't' });
  });

  test('legacy join_code still works', async () => {
    db.getHouseholdByCode.mockResolvedValue(HH);
    const res = await request(app()).post('/api/auth/attach-to-household').send({ code: '7b8150' });
    expect(db.getHouseholdByCode).toHaveBeenCalledWith('7B8150');
    expect(db.getInviteByCode).not.toHaveBeenCalled();
    expect(res.status).not.toBe(404);
  });

  test('new-style invite code (with hyphen) attaches via the invite', async () => {
    db.getInviteByCode.mockResolvedValue({ id: 'inv1', household_id: 'h1', family_role: 'Dad', color_theme: null });
    const res = await request(app()).post('/api/auth/attach-to-household').send({ code: '4qk-4ud' });
    expect(db.getInviteByCode).toHaveBeenCalledWith('4QK4UD');
    expect(db.updateUser).toHaveBeenCalledWith('u-new', expect.objectContaining({
      household_id: 'h1', role: 'member', family_role: 'Dad', color_theme: 'sage',
    }));
    expect(db.markInviteAccepted).toHaveBeenCalledWith('inv1');
    expect(res.status).not.toBe(404);
  });

  test('a code in neither system still 404s with the same message', async () => {
    const res = await request(app()).post('/api/auth/attach-to-household').send({ code: 'ZZZZZZ' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/didn't match a household/);
  });
});
