/**
 * The ping router: pings go to push + the in-app centre for everyone;
 * a push-unreachable WhatsApp member gets exactly ONE routing heads-up,
 * ever, claimed atomically.
 */
jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('./push', () => ({ sendToUser: jest.fn() }));
jest.mock('./whatsapp-templates', () => ({ sendBroadcastToMember: jest.fn() }));

const db = require('../db/queries');
const push = require('./push');
const { sendBroadcastToMember } = require('./whatsapp-templates');
const { deliverPing, ROUTING_NOTICE } = require('./ping-router');

const LINKED_NO_APP = { id: 'u1', name: 'Lynn', whatsapp_linked: true, whatsapp_phone: '+447' };

beforeEach(() => jest.clearAllMocks());

test('a device-reaching push is the whole delivery', async () => {
  push.sendToUser.mockResolvedValue({ sent: 1 });
  const r = await deliverPing(LINKED_NO_APP, { title: 'T', body: 'B', category: 'calendar_reminders' });
  expect(r.channel).toBe('push');
  expect(sendBroadcastToMember).not.toHaveBeenCalled();
});

test('no device: centre copy stands, and the ONE WhatsApp heads-up goes out', async () => {
  push.sendToUser.mockResolvedValue({ sent: 0 });
  db.getActiveDeviceTokens.mockResolvedValue([]);
  db.markPingNoticeIfUnsent.mockResolvedValue(true); // we won the stamp
  const r = await deliverPing(LINKED_NO_APP, { title: 'T', body: 'B' });
  expect(r.channel).toBe('centre');
  expect(r.noticed).toBe(true);
  expect(sendBroadcastToMember).toHaveBeenCalledWith(LINKED_NO_APP, ROUTING_NOTICE);
});

test('the heads-up is once-ever: a lost stamp claim sends nothing', async () => {
  push.sendToUser.mockResolvedValue({ sent: 0 });
  db.getActiveDeviceTokens.mockResolvedValue([]);
  db.markPingNoticeIfUnsent.mockResolvedValue(false); // someone already sent it
  const r = await deliverPing(LINKED_NO_APP, { title: 'T', body: 'B' });
  expect(r.noticed).toBe(false);
  expect(sendBroadcastToMember).not.toHaveBeenCalled();
});

test('devices exist but prefs muted the category: silence is respected, no heads-up', async () => {
  push.sendToUser.mockResolvedValue({ sent: 0 }); // category muted inside sendToUser
  db.getActiveDeviceTokens.mockResolvedValue([{ token: 't1' }]);
  const r = await deliverPing(LINKED_NO_APP, { title: 'T', body: 'B', category: 'task_assigned' });
  expect(r.channel).toBe('centre');
  expect(db.markPingNoticeIfUnsent).not.toHaveBeenCalled();
  expect(sendBroadcastToMember).not.toHaveBeenCalled();
});

test('an unlinked no-device member just keeps the centre copy', async () => {
  push.sendToUser.mockResolvedValue({ sent: 0 });
  db.getActiveDeviceTokens.mockResolvedValue([]);
  const r = await deliverPing({ id: 'u2', whatsapp_linked: false }, { title: 'T', body: 'B' });
  expect(r.channel).toBe('centre');
  expect(sendBroadcastToMember).not.toHaveBeenCalled();
});

test('pre-migration stamp throw skips the notice, never crashes the ping', async () => {
  push.sendToUser.mockResolvedValue({ sent: 0 });
  db.getActiveDeviceTokens.mockResolvedValue([]);
  db.markPingNoticeIfUnsent.mockRejectedValue(new Error('column ping_notice_at does not exist'));
  const r = await deliverPing(LINKED_NO_APP, { title: 'T', body: 'B' });
  expect(r.channel).toBe('centre');
  expect(sendBroadcastToMember).not.toHaveBeenCalled();
});
