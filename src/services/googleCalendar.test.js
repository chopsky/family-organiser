/**
 * Inbound Google Calendar pull. The assertions that matter most are the ones
 * the founder got burned by on the old two-way sync:
 *   - a timed event's instant is stored EXACTLY (offset embedded), never shifted
 *   - all-day events keep an inclusive end (no off-by-one bleed)
 *   - deletions are EXPLICIT (status='cancelled'), and a full-sync prune only
 *     touches rows inside the pulled window
 *   - an expired sync token (410) self-heals into a full resync
 */

const mockList = jest.fn();
const mockInsert = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockCalInsert = jest.fn();
const mockCalDelete = jest.fn();
jest.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: jest.fn().mockImplementation(() => ({ setCredentials: jest.fn() })) },
    calendar: jest.fn(() => ({
      events: { list: mockList, insert: mockInsert, update: mockUpdate, delete: mockDelete },
      calendars: { insert: mockCalInsert, delete: mockCalDelete },
    })),
  },
}));
jest.mock('../utils/calendar-token-crypto', () => ({
  decryptToken: jest.fn(() => 'refresh-token'),
  encryptToken: jest.fn(),
}));
jest.mock('../db/queries', () => ({
  getExternalFeedEvents: jest.fn().mockResolvedValue([]),
  batchUpsertExternalFeedEvents: jest.fn().mockResolvedValue(),
  batchSoftDeleteCalendarEvents: jest.fn().mockResolvedValue(),
  updateGoogleFeedSyncToken: jest.fn().mockResolvedValue(),
  recordExternalFeedSuccess: jest.fn().mockResolvedValue(),
  recordExternalFeedFailure: jest.fn().mockResolvedValue(),
  getSyncMapping: jest.fn().mockResolvedValue(null),
  upsertSyncMapping: jest.fn().mockResolvedValue({}),
  deleteSyncMapping: jest.fn().mockResolvedValue(),
  recordCalendarWriteAudit: jest.fn().mockResolvedValue(),
  getWritableConnectionsByHousehold: jest.fn().mockResolvedValue([]),
}));
jest.mock('./cache', () => ({ invalidatePattern: jest.fn() }));

const db = require('../db/queries');
const {
  googleEventToTimes, refreshGoogleFeed,
  buildGoogleEventPayload, pushEventToGoogle, deleteEventFromGoogle, isNativeEvent,
  syncEventOutbound,
} = require('./googleCalendar');

const CONN = { id: 'c1', refresh_token: 'enc', status: 'ok' };
const FEED = (over = {}) => ({
  id: 'F1', household_id: 'hh-1', user_id: 'u-1', color: 'sky',
  google_calendar_id: 'cal-1', sync_token: null, ...over,
});
const page = (items, { nextSyncToken = 'TK', nextPageToken } = {}) =>
  ({ data: { items, ...(nextPageToken ? { nextPageToken } : {}), ...(nextSyncToken ? { nextSyncToken } : {}) } });

beforeEach(() => {
  jest.clearAllMocks();
  db.getExternalFeedEvents.mockResolvedValue([]);
});

describe('googleEventToTimes', () => {
  test('timed event stores the exact UTC instant - the offset is NOT dropped or re-applied', () => {
    // 09:00 in BST (+01:00) is 08:00 UTC. The instant must survive verbatim.
    const r = googleEventToTimes({
      start: { dateTime: '2026-06-24T09:00:00+01:00', timeZone: 'Europe/London' },
      end: { dateTime: '2026-06-24T10:00:00+01:00', timeZone: 'Europe/London' },
    });
    expect(r.all_day).toBe(false);
    expect(r.start_time).toBe('2026-06-24T08:00:00.000Z');
    expect(r.end_time).toBe('2026-06-24T09:00:00.000Z');
  });

  test('a Z-suffixed time is preserved as the same instant', () => {
    const r = googleEventToTimes({ start: { dateTime: '2026-01-15T14:30:00Z' }, end: { dateTime: '2026-01-15T15:00:00Z' } });
    expect(r.start_time).toBe('2026-01-15T14:30:00.000Z');
  });

  test('all-day event keeps an inclusive end (Google end.date is exclusive)', () => {
    // A 2-day all-day event: Google sends end.date = the day AFTER the last day.
    const r = googleEventToTimes({ start: { date: '2026-06-24' }, end: { date: '2026-06-26' } });
    expect(r).toEqual({ start_time: '2026-06-24', end_time: '2026-06-25', all_day: true });
  });

  test('single-day all-day event collapses to start === end', () => {
    const r = googleEventToTimes({ start: { date: '2026-06-24' }, end: { date: '2026-06-25' } });
    expect(r).toEqual({ start_time: '2026-06-24', end_time: '2026-06-24', all_day: true });
  });
});

