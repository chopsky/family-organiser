/**
 * POST /api/household/invite-link - the email-less invite behind the
 * welcome screen's one-tap partner share. Contract: reuse the live open
 * invite, mint one (token + code, email '') when there is none, never
 * send an email, and hide the code cleanly pre-migration.
 */
let mockUser;

jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabaseAdmin: {} }));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = mockUser; next(); },
  requireHousehold: (req, _res, next) => { req.householdId = 'h1'; next(); },
  requireAdmin: (_req, _res, next) => next(),
}));
jest.mock('../services/email', () => ({ sendInviteEmail: jest.fn() }));
jest.mock('../services/cache', () => ({ invalidate: jest.fn() }));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');
const email = require('../services/email');
const router = require('./household');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/household', router);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'admin1', name: 'Grant' };
});

test('mints an open invite (email "", token + code) when none is live', async () => {
  db.getOpenInvite.mockResolvedValue(null);
  db.createInvite.mockImplementation((row) => Promise.resolve({ ...row, token: row.token, code: row.code }));
  const res = await request(makeApp()).post('/api/household/invite-link');
  expect(res.status).toBe(200);
  const created = db.createInvite.mock.calls[0][0];
  expect(created.email).toBe('');
  expect(created.token).toMatch(/^[0-9a-f]{64}$/);
  expect(created.code).toMatch(/^[A-Z2-9]{6}$/);
  expect(res.body.url).toBe(`https://housemait.com/signup?invite=${created.token}`);
  expect(res.body.code).toBe(created.code);
  expect(email.sendInviteEmail).not.toHaveBeenCalled(); // WhatsApp is the delivery
});

test('reuses the live open invite instead of minting per visit', async () => {
  db.getOpenInvite.mockResolvedValue({ token: 'a'.repeat(64), code: 'KX7M4Q' });
  const res = await request(makeApp()).post('/api/household/invite-link');
  expect(db.createInvite).not.toHaveBeenCalled();
  expect(res.body.code).toBe('KX7M4Q');
});

test('pre-migration invites come back codeless, not "undefined"', async () => {
  db.getOpenInvite.mockResolvedValue(null);
  // createInvite's own degradation drops the code column when unmigrated.
  db.createInvite.mockImplementation((row) => Promise.resolve({ token: row.token }));
  const res = await request(makeApp()).post('/api/household/invite-link');
  expect(res.status).toBe(200);
  expect(res.body.code).toBeNull();
});
