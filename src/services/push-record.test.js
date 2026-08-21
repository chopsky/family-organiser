/**
 * The notification centre's durable-copy rules. Push delivery itself is
 * mocked away here - what matters is WHO gets a recorded row and when.
 */
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../db/queries');

const db = require('../db/queries');
const push = require('./push');

beforeEach(() => {
  jest.clearAllMocks();
  db.recordNotifications.mockResolvedValue(1);
  db.getActiveDeviceTokens.mockResolvedValue([]);
  db.getNotificationPreferences.mockResolvedValue({});
  db.getHouseholdMembers.mockResolvedValue([]);
  db.getHouseholdDeviceTokens.mockResolvedValue([]);
});

describe('sendToUser records the durable copy', () => {
  test('records even with no device registered (push unconfigured in tests)', async () => {
    await push.sendToUser('u1', { title: 'Brief', body: 'A long body', data: { type: 'morning_brief' }, householdId: 'h1' });
    expect(db.recordNotifications).toHaveBeenCalledTimes(1);
    const [rows] = db.recordNotifications.mock.calls[0];
    expect(rows).toEqual([expect.objectContaining({
      user_id: 'u1', household_id: 'h1', type: 'morning_brief', title: 'Brief', body: 'A long body',
    })]);
  });

  test('a disabled category records nothing - an opt-out means silence', async () => {
    db.getNotificationPreferences.mockResolvedValue({ task_assigned: false });
    await push.sendToUser('u1', { title: 'T', body: 'B', category: 'task_assigned' });
    expect(db.recordNotifications).not.toHaveBeenCalled();
  });

  test('unreadable preferences still record (never lose the notification)', async () => {
    db.getNotificationPreferences.mockRejectedValue(new Error('db blip'));
    await push.sendToUser('u1', { title: 'T', body: 'B', category: 'task_assigned' });
    expect(db.recordNotifications).toHaveBeenCalledTimes(1);
  });

  test('a recording failure never throws into the caller', async () => {
    db.recordNotifications.mockRejectedValue(new Error('table missing'));
    await expect(push.sendToUser('u1', { title: 'T', body: 'B' })).resolves.toEqual(
      expect.objectContaining({ sent: 0 }),
    );
  });
});

describe('sendToHousehold records per eligible adult', () => {
  test('one row per account member, excluding the sender and dependents', async () => {
    db.getHouseholdMembers.mockResolvedValue([
      { id: 'u1', member_type: 'account' },
      { id: 'u2', member_type: 'account' },
      { id: 'kid', member_type: 'dependent' },
    ]);
    await push.sendToHousehold('h1', 'u1', { title: 'T', body: 'B', data: { type: 'shopping_updated' } });
    const [rows] = db.recordNotifications.mock.calls[0];
    expect(rows.map((r) => r.user_id)).toEqual(['u2']);
  });

  test('members who disabled the category are skipped', async () => {
    db.getHouseholdMembers.mockResolvedValue([
      { id: 'u2', member_type: 'account' },
      { id: 'u3', member_type: 'account' },
    ]);
    db.getNotificationPreferences.mockImplementation(async (id) =>
      (id === 'u3' ? { shopping_updated: false } : {}));
    await push.sendToHousehold('h1', 'u1', { title: 'T', body: 'B', category: 'shopping_updated' });
    const [rows] = db.recordNotifications.mock.calls[0];
    expect(rows.map((r) => r.user_id)).toEqual(['u2']);
  });
});