describe('refreshGoogleFeed', () => {
  test('upserts changed events and persists the new sync token', async () => {
    mockList.mockResolvedValueOnce(page([
      { id: 'ev-a', summary: 'Dentist', start: { dateTime: '2026-06-24T09:00:00+01:00' }, end: { dateTime: '2026-06-24T09:30:00+01:00' } },
    ], { nextSyncToken: 'TK-new' }));

    const stats = await refreshGoogleFeed(FEED(), CONN);

    expect(db.batchUpsertExternalFeedEvents).toHaveBeenCalledTimes(1);
    const rows = db.batchUpsertExternalFeedEvents.mock.calls[0][0];
    expect(rows[0]).toMatchObject({
      external_feed_id: 'F1', external_uid: 'ev-a', title: 'Dentist',
      start_time: '2026-06-24T08:00:00.000Z', all_day: false, source_user_id: 'u-1',
    });
    expect(db.updateGoogleFeedSyncToken).toHaveBeenCalledWith('F1', 'TK-new');
    expect(db.recordExternalFeedSuccess).toHaveBeenCalledWith('F1');
    expect(stats.created).toBe(1);
  });

  test('an incremental cancelled event soft-deletes only that row (explicit delete)', async () => {
    db.getExternalFeedEvents.mockResolvedValue([
      { id: 'row-gone', external_uid: 'ev-gone', start_time: '2026-06-24T08:00:00.000Z' },
      { id: 'row-keep', external_uid: 'ev-keep', start_time: '2026-06-24T08:00:00.000Z' },
    ]);
    // Incremental sync (token present) returns just the cancellation.
    mockList.mockResolvedValueOnce(page([{ id: 'ev-gone', status: 'cancelled' }], { nextSyncToken: 'TK2' }));

    const stats = await refreshGoogleFeed(FEED({ sync_token: 'OLD' }), CONN);

    expect(db.batchSoftDeleteCalendarEvents).toHaveBeenCalledWith(['row-gone'], 'hh-1');
    expect(stats.deleted).toBe(1);
    expect(db.updateGoogleFeedSyncToken).toHaveBeenCalledWith('F1', 'TK2');
  });

  test('full-sync prune removes vanished rows IN WINDOW but leaves older rows alone', async () => {
    const within = new Date().toISOString();
    const before = new Date(Date.now() - 60 * 86400_000).toISOString();
    db.getExternalFeedEvents.mockResolvedValue([
      { id: 'r-a', external_uid: 'ev-a', start_time: within },
      { id: 'r-stale', external_uid: 'ev-stale', start_time: within },
      { id: 'r-old', external_uid: 'ev-old', start_time: before },
    ]);
    // Full sync (no token) authoritative set = ev-a only.
    mockList.mockResolvedValueOnce(page([
      { id: 'ev-a', summary: 'A', start: { dateTime: '2026-06-24T09:00:00Z' }, end: { dateTime: '2026-06-24T10:00:00Z' } },
    ], { nextSyncToken: 'TK-full' }));

    await refreshGoogleFeed(FEED({ sync_token: null }), CONN);

    // ev-stale (vanished, in window) pruned; ev-old (out of window) untouched.
    expect(db.batchSoftDeleteCalendarEvents).toHaveBeenCalledWith(['r-stale'], 'hh-1');
  });

  test('an expired sync token (410) self-heals into a full resync', async () => {
    const gone = Object.assign(new Error('Sync token is no longer valid'), { code: 410 });
    mockList
      .mockRejectedValueOnce(gone) // incremental attempt with the stale token
      .mockResolvedValueOnce(page([
        { id: 'ev-a', summary: 'A', start: { dateTime: '2026-06-24T09:00:00Z' }, end: { dateTime: '2026-06-24T10:00:00Z' } },
      ], { nextSyncToken: 'TK-fresh' })); // full resync

    await refreshGoogleFeed(FEED({ sync_token: 'STALE' }), CONN);

    expect(mockList).toHaveBeenCalledTimes(2);
    expect(db.updateGoogleFeedSyncToken).toHaveBeenCalledWith('F1', 'TK-fresh');
    expect(db.recordExternalFeedFailure).not.toHaveBeenCalled();
  });

  test('pages through multi-page results before capturing the sync token', async () => {
    mockList
      .mockResolvedValueOnce(page(
        [{ id: 'ev-1', summary: 'One', start: { dateTime: '2026-06-24T09:00:00Z' }, end: { dateTime: '2026-06-24T10:00:00Z' } }],
        { nextSyncToken: undefined, nextPageToken: 'p2' },
      ))
      .mockResolvedValueOnce(page(
        [{ id: 'ev-2', summary: 'Two', start: { dateTime: '2026-06-25T09:00:00Z' }, end: { dateTime: '2026-06-25T10:00:00Z' } }],
        { nextSyncToken: 'TK-last' },
      ));

    const stats = await refreshGoogleFeed(FEED(), CONN);

    expect(stats.fetched).toBe(2);
    expect(db.updateGoogleFeedSyncToken).toHaveBeenCalledWith('F1', 'TK-last');
  });

  test('a non-token API error records a feed failure and rethrows', async () => {
    mockList.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(refreshGoogleFeed(FEED(), CONN)).rejects.toThrow('ECONNRESET');
    expect(db.recordExternalFeedFailure).toHaveBeenCalledWith('F1', 'ECONNRESET');
    expect(db.recordExternalFeedSuccess).not.toHaveBeenCalled();
  });
});

