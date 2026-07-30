/**
 * The 1.10.1 duplicate-household incident, pinned.
 *
 * Onboarding v4 could fire create-household twice for one signup (the
 * completeSignup path and the resume effect, concurrently). Both calls passed
 * the route's early "already belong to a household" guard because neither had
 * committed yet - two households, two operator alerts, the user assigned to
 * whichever updateUser ran last, the other left as a 0-member orphan.
 *
 * The fix is an atomic claim: only one call can win the conditional
 * `household_id IS NULL` update. The loser deletes the household it just
 * created and answers 200 with the WINNER's session - so a duplicated client
 * call still succeeds, and the database can no longer end up with orphans no
 * matter what any client does.
 */
jest.mock('../db/queries', () => ({
  createHousehold: jest.fn(),
  pickColorForNewMember: jest.fn(async () => 'red'),
  claimHouseholdForUser: jest.fn(),
  deleteEmptyHousehold: jest.fn(async () => true),
  getUserById: jest.fn(),
  getHouseholdById: jest.fn(async (id) => ({ id, name: 'The Nest', trial_ends_at: null })),
  createRefreshToken: jest.fn(async () => {}),
  markEmailSentIfNew: jest.fn(async () => true),
  seedStarterRecipes: jest.fn(async () => {}),
}));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'u1', name: 'Ana', email: 'a@b.c' }; next(); },
  signToken: jest.fn(() => 'jwt'),
}));
jest.mock('../middleware/turnstile', () => ({ requireTurnstile: (_req, _res, next) => next() }));
jest.mock('../services/email', () => ({ sendAdminAlert: jest.fn(async () => {}), sendWelcomeEmail: jest.fn(async () => {}) }));
jest.mock('../services/publicHolidays', () => ({ seedHolidaysForNewHousehold: jest.fn(async () => {}) }));
jest.mock('../services/cache', () => ({ invalidate: jest.fn(), get: jest.fn(), set: jest.fn() }));
jest.mock('../services/stripe', () => ({}));
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {}, getUserClient: jest.fn() }));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');
const email = require('../services/email');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/auth', require('./auth'));
  return a;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  jest.clearAllMocks();
  db.pickColorForNewMember.mockResolvedValue('red');
  db.deleteEmptyHousehold.mockResolvedValue(true);
  db.getHouseholdById.mockResolvedValue({ id: 'h-win', name: 'The Nest', trial_ends_at: null });
  db.createRefreshToken.mockResolvedValue(undefined);
  db.markEmailSentIfNew.mockResolvedValue(true);
});

it('winner: claims atomically, gets 201, alerts fire once', async () => {
  db.createHousehold.mockResolvedValue({ id: 'h-win', name: 'The Nest', timezone: 'Europe/London' });
  db.claimHouseholdForUser.mockResolvedValue({ id: 'u1', household_id: 'h-win', name: 'Ana', email: 'a@b.c', role: 'admin' });

  const res = await request(app()).post('/api/auth/create-household').send({ name: 'The Nest' });
  await flush();

  expect(res.status).toBe(201);
  expect(db.claimHouseholdForUser).toHaveBeenCalledWith('u1', 'h-win', 'red');
  expect(email.sendAdminAlert).toHaveBeenCalledTimes(1);
  expect(db.deleteEmptyHousehold).not.toHaveBeenCalled();
});

it('loser: deletes its own household, sends NOTHING, answers with the winner session', async () => {
  db.createHousehold.mockResolvedValue({ id: 'h-orphan', name: 'The Nest', timezone: 'Europe/London' });
  db.claimHouseholdForUser.mockResolvedValue(null); // another call won
  db.getUserById.mockResolvedValue({ id: 'u1', household_id: 'h-win', name: 'Ana', email: 'a@b.c', role: 'admin' });

  const res = await request(app()).post('/api/auth/create-household').send({ name: 'The Nest' });
  await flush();

  expect(res.status).toBe(200);
  // The response carries the WINNING household, so the duplicate client call
  // still ends signed in to the right place.
  expect(res.body.household?.id).toBe('h-win');
  expect(db.deleteEmptyHousehold).toHaveBeenCalledWith('h-orphan');
  // The whole point of the incident: no second operator alert, no second
  // welcome email, no orphan seeding.
  expect(email.sendAdminAlert).not.toHaveBeenCalled();
  expect(email.sendWelcomeEmail).not.toHaveBeenCalled();
  expect(db.seedStarterRecipes).not.toHaveBeenCalled();
});

it('the concurrent pair: exactly one household survives, exactly one alert', async () => {
  let claims = 0;
  db.createHousehold
    .mockResolvedValueOnce({ id: 'h-1', name: 'The Nest', timezone: 'Europe/London' })
    .mockResolvedValueOnce({ id: 'h-2', name: 'The Nest', timezone: 'Europe/London' });
  db.claimHouseholdForUser.mockImplementation(async (_u, hid) => {
    claims += 1;
    return claims === 1 ? { id: 'u1', household_id: hid, name: 'Ana', email: 'a@b.c', role: 'admin' } : null;
  });
  db.getUserById.mockResolvedValue({ id: 'u1', household_id: 'h-1', name: 'Ana', email: 'a@b.c', role: 'admin' });

  const server = app();
  const [r1, r2] = await Promise.all([
    request(server).post('/api/auth/create-household').send({ name: 'The Nest' }),
    request(server).post('/api/auth/create-household').send({ name: 'The Nest' }),
  ]);
  await flush();

  expect([r1.status, r2.status].sort()).toEqual([200, 201]);
  expect(email.sendAdminAlert).toHaveBeenCalledTimes(1);
  expect(db.deleteEmptyHousehold).toHaveBeenCalledTimes(1);
  expect(db.deleteEmptyHousehold).toHaveBeenCalledWith('h-2');
});
