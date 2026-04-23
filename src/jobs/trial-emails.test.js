/**
 * Unit tests for the trial-emails cron (Phase 7).
 *
 * What's covered:
 *   • Day 20 / 25 / 28 find the right households via
 *     db.findHouseholdsAtTrialDay and dispatch the corresponding email.
 *   • Day 30 (trial_expired) runs on the expired-households query
 *     rather than the at-day query, and ignores trial_emails_enabled.
 *   • trial_emails_enabled=false skips day 20/25/28 but NOT day 30.
 *   • Dedup via sent_emails.markEmailSentIfNew: a repeat run is a no-op.
 *   • A household with no admin-with-email gets skipped cleanly.
 */

jest.mock('../db/queries');
jest.mock('../services/email');
jest.mock('../db/client', () => ({ supabase: { from: jest.fn() }, supabaseAdmin: { from: jest.fn() } }));

const db = require('../db/queries');
const email = require('../services/email');
const { runTrialEmailCheck } = require('./trial-emails');

const TRIALING = (overrides = {}) => ({
  id: 'hh-1',
  name: 'Smith Family',
  trial_started_at: '2026-04-01T00:00:00Z',
  trial_ends_at:    '2026-05-01T00:00:00Z',
  subscription_status: 'trialing',
  trial_emails_enabled: true,
  is_internal: false,
  ...overrides,
});

function setupDefaults() {
  db.findHouseholdsAtTrialDay.mockResolvedValue([]);
  db.findHouseholdsWithExpiredTrial.mockResolvedValue([]);
  db.markEmailSentIfNew.mockResolvedValue(true);
  db.getHouseholdPrimaryContact.mockResolvedValue({
    id: 'u-1', name: 'Sarah Smith', email: 'sarah@example.com', role: 'admin',
  });
  db.getHouseholdUsageCounts.mockResolvedValue({
    shopping_item_count: 12, meal_plan_count: 5, task_count: 3,
    calendar_event_count: 8, member_count: 4,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDefaults();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('runTrialEmailCheck — per-day dispatch', () => {
  test('day 20 households get the day-20 email', async () => {
    db.findHouseholdsAtTrialDay.mockImplementation(async (day) => {
      return day === 20 ? [TRIALING()] : [];
    });

    await runTrialEmailCheck();

    expect(email.sendTrialDay20Email).toHaveBeenCalledTimes(1);
    expect(email.sendTrialDay20Email).toHaveBeenCalledWith(expect.objectContaining({
      to: 'sarah@example.com',
      firstName: 'Sarah',
      householdId: 'hh-1',
      trialEndsAt: '2026-05-01T00:00:00Z',
      usage: expect.objectContaining({ shopping_item_count: 12 }),
    }));
    expect(email.sendTrialDay25Email).not.toHaveBeenCalled();
    expect(email.sendTrialDay28Email).not.toHaveBeenCalled();
    expect(email.sendTrialExpiredEmail).not.toHaveBeenCalled();
  });

  test('day 25 and day 28 route to the right senders', async () => {
    db.findHouseholdsAtTrialDay.mockImplementation(async (day) => {
      if (day === 25) return [TRIALING({ id: 'hh-25' })];
      if (day === 28) return [TRIALING({ id: 'hh-28' })];
      return [];
    });

    await runTrialEmailCheck();

    expect(email.sendTrialDay20Email).not.toHaveBeenCalled();
    expect(email.sendTrialDay25Email).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'hh-25' }));
    expect(email.sendTrialDay28Email).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'hh-28' }));
  });

  test('day 30 expired households get the trial_expired email', async () => {
    db.findHouseholdsWithExpiredTrial.mockResolvedValue([
      TRIALING({ subscription_status: 'expired' }),
    ]);

    await runTrialEmailCheck();

    expect(email.sendTrialExpiredEmail).toHaveBeenCalledTimes(1);
    expect(email.sendTrialExpiredEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'sarah@example.com', firstName: 'Sarah', householdId: 'hh-1',
    }));
  });
});

describe('runTrialEmailCheck — trial_emails_enabled opt-out', () => {
  test('day 20 respects trial_emails_enabled=false (skips send)', async () => {
    db.findHouseholdsAtTrialDay.mockImplementation(async (day) =>
      day === 20 ? [TRIALING({ trial_emails_enabled: false })] : []
    );

    await runTrialEmailCheck();

    expect(email.sendTrialDay20Email).not.toHaveBeenCalled();
    expect(db.markEmailSentIfNew).not.toHaveBeenCalled();
  });

  test('day 30 trial_expired ALWAYS sends, even if emails disabled', async () => {
    // The expired query returns a household that explicitly opted out —
    // the sender should still fire because trial_expired is transactional.
    db.findHouseholdsWithExpiredTrial.mockResolvedValue([
      TRIALING({ trial_emails_enabled: false, subscription_status: 'expired' }),
    ]);

    await runTrialEmailCheck();

    expect(email.sendTrialExpiredEmail).toHaveBeenCalledTimes(1);
  });
});

describe('runTrialEmailCheck — idempotency', () => {
  test('if markEmailSentIfNew returns false, no send fires', async () => {
    db.findHouseholdsAtTrialDay.mockImplementation(async (day) =>
      day === 25 ? [TRIALING()] : []
    );
    db.markEmailSentIfNew.mockResolvedValue(false); // already sent

    await runTrialEmailCheck();

    expect(email.sendTrialDay25Email).not.toHaveBeenCalled();
  });

  test('dedup is keyed per (household, email_type)', async () => {
    db.findHouseholdsAtTrialDay.mockImplementation(async (day) => {
      if (day === 20) return [TRIALING({ id: 'hh-a' }), TRIALING({ id: 'hh-b' })];
      return [];
    });
    // First call succeeds, second fails (simulate dedup catching the
    // second household because it was sent by a parallel run).
    db.markEmailSentIfNew
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await runTrialEmailCheck();

    expect(email.sendTrialDay20Email).toHaveBeenCalledTimes(1);
    expect(email.sendTrialDay20Email.mock.calls[0][0].householdId).toBe('hh-a');
  });
});

describe('runTrialEmailCheck — missing recipient', () => {
  test('household with no contactable admin is skipped without throwing', async () => {
    db.findHouseholdsAtTrialDay.mockImplementation(async (day) =>
      day === 20 ? [TRIALING()] : []
    );
    db.getHouseholdPrimaryContact.mockResolvedValue(null);

    await expect(runTrialEmailCheck()).resolves.not.toThrow();
    expect(email.sendTrialDay20Email).not.toHaveBeenCalled();
  });

  test('a failing send for one household does not block others', async () => {
    db.findHouseholdsAtTrialDay.mockImplementation(async (day) =>
      day === 20 ? [TRIALING({ id: 'hh-fail' }), TRIALING({ id: 'hh-ok' })] : []
    );
    email.sendTrialDay20Email
      .mockRejectedValueOnce(new Error('Postmark 500'))
      .mockResolvedValueOnce(undefined);

    await runTrialEmailCheck();

    expect(email.sendTrialDay20Email).toHaveBeenCalledTimes(2);
    expect(email.sendTrialDay20Email.mock.calls[1][0].householdId).toBe('hh-ok');
  });
});
