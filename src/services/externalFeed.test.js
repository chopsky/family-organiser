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
  getFeedAttribution: jest.fn().mockResolvedValue({ color: 'slate', assignedIds: [], assignedNames: [] }),
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
const { refreshFeed, classifyFeedUrlMistake, friendlyPullError, extractCalendarName } = require('./externalFeed');

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

describe('classifyFeedUrlMistake - catches page-URLs pasted instead of iCal addresses', () => {
  test('Google embed + web-app/settings URLs are rejected with copy-this-instead guidance', () => {
    expect(classifyFeedUrlMistake('https://calendar.google.com/calendar/embed?src=abc%40gmail.com'))
      .toMatch(/Secret address in iCal format/);
    expect(classifyFeedUrlMistake('https://calendar.google.com/calendar/u/0/r/settings/calendar/YWJj'))
      .toMatch(/Secret address in iCal format/);
    expect(classifyFeedUrlMistake('https://calendar.google.com/calendar/r'))
      .toMatch(/Secret address/);
  });

  test('real Google secret/public ical addresses pass', () => {
    expect(classifyFeedUrlMistake('https://calendar.google.com/calendar/ical/abc%40gmail.com/private-0123abc/basic.ics')).toBeNull();
    expect(classifyFeedUrlMistake('https://calendar.google.com/calendar/ical/abc%40gmail.com/public/basic.ics')).toBeNull();
  });

  test('Outlook web-app URL rejected; published calendar.ics passes', () => {
    expect(classifyFeedUrlMistake('https://outlook.live.com/calendar/0/view/month'))
      .toMatch(/Publish a calendar/);
    expect(classifyFeedUrlMistake('https://outlook.live.com/owa/calendar/abc123/def456/calendar.ics')).toBeNull();
  });

  test('iCloud website URL rejected; published webcal passes', () => {
    expect(classifyFeedUrlMistake('https://www.icloud.com/calendar/')).toMatch(/Public Calendar/);
    expect(classifyFeedUrlMistake('webcal://p123-caldav.icloud.com/published/2/abc')).toBeNull();
  });

  test('school/club feeds and arbitrary hosts pass untouched', () => {
    expect(classifyFeedUrlMistake('https://www.stmarys.school/calendar.ics')).toBeNull();
    expect(classifyFeedUrlMistake('webcal://fixtures.pitchero.com/team/123.ics')).toBeNull();
  });
});

describe('friendlyPullError - actionable guidance for permanent wrong-paste failures', () => {
  test('Google PUBLIC address + 404 explains the secret address (permanent)', () => {
    const r = friendlyPullError(
      'https://calendar.google.com/calendar/ical/abc%40gmail.com/public/basic.ics',
      'Feed returned HTTP 404',
    );
    expect(r.permanent).toBe(true);
    expect(r.message).toMatch(/Secret address in iCal format/);
  });

  test('non-iCal response explains what to copy (permanent)', () => {
    const r = friendlyPullError('https://example.com/cal', 'Feed response is not an iCalendar document');
    expect(r.permanent).toBe(true);
    expect(r.message).toMatch(/web page, not calendar data/);
  });

  test('transient failures pass through unchanged (row kept for retry)', () => {
    const r = friendlyPullError('https://example.com/cal.ics', 'Feed returned HTTP 503');
    expect(r.permanent).toBe(false);
    expect(r.message).toBe('Feed returned HTTP 503');
  });

  test('a rate-limited (429) Google public address is NOT treated as permanent', () => {
    const r = friendlyPullError(
      'https://calendar.google.com/calendar/ical/abc%40gmail.com/public/basic.ics',
      'Feed returned HTTP 429',
    );
    expect(r.permanent).toBe(false);
  });

  test('an .ics path serving HTML reads as a transient challenge page, not a wrong paste', () => {
    const r = friendlyPullError('https://www.stmarys.school/calendar.ics', 'Feed response is not an iCalendar document');
    expect(r.permanent).toBe(false);
  });
});

describe('extractCalendarName (auto-name a subscribed calendar)', () => {
  test('reads the calendar name from X-WR-CALNAME', () => {
    expect(extractCalendarName('BEGIN:VCALENDAR\nX-WR-CALNAME:Sasha Work\nEND:VCALENDAR')).toBe('Sasha Work');
  });
  test('handles a parameter on the property', () => {
    expect(extractCalendarName('X-WR-CALNAME;VALUE=TEXT:Family Holidays')).toBe('Family Holidays');
  });
  test('unfolds a folded (continued) line', () => {
    expect(extractCalendarName('X-WR-CALNAME:A very long\n  calendar name')).toBe('A very long calendar name');
  });
  test('returns null when the feed advertises no name', () => {
    expect(extractCalendarName('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR')).toBeNull();
    expect(extractCalendarName('')).toBeNull();
  });
});

test('refreshFeed surfaces the calendar name (X-WR-CALNAME) in its stats', async () => {
  serve(ics(['a'], '\nX-WR-CALNAME:Work — London'));
  db.getExternalFeedEvents.mockResolvedValue([]);
  const stats = await refreshFeed(FEED());
  expect(stats.calendarName).toBe('Work — London');
});
