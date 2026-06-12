jest.mock('../db/queries', () => ({
  getStaleDeviceLinks: jest.fn(),
  updateDeviceCalendarLink: jest.fn().mockResolvedValue(),
}));
jest.mock('./push', () => ({
  sendToUser: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }),
}));

const db = require('../db/queries');
const push = require('./push');
const {
  shouldNudgeLink,
  nudgeMessage,
  runStaleDeviceNudgeCheck,
} = require('./stale-device-nudge');

const NOW = new Date('2026-06-12T17:30:00Z');
const daysAgo = (d) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000).toISOString();

const LINK = (over = {}) => ({
  id: 'L1', source: 'device', sync_enabled: true, device_owner_user_id: 'u-1',
  display_name: 'Family', last_synced_at: daysAgo(4), stale_nudge_sent_at: null, ...over,
});

describe('shouldNudgeLink', () => {
  test('freshly-synced links are left alone', () => {
    expect(shouldNudgeLink(LINK({ last_synced_at: daysAgo(1) }), NOW)).toBe(false);
  });

  test('stale link never nudged this period → nudge', () => {
    expect(shouldNudgeLink(LINK(), NOW)).toBe(true);
  });

  test('already nudged for THIS stale period → quiet', () => {
    expect(shouldNudgeLink(LINK({ stale_nudge_sent_at: daysAgo(2) }), NOW)).toBe(false);
  });

  test('a sync AFTER the last nudge re-arms the nudge for the next stale period', () => {
    expect(shouldNudgeLink(LINK({ last_synced_at: daysAgo(4), stale_nudge_sent_at: daysAgo(20) }), NOW)).toBe(true);
  });

  test('still stale a week after the last nudge → one repeat', () => {
    expect(shouldNudgeLink(LINK({ last_synced_at: daysAgo(12), stale_nudge_sent_at: daysAgo(8) }), NOW)).toBe(true);
  });

  test('links dead beyond the give-up window are never nudged (badge only)', () => {
    expect(shouldNudgeLink(LINK({ last_synced_at: daysAgo(45), stale_nudge_sent_at: daysAgo(10) }), NOW)).toBe(false);
  });

  test('tombstoned, never-synced and URL-feed rows are excluded', () => {
    expect(shouldNudgeLink(LINK({ sync_enabled: false }), NOW)).toBe(false);
    expect(shouldNudgeLink(LINK({ last_synced_at: null }), NOW)).toBe(false);
    expect(shouldNudgeLink(LINK({ source: 'ical' }), NOW)).toBe(false);
  });
});

describe('nudgeMessage', () => {
  test('one calendar reads naturally and counts the stale days', () => {
    const msg = nudgeMessage([LINK()], NOW);
    expect(msg.body).toMatch(/"Family" hasn't synced from your iPhone in 4 days/);
  });

  test('several calendars list two then summarise the rest', () => {
    const msg = nudgeMessage([
      LINK(), LINK({ display_name: 'Work' }), LINK({ display_name: 'Kids' }),
    ], NOW);
    expect(msg.body).toMatch(/"Family", "Work" and 1 more/);
  });
});

describe('runStaleDeviceNudgeCheck', () => {
  beforeEach(() => jest.clearAllMocks());

  test('one push per owner, links marked BEFORE sending', async () => {
    db.getStaleDeviceLinks.mockResolvedValue([
      LINK({ id: 'L1' }),
      LINK({ id: 'L2', display_name: 'Work' }),
      LINK({ id: 'L3', device_owner_user_id: 'u-2', display_name: 'Mine' }),
    ]);
    const res = await runStaleDeviceNudgeCheck(NOW);
    expect(res.nudged).toBe(2);
    expect(push.sendToUser).toHaveBeenCalledTimes(2);
    expect(db.updateDeviceCalendarLink).toHaveBeenCalledWith('L1', { stale_nudge_sent_at: NOW.toISOString() });
    expect(db.updateDeviceCalendarLink).toHaveBeenCalledWith('L2', expect.anything());
    expect(db.updateDeviceCalendarLink).toHaveBeenCalledWith('L3', expect.anything());
  });

  test('if marking fails (column missing pre-migration) the push is suppressed', async () => {
    db.getStaleDeviceLinks.mockResolvedValue([LINK()]);
    db.updateDeviceCalendarLink.mockRejectedValue(new Error('column "stale_nudge_sent_at" does not exist'));
    const res = await runStaleDeviceNudgeCheck(NOW);
    expect(res.nudged).toBe(0);
    expect(push.sendToUser).not.toHaveBeenCalled();
  });

  test('query failure degrades to a no-op', async () => {
    db.getStaleDeviceLinks.mockRejectedValue(new Error('boom'));
    const res = await runStaleDeviceNudgeCheck(NOW);
    expect(res.nudged).toBe(0);
  });

  test('links the throttle filters out are not re-marked', async () => {
    db.getStaleDeviceLinks.mockResolvedValue([LINK({ stale_nudge_sent_at: daysAgo(1) })]);
    const res = await runStaleDeviceNudgeCheck(NOW);
    expect(res.nudged).toBe(0);
    expect(db.updateDeviceCalendarLink).not.toHaveBeenCalled();
  });
});
