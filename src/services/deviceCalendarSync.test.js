jest.mock('../db/queries', () => ({
  findDeviceCalendarLink: jest.fn(),
  findDeviceLinkByOwnerAndName: jest.fn(),
  updateDeviceCalendarLink: jest.fn().mockResolvedValue(),
  createExternalFeed: jest.fn(),
  findHouseholdUidsUnderOtherFeeds: jest.fn().mockResolvedValue([]),
  replaceFeedEventsInWindow: jest.fn().mockResolvedValue(),
}));

const db = require('../db/queries');
const {
  sanitizeEvents,
  buildEventRows,
  adoptOrCreateLink,
  syncDeviceCalendar,
  MAX_EVENTS_PER_CALENDAR,
} = require('./deviceCalendarSync');

const EV = (uid, over = {}) => ({
  uid, title: 'Swim', start: '2026-06-15T09:00:00Z', end: '2026-06-15T10:00:00Z', ...over,
});

describe('sanitizeEvents', () => {
  test('drops Housemait-prefixed UIDs (echo guard) and counts them', () => {
    const { events, echoDropped } = sanitizeEvents([
      EV('housemait-evt-abc@housemait.com'),
      EV('housemait-task-t1@housemait.com'),
      EV('real-uid-1'),
    ]);
    expect(events.map((e) => e.uid)).toEqual(['real-uid-1']);
    expect(echoDropped).toBe(2);
  });

  test('drops events missing uid or a parsable start', () => {
    const { events, invalidDropped } = sanitizeEvents([
      EV(''), { uid: 'x', title: 'No start' }, EV('ok'),
    ]);
    expect(events.map((e) => e.uid)).toEqual(['ok']);
    expect(invalidDropped).toBe(2);
  });

  test('dedupes in-batch uids, defaults title, end falls back to start', () => {
    const { events } = sanitizeEvents([
      EV('dup'), EV('dup'),
      { uid: 'bare', start: '2026-06-15T09:00:00Z' },
    ]);
    expect(events).toHaveLength(2);
    const bare = events.find((e) => e.uid === 'bare');
    expect(bare.title).toBe('Untitled event');
    expect(bare.end).toBe(bare.start);
  });

  test('caps at MAX_EVENTS_PER_CALENDAR and reports truncation', () => {
    const raw = Array.from({ length: MAX_EVENTS_PER_CALENDAR + 50 }, (_, i) => EV(`u${i}`));
    const { events, truncated } = sanitizeEvents(raw);
    expect(events).toHaveLength(MAX_EVENTS_PER_CALENDAR);
    expect(truncated).toBe(50);
  });
});

describe('buildEventRows', () => {
  test('mirrors the URL-feed column mapping', () => {
    const link = { id: 'L1', household_id: 'hh-1', color: 'plum', device_owner_user_id: 'u-1' };
    const [row] = buildEventRows(link, sanitizeEvents([EV('u1', { location: 'Pool' })]).events);
    expect(row).toMatchObject({
      household_id: 'hh-1', title: 'Swim', location: 'Pool', color: 'plum',
      source_user_id: 'u-1', external_feed_id: 'L1', external_uid: 'u1',
      visibility: 'family', all_day: false, description: null,
    });
  });
});

describe('adoptOrCreateLink (self-healing reconnect)', () => {
  beforeEach(() => jest.clearAllMocks());
  const ARGS = { householdId: 'hh-1', userId: 'u-1', deviceCalendarId: 'NEW-ID', name: 'Family', color: 'sky' };

  test('exact device-id match wins', async () => {
    db.findDeviceCalendarLink.mockResolvedValue({ id: 'L1', display_name: 'Family' });
    const link = await adoptOrCreateLink(ARGS);
    expect(link.id).toBe('L1');
    expect(db.createExternalFeed).not.toHaveBeenCalled();
  });

  test('adopts a stale link by owner+name on a new phone (no duplicate row)', async () => {
    db.findDeviceCalendarLink.mockResolvedValue(null);
    db.findDeviceLinkByOwnerAndName.mockResolvedValue({ id: 'L-old', display_name: 'Family' });
    const link = await adoptOrCreateLink(ARGS);
    expect(link.id).toBe('L-old');
    expect(link.device_calendar_id).toBe('NEW-ID');
    expect(db.updateDeviceCalendarLink).toHaveBeenCalledWith('L-old', expect.objectContaining({
      device_calendar_id: 'NEW-ID',
      feed_url: 'device://u-1/NEW-ID',
    }));
    expect(db.createExternalFeed).not.toHaveBeenCalled();
  });

  test('creates a fresh device link otherwise', async () => {
    db.findDeviceCalendarLink.mockResolvedValue(null);
    db.findDeviceLinkByOwnerAndName.mockResolvedValue(null);
    db.createExternalFeed.mockResolvedValue({ id: 'L-new' });
    const link = await adoptOrCreateLink(ARGS);
    expect(link.id).toBe('L-new');
    expect(db.createExternalFeed).toHaveBeenCalledWith(expect.objectContaining({
      source: 'device', device_owner_user_id: 'u-1', feed_url: 'device://u-1/NEW-ID',
    }));
  });
});

