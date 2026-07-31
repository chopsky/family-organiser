/**
 * POST /api/household/setup-nudges/dismiss
 *
 * The × on a home-screen setup tile. Per-task, per-USER, permanent — a
 * one-person household has nobody to invite, and dismissing that tile has to
 * stick across devices, which is why this is a server write rather than the
 * localStorage every other nudge in the app uses.
 */
jest.mock('../db/queries', () => ({
  dismissSetupNudge: jest.fn(async () => ['invite']),
  SETUP_NUDGE_IDS: ['invite', 'wa', 'cal', 'rem', 'school'],
  getHouseholdPreferences: jest.fn(),
  getHouseholdMembers: jest.fn(),
}));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'u1' }; next(); },
  requireHousehold: (req, _res, next) => { req.householdId = 'h1'; next(); },
  requireAdmin: (_req, _res, next) => next(),
}));
jest.mock('../services/cache', () => ({ invalidate: jest.fn(), get: jest.fn(), set: jest.fn() }));
jest.mock('../services/email', () => ({}));
// household.js requires db/client at module scope; the real one wants Supabase env.
jest.mock('../db/client', () => ({ supabase: { from: jest.fn() }, supabaseAdmin: { from: jest.fn() }, getUserClient: jest.fn() }));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');
const cache = require('../services/cache');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/household', require('./household'));
  return a;
}

const fire = (body) => request(app()).post('/api/household/setup-nudges/dismiss').send(body || {});

beforeEach(() => jest.clearAllMocks());

it('records a dismissal for the signed-in user', async () => {
  const res = await fire({ task: 'invite' });

  expect(res.status).toBe(200);
  expect(db.dismissSetupNudge).toHaveBeenCalledWith('u1', 'invite');
});

it('drops the digest cache so the tile does not reappear for a minute', async () => {
  // The dashboard reads dismissals off the cached digest. Without this the
  // tile comes back on the next load and the × looks broken.
  await fire({ task: 'cal' });

  expect(cache.invalidate).toHaveBeenCalledWith('digest:h1');
});

it('accepts the school task (added 2026-07-31, gated client-side on having a child)', async () => {
  const res = await request(app()).post('/api/household/setup-nudges/dismiss').send({ task: 'school' });
  expect(res.status).toBe(200);
});

it('rejects a task id that is not on the allowlist', async () => {
  const res = await fire({ task: 'wipe_everything' });

  expect(res.status).toBe(400);
  expect(db.dismissSetupNudge).not.toHaveBeenCalled();
});

it('rejects a missing task rather than writing something empty', async () => {
  const res = await fire({});

  expect(res.status).toBe(400);
  expect(db.dismissSetupNudge).not.toHaveBeenCalled();
});

it('surfaces a write failure instead of claiming success', async () => {
  db.dismissSetupNudge.mockRejectedValueOnce(new Error('column does not exist'));
  jest.spyOn(console, 'error').mockImplementation(() => {});

  const res = await fire({ task: 'wa' });

  expect(res.status).toBe(500);
  console.error.mockRestore();
});
