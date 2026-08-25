/**
 * Public invite-code lookup. Runs pre-auth during onboarding, so the whole
 * contract is: turns a good code into a token + display names, answers a
 * flat { valid: false } to everything else, and never fails hard.
 */
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../db/queries');

const request = require('supertest');
const express = require('express');
const db = require('../db/queries');

function app() {
  const a = express();
  a.use('/api/invites', require('./invites'));
  return a;
}

const INVITE = {
  token: 'a'.repeat(64),
  household_id: 'h1',
  invited_by: 'u-grant',
  name: 'Lynn',
  family_role: 'Mum',
  code: 'KX7M4Q',
};

describe('GET /api/invites/lookup', () => {
  beforeEach(() => jest.resetAllMocks());

  test('a good code returns the token, names, and invitee prefills', async () => {
    db.getInviteByCode.mockResolvedValue(INVITE);
    db.getHouseholdById.mockResolvedValue({ name: 'The Shapiro family' });
    db.getHouseholdMembers.mockResolvedValue([{ id: 'u-grant', name: 'Grant' }]);
    const res = await request(app()).get('/api/invites/lookup?code=KX7M4Q');
    expect(res.body).toEqual({
      valid: true,
      householdName: 'The Shapiro family',
      inviterName: 'Grant',
      token: INVITE.token,
      code: 'KX7M4Q',
      invitee: { name: 'Lynn', family_role: 'Mum' },
    });
    expect(db.getInviteByCode).toHaveBeenCalledWith('KX7M4Q');
  });

  test('token lookup returns the same shape (the invite-aware web landing)', async () => {
    db.getInviteByToken.mockResolvedValue(INVITE);
    db.getHouseholdById.mockResolvedValue({ name: 'The Shapiro family' });
    db.getHouseholdMembers.mockResolvedValue([{ id: 'u-grant', name: 'Grant' }]);
    const res = await request(app()).get(`/api/invites/lookup?token=${'a'.repeat(64)}`);
    expect(res.body.valid).toBe(true);
    expect(res.body.householdName).toBe('The Shapiro family');
    expect(res.body.code).toBe('KX7M4Q');
    expect(db.getInviteByCode).not.toHaveBeenCalled();
  });

  test('a malformed token never reaches the DB', async () => {
    const res = await request(app()).get('/api/invites/lookup?token=zzz');
    expect(res.body).toEqual({ valid: false });
    expect(db.getInviteByToken).not.toHaveBeenCalled();
  });

  test('normalises what people actually type: lowercase, hyphens, spaces', async () => {
    db.getInviteByCode.mockResolvedValue(null);
    await request(app()).get('/api/invites/lookup?code=kx7-m4q');
    expect(db.getInviteByCode).toHaveBeenCalledWith('KX7M4Q');
    await request(app()).get('/api/invites/lookup?code=' + encodeURIComponent('kx7 m4q'));
    expect(db.getInviteByCode).toHaveBeenLastCalledWith('KX7M4Q');
  });

  test('unknown code is a flat valid:false with nothing else leaked', async () => {
    db.getInviteByCode.mockResolvedValue(null);
    const res = await request(app()).get('/api/invites/lookup?code=KX7M4Q');
    expect(res.body).toEqual({ valid: false });
  });

  test('a malformed code never reaches the DB', async () => {
    for (const bad of ['abc', 'KX7M4QX', 'KX7M4O', '']) { // wrong length / O not in alphabet
      const res = await request(app()).get(`/api/invites/lookup?code=${bad}`);
      expect(res.body).toEqual({ valid: false });
    }
    expect(db.getInviteByCode).not.toHaveBeenCalled();
  });

  test('name lookups failing does not sink the token', async () => {
    db.getInviteByCode.mockResolvedValue(INVITE);
    db.getHouseholdById.mockRejectedValue(new Error('down'));
    const res = await request(app()).get('/api/invites/lookup?code=KX7M4Q');
    expect(res.body.valid).toBe(true);
    expect(res.body.token).toBe(INVITE.token);
    expect(res.body.householdName).toBeNull();
  });

  test('DB trouble fails SOFT (valid: null), never a 500', async () => {
    db.getInviteByCode.mockRejectedValue(new Error('db down'));
    const res = await request(app()).get('/api/invites/lookup?code=KX7M4Q');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: null });
  });
});

describe('invite-code utils', () => {
  const { generateInviteCode, normaliseInviteCode, isValidInviteCodeShape, displayInviteCode, CODE_ALPHABET } = require('../utils/invite-code');

  test('generated codes are 6 chars of the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const c = generateInviteCode();
      expect(c).toHaveLength(6);
      for (const ch of c) expect(CODE_ALPHABET).toContain(ch);
    }
  });

  test('the alphabet has no ambiguous glyphs', () => {
    for (const banned of ['I', 'L', 'O', 'S', '0', '1', '8']) {
      expect(CODE_ALPHABET).not.toContain(banned);
    }
  });

  test('normalise + display round-trip', () => {
    expect(normaliseInviteCode(' kx7-m4q ')).toBe('KX7M4Q');
    expect(displayInviteCode('kx7m4q')).toBe('KX7-M4Q');
    expect(isValidInviteCodeShape('KX7M4Q')).toBe(true);
    expect(isValidInviteCodeShape('KX7M4')).toBe(false);
  });
});
