/**
 * Channel test for the renewal nudge: it must ride the ping router
 * (push + notification centre) for every adult, never WhatsApp, and
 * still honour the per-user opt-out set back when it did.
 */

jest.mock('../db/queries', () => ({
  getSubscriptionsRenewingBetween: jest.fn(),
  getHouseholdMembers: jest.fn(),
  getNotificationPreferences: jest.fn(),
  updateSubscriptionRenewal: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/ping-router', () => ({
  deliverPing: jest.fn().mockResolvedValue({ channel: 'push' }),
}));

const db = require('../db/queries');
const { deliverPing } = require('../services/ping-router');
const { runSubscriptionRemindersForHousehold, buildReminderMessage } = require('./subscription-reminders');

const HH = 'hh-1';

function futureYmd(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

describe('subscription reminders ride the ping router', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.getSubscriptionsRenewingBetween.mockResolvedValue([
      { id: 'sub-1', household_id: HH, name: 'Netflix', amount: 9.99, currency: 'GBP', next_renewal_at: futureYmd(2), reminded_for_date: null, recurrence: 'monthly' },
    ]);
    db.getHouseholdMembers.mockResolvedValue([
      { id: 'u-adult', name: 'Grant', member_type: 'adult', whatsapp_linked: false },
      { id: 'u-kid', name: 'Kid', member_type: 'dependent' },
    ]);
    db.getNotificationPreferences.mockResolvedValue(null);
  });

  test('pings adults (WhatsApp link not required), never dependents', async () => {
    const res = await runSubscriptionRemindersForHousehold(HH);
    expect(res.sent).toBe(1);
    expect(deliverPing).toHaveBeenCalledTimes(1);
    const [member, ping] = deliverPing.mock.calls[0];
    expect(member.id).toBe('u-adult');
    expect(ping.body).toContain('Netflix');
    expect(ping.body).toContain('renews on');
    expect(ping.data.type).toBe('subscription_reminder');
  });

  test('the legacy opt-out still silences the nudge', async () => {
    db.getNotificationPreferences.mockResolvedValue({ whatsapp_subscription_reminder: false });
    const res = await runSubscriptionRemindersForHousehold(HH);
    expect(deliverPing).not.toHaveBeenCalled();
    // The row is still marked reminded - the skip is per-user, not per-sub.
    expect(res.sent).toBe(1);
  });

  test('message has no WhatsApp reply coaching', () => {
    const msg = buildReminderMessage({ name: 'Netflix', amount: 9.99, currency: 'GBP', next_renewal_at: futureYmd(2) });
    expect(msg).not.toMatch(/reply/i);
    expect(msg).not.toContain('*');
  });
});
