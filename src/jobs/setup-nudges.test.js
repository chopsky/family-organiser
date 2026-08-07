/**
 * Unit tests for the setup/verify email-nudge cron (src/jobs/setup-nudges.js).
 *
 * What's covered:
 *   • Setup nudge: send-then-stamp order, and no stamp when the send throws
 *     (next tick retries).
 *   • Verify nudge: fresh token+code minted via db.createEmailVerificationToken
 *     (resend-verification semantics), stored code passed through to the
 *     sender, stamp only after a successful send.
 *   • A mint failure skips both the send and the stamp.
 *   • One cohort failing outright doesn't starve the other.
 */
// Factory mocks (not automocks): automocking ../db/queries would require()
// the real module, which pulls in db/client.js and throws without Supabase
// env vars (see src/services/schoolDirectory.test.js).
jest.mock('../db/queries', () => ({
  findUsersAwaitingSetupNudge: jest.fn(),
  findUsersAwaitingVerifyNudge: jest.fn(),
  markSetupNudgeSent: jest.fn(),
  markVerifyNudgeSent: jest.fn(),
  createEmailVerificationToken: jest.fn(),
}));
jest.mock('../services/email', () => ({
  sendSetupNudgeEmail: jest.fn(),
  sendVerifyNudgeEmail: jest.fn(),
}));

const db = require('../db/queries');
const email = require('../services/email');
const { runSetupNudgeCheck } = require('./setup-nudges');

const USER = (overrides = {}) => ({
  id: 'u-1', name: 'Sarah Smith', email: 'sarah@example.com', ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  db.findUsersAwaitingSetupNudge.mockResolvedValue([]);
  db.findUsersAwaitingVerifyNudge.mockResolvedValue([]);
  db.markSetupNudgeSent.mockResolvedValue();
  db.markVerifyNudgeSent.mockResolvedValue();
  // Explicit resolved defaults: clearAllMocks clears CALLS, not
  // implementations, so a mockRejectedValue from one test would otherwise
  // leak into the next.
  email.sendSetupNudgeEmail.mockResolvedValue();
  email.sendVerifyNudgeEmail.mockResolvedValue();
  db.createEmailVerificationToken.mockImplementation(
    async (userId, token, expiresAt, code) => ({ user_id: userId, token, expires_at: expiresAt, code }),
  );
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('setup nudge', () => {
  test('sends then stamps, in that order', async () => {
    const order = [];
    db.findUsersAwaitingSetupNudge.mockResolvedValue([USER()]);
    email.sendSetupNudgeEmail.mockImplementation(async () => order.push('send'));
    db.markSetupNudgeSent.mockImplementation(async () => order.push('stamp'));

    await runSetupNudgeCheck();

    expect(email.sendSetupNudgeEmail).toHaveBeenCalledWith('sarah@example.com', 'Sarah Smith');
    expect(db.markSetupNudgeSent).toHaveBeenCalledWith('u-1');
    expect(order).toEqual(['send', 'stamp']);
  });

  test('does NOT stamp when the send fails - and keeps going', async () => {
    db.findUsersAwaitingSetupNudge.mockResolvedValue([
      USER({ id: 'u-bad', email: 'bounce@example.com' }),
      USER({ id: 'u-ok', email: 'fine@example.com' }),
    ]);
    email.sendSetupNudgeEmail.mockImplementation(async (to) => {
      if (to === 'bounce@example.com') throw new Error('postmark 500');
    });

    await runSetupNudgeCheck();

    expect(email.sendSetupNudgeEmail).toHaveBeenCalledTimes(2);
    expect(db.markSetupNudgeSent).toHaveBeenCalledTimes(1);
    expect(db.markSetupNudgeSent).toHaveBeenCalledWith('u-ok');
  });

  test('no eligible users = no sends, no stamps', async () => {
    await runSetupNudgeCheck();
    expect(email.sendSetupNudgeEmail).not.toHaveBeenCalled();
    expect(db.markSetupNudgeSent).not.toHaveBeenCalled();
  });
});

describe('verify nudge', () => {
  test('mints a fresh token+code, sends with the STORED code, then stamps', async () => {
    db.findUsersAwaitingVerifyNudge.mockResolvedValue([USER({ id: 'u-v' })]);

    await runSetupNudgeCheck();

    expect(db.createEmailVerificationToken).toHaveBeenCalledTimes(1);
    const [userId, token, expiresAt, code] = db.createEmailVerificationToken.mock.calls[0];
    expect(userId).toBe('u-v');
    expect(token).toMatch(/^[0-9a-f]{64}$/);                 // 32 crypto bytes, hex
    expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
    // ~24h expiry, same as the resend-verification endpoint
    const ttl = new Date(expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(24 * 60 * 60 * 1000);

    expect(email.sendVerifyNudgeEmail).toHaveBeenCalledWith('sarah@example.com', 'Sarah Smith', token, code);
    expect(db.markVerifyNudgeSent).toHaveBeenCalledWith('u-v');
  });

  test('passes code=null when the token row has no code (pre-migration fallback)', async () => {
    db.findUsersAwaitingVerifyNudge.mockResolvedValue([USER({ id: 'u-v' })]);
    db.createEmailVerificationToken.mockResolvedValue({ token: 't' }); // no code column

    await runSetupNudgeCheck();

    expect(email.sendVerifyNudgeEmail).toHaveBeenCalledWith(
      'sarah@example.com', 'Sarah Smith', expect.any(String), null,
    );
  });

  test('does NOT stamp when the send fails', async () => {
    db.findUsersAwaitingVerifyNudge.mockResolvedValue([USER({ id: 'u-v' })]);
    email.sendVerifyNudgeEmail.mockRejectedValue(new Error('postmark down'));

    await runSetupNudgeCheck();

    expect(db.markVerifyNudgeSent).not.toHaveBeenCalled();
  });

  test('a token-mint failure skips the send AND the stamp', async () => {
    db.findUsersAwaitingVerifyNudge.mockResolvedValue([USER({ id: 'u-v' })]);
    db.createEmailVerificationToken.mockRejectedValue(new Error('insert failed'));

    await runSetupNudgeCheck();

    expect(email.sendVerifyNudgeEmail).not.toHaveBeenCalled();
    expect(db.markVerifyNudgeSent).not.toHaveBeenCalled();
  });
});

test('a setup-cohort failure does not starve the verify cohort', async () => {
  db.findUsersAwaitingSetupNudge.mockRejectedValue(new Error('db down'));
  db.findUsersAwaitingVerifyNudge.mockResolvedValue([USER({ id: 'u-v' })]);

  await runSetupNudgeCheck();

  expect(email.sendVerifyNudgeEmail).toHaveBeenCalledTimes(1);
  expect(db.markVerifyNudgeSent).toHaveBeenCalledWith('u-v');
});
