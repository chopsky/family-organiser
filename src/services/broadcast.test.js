/**
 * Broadcast routing: ONE notification per member. App users get a push,
 * WhatsApp-only members get a WhatsApp message - never both (the
 * 2026-08-03 double-notification report: an added event arrived as a
 * WhatsApp "Housemait update" AND a "New event" push on the same phone).
 */
jest.mock('./whatsapp-templates', () => ({ sendBroadcastToMember: jest.fn() }));
jest.mock('./push', () => ({ sendToUser: jest.fn(() => Promise.resolve({ sent: 1, failed: 0 })) }));
jest.mock('../db/queries', () => ({ getActiveDeviceTokens: jest.fn() }));

const { sendBroadcastToMember } = require('./whatsapp-templates');
const push = require('./push');
const db = require('../db/queries');
const { toHousehold } = require('./broadcast');

const flush = () => new Promise((r) => setTimeout(r, 0));

const MEMBERS = [
  { id: 'sender', name: 'Lynn' },
  { id: 'app-user', name: 'Grant' },
  { id: 'wa-only', name: 'Nana' },
];

beforeEach(() => {
  jest.clearAllMocks();
  db.getActiveDeviceTokens.mockImplementation(async (uid) => (uid === 'app-user' ? [{ token: 't1' }] : []));
});

test('app member gets the push ONLY; WhatsApp-only member gets WhatsApp ONLY; sender gets nothing', async () => {
  toHousehold('sender', MEMBERS, '📅 Lynn added event: Dinner', { title: 'New event', body: 'Lynn added "Dinner"', category: 'calendar_reminders' });
  await flush();

  expect(push.sendToUser).toHaveBeenCalledTimes(1);
  expect(push.sendToUser).toHaveBeenCalledWith('app-user', { title: 'New event', body: 'Lynn added "Dinner"', category: 'calendar_reminders' });
  expect(sendBroadcastToMember).toHaveBeenCalledTimes(1);
  expect(sendBroadcastToMember).toHaveBeenCalledWith(MEMBERS[2], '📅 Lynn added event: Dinner');
});

test('call sites without pushOpts still push to app users with sane defaults', async () => {
  toHousehold('sender', MEMBERS, '🛒 Lynn removed: milk');
  await flush();

  expect(push.sendToUser).toHaveBeenCalledWith('app-user', {
    title: 'Housemait update', body: '🛒 Lynn removed: milk', category: undefined,
  });
});

test('a token-lookup failure falls back to WhatsApp rather than silence', async () => {
  db.getActiveDeviceTokens.mockRejectedValue(new Error('db down'));
  toHousehold('sender', MEMBERS, 'msg');
  await flush();

  expect(push.sendToUser).not.toHaveBeenCalled();
  expect(sendBroadcastToMember).toHaveBeenCalledTimes(2);
});

test('one member erroring never blocks the others', async () => {
  push.sendToUser.mockRejectedValue(new Error('apns down'));
  toHousehold('sender', MEMBERS, 'msg');
  await flush();

  expect(sendBroadcastToMember).toHaveBeenCalledWith(MEMBERS[2], 'msg');
});
