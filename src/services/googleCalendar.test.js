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
jest.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: jest.fn().mockImplementation(() => ({ setCredentials: jest.fn() })) },
    calendar: jest.fn(() => ({ events: { list: mockList } })),
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
}));
jest.mock('./cache', () => ({ invalidatePattern: jest.fn() }));

const db = require('../db/queries');
const { googleEventToTimes, refreshGoogleFeed } = require('./googleCalendar');

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