// ─── Phase 2: outbound write safety invariants ──────────────────────────────

const CONN_W = {
  id: 'c1', household_id: 'hh-1', refresh_token: 'enc',
  app_calendar_id: 'housemait-cal', writes_enabled: true,
};
const EVENT = (over = {}) => ({
  id: 'ev-1', title: 'Swimming', description: null, location: null,
  start_time: '2026-06-24T09:00:00.000Z', end_time: '2026-06-24T10:00:00.000Z',
  all_day: false, external_feed_id: null, deleted_at: null, ...over,
});

describe('buildGoogleEventPayload', () => {
  test('timed event sends the UTC instant + an explicit IANA timeZone', () => {
    const body = buildGoogleEventPayload(EVENT());
    expect(body.start).toEqual({ dateTime: '2026-06-24T09:00:00.000Z', timeZone: 'Europe/London' });
    expect(body.end).toEqual({ dateTime: '2026-06-24T10:00:00.000Z', timeZone: 'Europe/London' });
    expect(body.extendedProperties.private).toMatchObject({ housemaitEventId: 'ev-1', source: 'housemait' });
  });
  test('all-day event sends date-only with Google EXCLUSIVE end (+1 day)', () => {
    const body = buildGoogleEventPayload(EVENT({ all_day: true, start_time: '2026-06-24', end_time: '2026-06-25' }));
    expect(body.start).toEqual({ date: '2026-06-24' });
    expect(body.end).toEqual({ date: '2026-06-26' }); // stored inclusive 25th → exclusive 26th
  });
});

describe('isNativeEvent', () => {
  test('an event pulled from a feed is NOT native (echo guard)', () => {
    expect(isNativeEvent(EVENT({ external_feed_id: 'feed-1' }))).toBe(false);
    expect(isNativeEvent(EVENT())).toBe(true);
  });
});

