/**
 * POST /api/auth/verify-email-code — verifying without leaving the page.
 *
 * The link and the code redeem the same row and issue the same session. The
 * code exists because a link is a NAVIGATION: onboarding v4 holds the pasted
 * calendar address in memory only (bearer credential, never persisted), so
 * following a link to a new page destroyed it. Someone who connected a
 * calendar, saw "244 events found", then verified by link ended up with no
 * calendar and no warning.
 *
 * A short code is also the brute-forceable surface the long token never was,
 * so the attempt cap is a security control, not politeness — it's pinned here.
 */
jest.mock('../db/queries', () => ({
  getUserByEmail: jest.fn(),
  getUserById: jest.fn(),
  getEmailVerificationByCode: jest.fn(),
  bumpEmailVerificationAttempts: jest.fn(),
  markEmailVerificationTokenUsed: jest.fn(),
  updateUser: jest.fn(),
  getHouseholdById: jest.fn(async () => null),
  getUserSubscription: jest.fn(async () => null),
  // authResponse mints a refresh token + reads the household alongside the JWT.
  createRefreshToken: jest.fn(async () => ({ token: 'refresh-test' })),
  getHouseholdMembers: jest.fn(async () => []),
}));
jest.mock('../middleware/auth', () => ({
  signToken: () => 'test-jwt',
  requireAuth: (req, res, next) => next(),
}));
jest.mock('../middleware/turnstile', () => ({ requireTurnstile: (req, res, next) => next() }));
jest.mock('../services/email', () => ({ sendVerificationEmail: jest.fn(), sendWelcomeEmail: jest.fn() }));
jest.mock('../services/publicHolidays', () => ({}));
jest.mock('../services/cache', () => ({ invalidate: jest.fn(), invalidatePattern: jest.fn() }));
jest.mock('../services/stripe', () => ({}));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');
const router = require('./auth');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/auth', router);
  return a;
}

const UNVERIFIED = { id: 'u1', email: 'nia@example.com', name: 'Nia', email_verified: false };
const ROW = { id: 'row1', user_id: 'u1', code: 'K7M2QF', attempts: 0 };

beforeEach(() => {
  jest.clearAllMocks();
  db.getUserByEmail.mockResolvedValue(UNVERIFIED);
  db.getUserById.mockResolvedValue({ ...UNVERIFIED, email_verified: true });
  db.updateUser.mockResolvedValue({});
  db.markEmailVerificationTokenUsed.mockResolvedValue({});
});

const post = (body) => request(app()).post('/api/auth/verify-email-code').send(body);

describe('verifying by code', () => {
  it('accepts the right code, marks the email verified and issues a session', async () => {
    db.getEmailVerificationByCode.mockResolvedValue({ row: ROW, matches: true });

    const res = await post({ email: 'nia@example.com', code: 'K7M2QF' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy(); // a session, same as the link path
    expect(db.updateUser).toHaveBeenCalledWith('u1', { email_verified: true });
    expect(db.markEmailVerificationTokenUsed).toHaveBeenCalledWith('row1');
  });

  it('is case-insensitive and ignores stray whitespace', async () => {
    // People retype these from another screen; the match happens in the query
    // layer, so here we just assert the route passes the raw input through.
    db.getEmailVerificationByCode.mockResolvedValue({ row: ROW, matches: true });

    const res = await post({ email: ' Nia@Example.com ', code: ' k7m2qf ' });

    expect(res.status).toBe(200);
    expect(db.getUserByEmail).toHaveBeenCalledWith('nia@example.com');
  });

  it('rejects a wrong code and counts the attempt', async () => {
    db.getEmailVerificationByCode.mockResolvedValue({ row: ROW, matches: false });
    db.bumpEmailVerificationAttempts.mockResolvedValue(1);

    const res = await post({ email: 'nia@example.com', code: 'AAAAAA' });

    expect(res.status).toBe(400);
    expect(db.bumpEmailVerificationAttempts).toHaveBeenCalledWith('row1');
    expect(db.updateUser).not.toHaveBeenCalled();
  });

  it('burns the code after too many wrong guesses', async () => {
    // ~729M combinations is only safe WITH this cap. Without it the code is a
    // strictly weaker door than the link it sits beside.
    db.getEmailVerificationByCode.mockResolvedValue({ row: ROW, matches: false });
    db.bumpEmailVerificationAttempts.mockResolvedValue(5);

    const res = await post({ email: 'nia@example.com', code: 'AAAAAA' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too many/i);
    expect(db.markEmailVerificationTokenUsed).toHaveBeenCalledWith('row1');
  });

  it('gives an unknown address the same answer as a wrong code', async () => {
    // Otherwise the endpoint answers "does this email have an account?".
    db.getUserByEmail.mockResolvedValue(null);
    const unknown = await post({ email: 'nobody@example.com', code: 'K7M2QF' });

    db.getUserByEmail.mockResolvedValue(UNVERIFIED);
    db.getEmailVerificationByCode.mockResolvedValue({ row: ROW, matches: false });
    db.bumpEmailVerificationAttempts.mockResolvedValue(1);
    const wrong = await post({ email: 'nia@example.com', code: 'AAAAAA' });

    expect(unknown.status).toBe(wrong.status);
    expect(unknown.body.error).toBe(wrong.body.error);
  });

  it('says so plainly when the account is already verified', async () => {
    db.getUserByEmail.mockResolvedValue({ ...UNVERIFIED, email_verified: true });

    const res = await post({ email: 'nia@example.com', code: 'K7M2QF' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already verified/i);
  });

  it('requires both fields', async () => {
    expect((await post({ email: 'nia@example.com' })).status).toBe(400);
    expect((await post({ code: 'K7M2QF' })).status).toBe(400);
  });

  it('does not verify when there is no live code row', async () => {
    db.getEmailVerificationByCode.mockResolvedValue(null);

    const res = await post({ email: 'nia@example.com', code: 'K7M2QF' });

    expect(res.status).toBe(400);
    expect(db.updateUser).not.toHaveBeenCalled();
  });
});
