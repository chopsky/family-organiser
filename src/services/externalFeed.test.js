/**
 * refreshFeed reconciliation guards: a single bad pull must never wipe a
 * feed's events, while legitimate removals (including FUTURE cancellations)
 * must still propagate - settling within two refresh cycles.
 */

jest.mock('axios');
jest.mock('../db/queries', () => ({
  getExternalFeedEvents: jest.fn(),
  batchUpsertExternalFeedEvents: jest.fn().mockResolvedValue(),
  batchSoftDeleteCalendarEvents: jest.fn().mockResolvedValue(),
  recordExternalFeedSuccess: jest.fn().mockResolvedValue(),
  recordExternalFeedPartial: jest.fn().mockResolvedValue(),
  recordExternalFeedFailure: jest.fn().mockResolvedValue(),
}));
jest.mock('./cache', () => ({ invalidatePattern: jest.fn(), invalidate: jest.fn() }));
jest.mock('../utils/ssrf-guard', () => ({
  assertFetchableUrl: jest.fn(),
  ssrfSafeAgents: jest.fn(() => ({ httpAgent: undefined, httpsAgent: undefined })),
}));
jest.mock('./providers/apple', () => ({
  parseVEvent: jest.fn((v) => {
    if (/SUMMARY:THROWME/.test(v)) throw new Error('unparseable VEVENT');
    return {
      title: 'Ev', description: null, location: null,
      start_time: '2026-06-15T09:00:00Z', end_time: '2026-06-15T10:00:00Z', all_day: false,
    };
  }),
  expandRecurrence: jest.fn(() => null),
}));

const axios = require('axios');
const db = require('../db/queries');
const { refreshFeed } = require('./externalFeed');

const FEED = (over = {}) => ({
  id: 'F1', household_id: 'hh-1', feed_url: 'https://example.com/cal.ics',
  color: 'sky', user_id: 'u-1', last_error: null, ...over,
});

const vevent = (uid, summary = 'Ev') => `BEGIN:VEVENT\nUID:${uid}\nSUMMARY:${summary}\nEND:VEVENT`;
const ics = (uids, extra = '') =>
  `BEGIN:VCALENDAR\n${uids.map((u) => vevent(u)).join('\n')}${extra}\nEND:VCALENDAR`;

const existingRows = (uids) => uids.map((u) => ({
  id: `row-${u}`, external_uid: u, start_time: '2026-06-15T09:00:00Z', end_time: '2026-06-15T10:00:00Z',
}));

const serve = (body) => axios.get.mockResolvedValue({ status: 200, data: body });

beforeEach(() => {
  jest.clearAllMocks();
  db.batchUpsertExternalFeedEvents.mockResolvedValue();
});

test('an HTTP-200 page that is not iCal is a fetch FAILURE, never an empty feed', async () => {
  serve('<html><body>Please log in</body></html>');
  db.getExternalFeedEvents.mockResolvedValue(existingRows(['a', 'b', 'c']));
  await expect(refreshFeed(FEED())).rejects.toThrow(/not an iCalendar/);
  expect(db.recordExternalFeedFailure).toHaveBeenCalledWith('F1', expect.stringMatching(/not an iCalendar/));
  expect(db.batchSoftDeleteCalendarEvents).not.toHaveBeenCalled();
  expect(db.batchUpsertExternalFeedEvents).not.toHaveBeenCalled();
});

test('routine stale rows ARE deleted (future cancellations propagate)', async () => {
  serve(ics(['a', 'b']));
  db.getExternalFeedEvents.mockResolvedValue(existingRows(['a', 'b', 'c']));
  const stats = await refreshFeed(FEED());
  expect(db.batchSoftDeleteCalendarEvents).toHaveBeenCalledWith(['row-c'], 'hh-1');
  expect(stats.deleted).toBe(1);
  expect(db.recordExternalFeedSuccess).toHaveBeenCalledWith('F1');
});