describe('pushEventToGoogle', () => {
  beforeEach(() => {
    process.env.GOOGLE_CALENDAR_WRITES_ENABLED = 'true';
    db.getSyncMapping.mockResolvedValue(null);
    mockInsert.mockResolvedValue({ data: { id: 'g-evt-1' } });
    mockUpdate.mockResolvedValue({ data: { id: 'g-evt-1' } });
  });

  test('global kill switch off → no API call, audited blocked', async () => {
    delete process.env.GOOGLE_CALENDAR_WRITES_ENABLED;
    const r = await pushEventToGoogle(CONN_W, EVENT());
    expect(r).toEqual({ skipped: 'writes_disabled' });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(db.recordCalendarWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ result: 'blocked', error: 'writes_disabled' }));
  });

  test('per-connection writes_enabled off → no API call', async () => {
    const r = await pushEventToGoogle({ ...CONN_W, writes_enabled: false }, EVENT());
    expect(r).toEqual({ skipped: 'writes_disabled' });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('echo guard: an inbound (feed-sourced) event is never pushed back out', async () => {
    const r = await pushEventToGoogle(CONN_W, EVENT({ external_feed_id: 'feed-1' }));
    expect(r).toEqual({ skipped: 'inbound_event' });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('native create → inserts into the APP calendar only, writes mapping', async () => {
    const r = await pushEventToGoogle(CONN_W, EVENT());
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert.mock.calls[0][0].calendarId).toBe('housemait-cal'); // single-target
    expect(r).toMatchObject({ ok: true, op: 'create', googleEventId: 'g-evt-1' });
    expect(db.upsertSyncMapping).toHaveBeenCalledWith(expect.objectContaining({
      housemaitEventId: 'ev-1', googleCalendarId: 'housemait-cal', googleEventId: 'g-evt-1',
    }));
  });

  test('existing mapping → updates the same Google event (idempotent)', async () => {
    db.getSyncMapping.mockResolvedValue({ google_calendar_id: 'housemait-cal', google_event_id: 'g-evt-1' });
    const r = await pushEventToGoogle(CONN_W, EVENT());
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ calendarId: 'housemait-cal', eventId: 'g-evt-1' }));
    expect(mockInsert).not.toHaveBeenCalled();
    expect(r.op).toBe('update');
  });

  test('SINGLE-TARGET ASSERTION: a mapping pointing elsewhere throws, never writes', async () => {
    db.getSyncMapping.mockResolvedValue({ google_calendar_id: 'SOME-OTHER-CAL', google_event_id: 'x' });
    await expect(pushEventToGoogle(CONN_W, EVENT())).rejects.toThrow(/target mismatch/);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe('deleteEventFromGoogle', () => {
  beforeEach(() => {
    process.env.GOOGLE_CALENDAR_WRITES_ENABLED = 'true';
    mockDelete.mockResolvedValue({});
  });

  test('MAPPING-ONLY: no mapping → does nothing (never delete-by-absence)', async () => {
    db.getSyncMapping.mockResolvedValue(null);
    const r = await deleteEventFromGoogle(CONN_W, 'ev-unknown');
    expect(r).toEqual({ skipped: 'no_mapping' });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  test('with a mapping → deletes that event in the app calendar + drops the mapping', async () => {
    db.getSyncMapping.mockResolvedValue({ google_calendar_id: 'housemait-cal', google_event_id: 'g-evt-1' });
    const r = await deleteEventFromGoogle(CONN_W, 'ev-1');
    expect(mockDelete).toHaveBeenCalledWith({ calendarId: 'housemait-cal', eventId: 'g-evt-1' });
    expect(db.deleteSyncMapping).toHaveBeenCalledWith('c1', 'ev-1');
    expect(r).toEqual({ ok: true });
  });

  test('kill switch off → no delete call', async () => {
    delete process.env.GOOGLE_CALENDAR_WRITES_ENABLED;
    db.getSyncMapping.mockResolvedValue({ google_calendar_id: 'housemait-cal', google_event_id: 'g-evt-1' });
    const r = await deleteEventFromGoogle(CONN_W, 'ev-1');
    expect(r).toEqual({ skipped: 'writes_disabled' });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  test('a mapping pointing outside the app calendar throws, never deletes', async () => {
    db.getSyncMapping.mockResolvedValue({ google_calendar_id: 'SOME-OTHER-CAL', google_event_id: 'x' });
    await expect(deleteEventFromGoogle(CONN_W, 'ev-1')).rejects.toThrow(/target mismatch/);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe('syncEventOutbound', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  beforeEach(() => {
    db.getWritableConnectionsByHousehold.mockResolvedValue([]);
    db.getSyncMapping.mockResolvedValue(null);
    mockInsert.mockResolvedValue({ data: { id: 'g-1' } });
    mockDelete.mockResolvedValue({});
  });

  test('no-ops entirely (no connection lookup) when writes are globally off', async () => {
    delete process.env.GOOGLE_CALENDAR_WRITES_ENABLED;
    await syncEventOutbound('hh-1', EVENT(), 'create');
    expect(db.getWritableConnectionsByHousehold).not.toHaveBeenCalled();
  });

  test('create fans a push out to each writable connection in the household', async () => {
    process.env.GOOGLE_CALENDAR_WRITES_ENABLED = 'true';
    db.getWritableConnectionsByHousehold.mockResolvedValue([CONN_W]);
    await syncEventOutbound('hh-1', EVENT(), 'create');
    await flush();
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert.mock.calls[0][0].calendarId).toBe('housemait-cal');
  });

  test('delete fans a mapping-only delete out to each writable connection', async () => {
    process.env.GOOGLE_CALENDAR_WRITES_ENABLED = 'true';
    db.getWritableConnectionsByHousehold.mockResolvedValue([CONN_W]);
    db.getSyncMapping.mockResolvedValue({ google_calendar_id: 'housemait-cal', google_event_id: 'g-1' });
    await syncEventOutbound('hh-1', { id: 'ev-1' }, 'delete');
    await flush();
    expect(mockDelete).toHaveBeenCalledWith({ calendarId: 'housemait-cal', eventId: 'g-1' });
  });
});