describe('syncDeviceCalendar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.findDeviceCalendarLink.mockResolvedValue({
      id: 'L1', household_id: 'hh-1', color: 'sky', device_owner_user_id: 'u-1',
      display_name: 'Family', last_sync_hash: 'oldhash',
    });
    db.findHouseholdUidsUnderOtherFeeds.mockResolvedValue([]);
  });
  const CAL = (over = {}) => ({
    deviceCalendarId: 'DC1', name: 'Family', hash: 'newhash',
    windowStart: '2026-05-13T00:00:00Z', windowEnd: '2029-06-12T00:00:00Z',
    events: [EV('a'), EV('b')], ...over,
  });

  test('hash match skips the apply entirely', async () => {
    const res = await syncDeviceCalendar({ householdId: 'hh-1', userId: 'u-1', calendar: CAL({ hash: 'oldhash' }) });
    expect(res.skipped).toBe(true);
    expect(db.replaceFeedEventsInWindow).not.toHaveBeenCalled();
  });

  test('changed hash replaces the window and stores the new hash', async () => {
    const res = await syncDeviceCalendar({ householdId: 'hh-1', userId: 'u-1', calendar: CAL() });
    expect(res.applied).toBe(2);
    expect(db.replaceFeedEventsInWindow).toHaveBeenCalledWith(
      'L1', '2026-05-13T00:00:00Z', '2029-06-12T00:00:00Z',
      expect.arrayContaining([expect.objectContaining({ external_uid: 'a' })]),
    );
    expect(db.updateDeviceCalendarLink).toHaveBeenCalledWith('L1', expect.objectContaining({ last_sync_hash: 'newhash' }));
  });

  test('household dedupe: uids claimed by another link are not re-inserted', async () => {
    db.findHouseholdUidsUnderOtherFeeds.mockResolvedValue(['a']);
    const res = await syncDeviceCalendar({ householdId: 'hh-1', userId: 'u-1', calendar: CAL() });
    expect(res.applied).toBe(1);
    expect(res.dedupedInHousehold).toBe(1);
    const rows = db.replaceFeedEventsInWindow.mock.calls[0][3];
    expect(rows.map((r) => r.external_uid)).toEqual(['b']);
  });

  test('rejects a calendar without id or window', async () => {
    expect((await syncDeviceCalendar({ householdId: 'hh-1', userId: 'u-1', calendar: { name: 'x' } })).ok).toBe(false);
    expect((await syncDeviceCalendar({ householdId: 'hh-1', userId: 'u-1', calendar: CAL({ windowStart: 'nope' }) })).ok).toBe(false);
  });

  test('hash-only ping with a MISMATCHED hash asks for the full payload, never wipes', async () => {
    const res = await syncDeviceCalendar({
      householdId: 'hh-1', userId: 'u-1',
      calendar: CAL({ hash: 'newhash', events: undefined }),
    });
    expect(res.needsEvents).toBe(true);
    expect(db.replaceFeedEventsInWindow).not.toHaveBeenCalled();
  });

  test('stores a NULL hash when household dedupe dropped events (so the skip can self-heal)', async () => {
    db.findHouseholdUidsUnderOtherFeeds.mockResolvedValue(['a']);
    await syncDeviceCalendar({ householdId: 'hh-1', userId: 'u-1', calendar: CAL() });
    expect(db.updateDeviceCalendarLink).toHaveBeenCalledWith('L1', expect.objectContaining({ last_sync_hash: null }));
  });

  test('dedupes against URL-feed rows via the bare series id (device uid carries #occurrence)', async () => {
    // Device uid 'series-1#2026-06-15T09:00:00Z'; URL feed stores bare 'series-1'.
    db.findHouseholdUidsUnderOtherFeeds.mockResolvedValue(['series-1']);
    const res = await syncDeviceCalendar({
      householdId: 'hh-1', userId: 'u-1',
      calendar: CAL({ events: [EV('series-1#2026-06-15T09:00:00Z'), EV('other#2026-06-16T09:00:00Z')] }),
    });
    expect(res.applied).toBe(1);
    expect(res.dedupedInHousehold).toBe(1);
    // The lookup itself must include the bare ids.
    const lookedUp = db.findHouseholdUidsUnderOtherFeeds.mock.calls[0][1];
    expect(lookedUp).toContain('series-1');
  });
});

describe('adoptOrCreateLink sibling exclusion (same-named calendars in one request)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('does NOT adopt a link that belongs to a sibling calendar in the same sync', async () => {
    db.findDeviceCalendarLink.mockResolvedValue(null);
    // A stale-looking link by name - but it's actually the iCloud "Home"
    // calendar that's ALSO in this request (id D1).
    db.findDeviceLinkByOwnerAndName.mockResolvedValue({ id: 'L1', device_calendar_id: 'D1', display_name: 'Home' });
    db.createExternalFeed.mockResolvedValue({ id: 'L2' });
    const link = await adoptOrCreateLink({
      householdId: 'hh-1', userId: 'u-1', deviceCalendarId: 'D2', name: 'Home',
      siblingCalendarIds: ['D1'],
    });
    expect(link.id).toBe('L2'); // fresh link, no cannibalising
    expect(db.updateDeviceCalendarLink).not.toHaveBeenCalled();
  });
});