test('a pull that lost more than half the held events withholds ALL deletes (first cycle)', async () => {
  const held = Array.from({ length: 40 }, (_, i) => `e${i}`);
  serve(ics(held.slice(0, 15)));
  db.getExternalFeedEvents.mockResolvedValue(existingRows(held));
  const stats = await refreshFeed(FEED());
  expect(db.batchSoftDeleteCalendarEvents).not.toHaveBeenCalled();
  expect(stats.skipped_recent_delete).toBe(25);
  // Marker recorded for the next cycle to confirm; NOT a success (would clear it).
  expect(db.recordExternalFeedPartial).toHaveBeenCalledWith('F1', expect.stringMatching(/^partial-pull:15\b/));
  expect(db.recordExternalFeedSuccess).not.toHaveBeenCalled();
});

test('the SAME shrunken pull on the next cycle confirms the shrink and applies the deletes', async () => {
  const held = Array.from({ length: 40 }, (_, i) => `e${i}`);
  serve(ics(held.slice(0, 15)));
  db.getExternalFeedEvents.mockResolvedValue(existingRows(held));
  const stats = await refreshFeed(FEED({ last_error: 'partial-pull:15 (provider returned 15 of 40 held events)' }));
  expect(stats.deleted).toBe(25);
  expect(db.batchSoftDeleteCalendarEvents).toHaveBeenCalled();
  expect(db.recordExternalFeedSuccess).toHaveBeenCalledWith('F1');
});

test('a slightly DRIFTED repeat (actively-edited feed) still confirms within tolerance', async () => {
  const held = Array.from({ length: 40 }, (_, i) => `e${i}`);
  serve(ics(held.slice(0, 16))); // marker said 15, this pull has 16
  db.getExternalFeedEvents.mockResolvedValue(existingRows(held));
  const stats = await refreshFeed(FEED({ last_error: 'partial-pull:15 (provider returned 15 of 40 held events)' }));
  expect(stats.deleted).toBe(24);
  expect(db.recordExternalFeedSuccess).toHaveBeenCalledWith('F1');
});

test('an empty-but-valid pull against a SMALL feed is withheld - no size floor', async () => {
  serve('BEGIN:VCALENDAR\nEND:VCALENDAR');
  db.getExternalFeedEvents.mockResolvedValue(existingRows(['a', 'b', 'c']));
  const stats = await refreshFeed(FEED());
  expect(db.batchSoftDeleteCalendarEvents).not.toHaveBeenCalled();
  expect(stats.skipped_recent_delete).toBe(3);
  expect(db.recordExternalFeedPartial).toHaveBeenCalledWith('F1', expect.stringMatching(/^partial-pull:0\b/));
});

test('a CONFIRMED empty feed (two identical cycles) does clear out', async () => {
  serve('BEGIN:VCALENDAR\nEND:VCALENDAR');
  db.getExternalFeedEvents.mockResolvedValue(existingRows(['a', 'b', 'c']));
  const stats = await refreshFeed(FEED({ last_error: 'partial-pull:0 (provider returned 0 of 3 held events)' }));
  expect(stats.deleted).toBe(3);
});

test('rows whose VEVENT failed to parse are NOT treated as stale (still published)', async () => {
  // Pull contains a, c, d (fine) + b (unparseable): b and its recurring
  // expansion rows must survive even though they produced no upsert records.
  // Enough events parse that the shrink guard does not engage - this
  // exercises the unparseable-uid protection specifically.
  serve(`BEGIN:VCALENDAR\n${vevent('a')}\n${vevent('c')}\n${vevent('d')}\n${vevent('b', 'THROWME')}\nEND:VCALENDAR`);
  db.getExternalFeedEvents.mockResolvedValue(existingRows(['a', 'b', 'c', 'd', 'b_2026-06-15']));
  const stats = await refreshFeed(FEED());
  expect(db.batchSoftDeleteCalendarEvents).not.toHaveBeenCalled();
  expect(stats.deleted).toBe(0);
  expect(stats.skipped_recent_delete).toBe(2);
  expect(db.recordExternalFeedSuccess).toHaveBeenCalledWith('F1');
});
