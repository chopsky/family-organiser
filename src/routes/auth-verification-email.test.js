/**
 * What lands in the inbox when someone registers or asks for another email.
 *
 * Two things are pinned here because both were quietly wrong:
 *
 *   1. A RESEND used to mint a token with no code. Since a code is matched
 *      against the NEWEST unused row, that resend didn't just arrive
 *      code-less — it retired the working code from the first email. Someone
 *      on the code screen who tapped "Send another" was left with no way to
 *      finish where they stood, which is the entire point of the code.
 *
 *   2. Ordering is per-surface. In the app the link and the code are NOT
 *      equivalent: the link navigates away from the screen holding a pasted
 *      calendar address that exists in memory only. So the app's email leads
 *      with the code; the website's leads with the button.
 */
jest.mock('../db/queries', () => ({
  getUserByEmail: jest.fn(),
  getUserById: jest.fn(),
  createUserWithEmail: jest.fn(),
  createEmailVerificationToken: jest.fn(),
  getHouseholdById: jest.fn(async () => null),
  getUserSubscription: jest.fn(async () => null),
  createRefreshToken: jest.fn(async () => ({ token: 'refresh-test' })),
  getHouseholdMembers: jest.fn(async () => []),
  getInviteByToken: jest.fn(async () => null),
  getInviteByEmail: jest.fn(async () => null),
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
jest.mock('../utils/password-strength', () => ({ validatePassword: jest.fn(async () => ({ valid: true })) }));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');
const email = require('../services/email');
const router = require('./auth');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/auth', router);
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  db.getUserByEmail.mockResolvedValue(null);
  db.createUserWithEmail.mockResolvedValue({ id: 'u1', email: 'nia@example.com', name: 'Nia' });
  // Echo the code back the way the real insert does, post-migration.
  db.createEmailVerificationToken.mockImplementation(async (_u, _t, _e, code) => ({ id: 'row1', code }));
});

const args = () => email.sendVerificationEmail.mock.calls[0];

describe('registering', () => {
  const register = (body) => request(app())
    .post('/api/auth/register')
    .send({ email: 'nia@example.com', password: 'correct-horse-battery', name: 'Nia', ...body });

  it('leads with the code when the sign-up came from the app', async () => {
    await register({ client: 'app' });

    expect(args()[3]).toMatch(/^[A-Z0-9]{6}$/); // a real code, not null
    expect(args()[4]).toEqual({ codeFirst: true });
  });

  it('leads with the button on the website', async () => {
    await register({});

    expect(args()[3]).toMatch(/^[A-Z0-9]{6}$/); // web still GETS a code…
    expect(args()[4]).toEqual({ codeFirst: false }); // …it just isn't first
  });

  it('sends no code at all when the row could not store one', async () => {
    // Pre-migration fallback: createToken drops the column. Printing a code
    // the row doesn't have would hand out six characters that can never work.
    db.createEmailVerificationToken.mockResolvedValue({ id: 'row1' });

    await register({ client: 'app' });

    expect(args()[3]).toBeNull();
  });
});

describe('resending', () => {
  const resend = (body) => request(app()).post('/api/auth/resend-verification').send(body);

  beforeEach(() => {
    db.getUserByEmail.mockResolvedValue({
      id: 'u1', email: 'nia@example.com', name: 'Nia', email_verified: false,
    });
  });

  it('carries a code, so the code screen still has something to receive', async () => {
    await resend({ email: 'nia@example.com', client: 'app' });

    expect(db.createEmailVerificationToken).toHaveBeenCalledWith(
      'u1', expect.any(String), expect.any(String), expect.stringMatching(/^[A-Z0-9]{6}$/),
    );
    expect(args()[3]).toMatch(/^[A-Z0-9]{6}$/);
    expect(args()[4]).toEqual({ codeFirst: true });
  });

  it('uses the same alphabet as the first code — no 0/O/1/I/L/U', async () => {
    await resend({ email: 'nia@example.com' });

    expect(args()[3]).not.toMatch(/[01OILU]/);
  });

  it('stays silent for an address with no unverified account', async () => {
    db.getUserByEmail.mockResolvedValue(null);

    const res = await resend({ email: 'nobody@example.com' });

    expect(res.status).toBe(200); // never confirms who has an account
    expect(email.sendVerificationEmail).not.toHaveBeenCalled();
  });
});
