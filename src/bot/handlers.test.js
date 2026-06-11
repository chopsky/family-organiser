/**
 * Bot handler tests. handlers.js pulls in the DB client + AI/push/broadcast
 * services at import time (all of which need real env/credentials), so we mock
 * that whole chain to a no-op surface. The handler under test takes its db via
 * the module mock, which is all we control here.
 */
jest.mock('../db/queries', () => ({
  getCalendarEvents: jest.fn(),
  getHouseholdSchools: jest.fn(() => Promise.resolve([])),
  addSchoolTermDates: jest.fn(() => Promise.resolve([])),
  deleteTermDatesBySchoolAndAcademicYear: jest.fn(() => Promise.resolve()),
  updateHouseholdSchoolMeta: jest.fn(() => Promise.resolve()),
}));
jest.mock('../services/ai', () => ({
  classify: jest.fn(), scanReceipt: jest.fn(), matchReceiptToList: jest.fn(),
  scanImage: jest.fn(), runWebSearch: jest.fn(),
}));
jest.mock('../services/transcribe', () => ({ transcribeVoice: jest.fn() }));
jest.mock('../services/weather', () => ({
  getWeatherReport: jest.fn(), extractLocationFromMessage: jest.fn(), geocodeLocation: jest.fn(),
}));
jest.mock('../services/ai-client', () => ({ callWithFailover: jest.fn(), REASONING_TIMEOUT_MS: 90000 }));
jest.mock('../services/push', () => ({ sendToHousehold: jest.fn(() => Promise.resolve()) }));
jest.mock('../services/broadcast', () => ({ toHousehold: jest.fn() }));
jest.mock('./calendar-url', () => ({ detectCalendarFeedUrl: jest.fn(() => null), subscribeCalendarFeed: jest.fn() }));
jest.mock('./bulk-extract', () => ({ looksLikeBulkPaste: jest.fn(() => false), looksLikeSchoolTermDates: jest.fn(() => false), extractAndApply: jest.fn() }));
jest.mock('../services/document-extract', () => ({ extractTextFromDocument: jest.fn() }));
jest.mock('../services/term-date-extract', () => ({
  extractTermDatesPreview: jest.fn(),
  academicYearsForCountry: jest.fn(() => ({ currentAY: '2025-2026', nextAY: '2026-2027' })),
}));

const handlers = require('./handlers');
const db = require('../db/queries');
const bulk = require('./bulk-extract');
const docExtract = require('../services/document-extract');
const termExtract = require('../services/term-date-extract');

const household = { id: 'h1', timezone: 'Europe/London', members: [] };
const user = { id: 'u1', name: 'Grant' };
const TZ = 'Europe/London';

beforeEach(() => jest.clearAllMocks());

describe('handleCalendarQuery', () => {
  test('fetches the EXACT requested range from the DB (no window cap) and lists events', async () => {
    db.getCalendarEvents.mockResolvedValue([
      { title: "Mia's birthday", start_time: '2026-12-14T00:00:00Z', all_day: true, assigned_to_names: [] },
      { title: 'Dentist', start_time: '2026-12-15T09:00:00Z', end_time: '2026-12-15T09:30:00Z', assigned_to_names: ['Lynn'] },
    ]);
    const res = await handlers.handleCalendarQuery(
      { query_start: '2026-12-01', query_end: '2026-12-31', response_message: 'Here is December:' },
      household, user, TZ, {},
    );
    expect(db.getCalendarEvents).toHaveBeenCalledWith(
      'h1', '2026-12-01T00:00:00Z', '2026-12-31T23:59:59Z',
      expect.objectContaining({ userId: 'u1', birthdays: true }),
    );
    expect(res.response).toContain('Here is December:');
    expect(res.response).toContain("Mia's birthday");
    expect(res.response).toContain('Dentist');
    expect(res.response).toContain('(Lynn)');
  });

  test('defaults to a ~14-day window when no range is supplied', async () => {
    db.getCalendarEvents.mockResolvedValue([]);
    await handlers.handleCalendarQuery({}, household, user, TZ, {});
    const [, startArg, endArg] = db.getCalendarEvents.mock.calls[0];
    const days = (new Date(endArg) - new Date(startArg)) / 86400000;
    expect(days).toBeGreaterThan(13.5);
    expect(days).toBeLessThan(15.5);
  });

  test('auto-corrects an inverted range', async () => {
    db.getCalendarEvents.mockResolvedValue([]);
    await handlers.handleCalendarQuery({ query_start: '2026-12-01', query_end: '2026-11-01' }, household, user, TZ, {});
    const [, startArg, endArg] = db.getCalendarEvents.mock.calls[0];
    expect(new Date(endArg).getTime()).toBeGreaterThan(new Date(startArg).getTime());
  });

  test('friendly empty-state when nothing is on', async () => {
    db.getCalendarEvents.mockResolvedValue([]);
    const res = await handlers.handleCalendarQuery(
      { query_start: '2026-12-01', query_end: '2026-12-31' }, household, user, TZ, {},
    );
    expect(res.response).toMatch(/nothing on/i);
  });

  test('caps the list at 30 and notes the overflow', async () => {
    const many = Array.from({ length: 35 }, (_, i) => ({
      title: `Event ${i}`, start_time: '2026-12-15T09:00:00Z', end_time: '2026-12-15T10:00:00Z', assigned_to_names: [],
    }));
    db.getCalendarEvents.mockResolvedValue(many);
    const res = await handlers.handleCalendarQuery(
      { query_start: '2026-12-01', query_end: '2026-12-31' }, household, user, TZ, {},
    );
    expect(res.response).toMatch(/and 5 more/);
    expect(res.response).toMatch(/\/calendar/); // overflow always links (text is incomplete)
  });

  test('appends a calendar deep-link for a week-sized result', async () => {
    const week = Array.from({ length: 5 }, (_, i) => ({
      title: `Event ${i}`, start_time: '2026-12-15T09:00:00Z', end_time: '2026-12-15T10:00:00Z', assigned_to_names: [],
    }));
    db.getCalendarEvents.mockResolvedValue(week);
    const res = await handlers.handleCalendarQuery(
      { query_start: '2026-12-01', query_end: '2026-12-31' }, household, user, TZ, {},
    );
    expect(res.response).toMatch(/see it on your calendar/i);
    expect(res.response).toMatch(/\/calendar/);
  });

  test('no deep-link for a small (1-2 event) result', async () => {
    db.getCalendarEvents.mockResolvedValue([
      { title: 'Dentist', start_time: '2026-12-15T09:00:00Z', end_time: '2026-12-15T09:30:00Z', assigned_to_names: [] },
      { title: 'School run', start_time: '2026-12-15T15:30:00Z', end_time: '2026-12-15T16:00:00Z', assigned_to_names: [] },
    ]);
    const res = await handlers.handleCalendarQuery(
      { query_start: '2026-12-15', query_end: '2026-12-15' }, household, user, TZ, {},
    );
    expect(res.response).not.toMatch(/\/calendar/);
  });

  test('degrades gracefully when the DB query throws', async () => {
    db.getCalendarEvents.mockRejectedValue(new Error('db down'));
    const res = await handlers.handleCalendarQuery(
      { query_start: '2026-12-01', query_end: '2026-12-31' }, household, user, TZ, {},
    );
    expect(res.response).toMatch(/couldn't pull up your calendar/i);
  });
});

describe('buildValueReceipt', () => {
  // `user` (Grant) is defined at the top of this file.
  const sharedHh = { id: 'h1', members: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }] };
  const soloHh = { id: 'h1', members: [{ id: 'u1' }] };
  const base = { shoppingAdded: [], shoppingCompleted: [], tasksAdded: [], tasksCompleted: [], eventsAdded: [] };

  test('names an event assignee other than the sender', () => {
    expect(handlers.buildValueReceipt({ ...base, eventsAdded: [{ assigned_to_names: ['Mason'] }] }, user, sharedHh))
      .toBe('👉 Assigned to Mason.');
  });

  test('names a task assignee', () => {
    expect(handlers.buildValueReceipt({ ...base, tasksAdded: [{ title: 'Dentist', assigned_to_names: ['Lynn'] }] }, user, sharedHh))
      .toBe('👉 Assigned to Lynn.');
  });

  test('joins multiple assignees and excludes the sender', () => {
    expect(handlers.buildValueReceipt({ ...base, eventsAdded: [{ assigned_to_names: ['Mason', 'Grant', 'Lynn'] }] }, user, sharedHh))
      .toBe('👉 Assigned to Mason and Lynn.');
  });

  test('shared-event visibility line when not assigned and the household has others', () => {
    expect(handlers.buildValueReceipt({ ...base, eventsAdded: [{ assigned_to_names: [] }] }, user, sharedHh))
      .toMatch(/whole family can see it/i);
  });

  test('event assigned only to the sender falls back to the visibility line', () => {
    expect(handlers.buildValueReceipt({ ...base, eventsAdded: [{ assigned_to_names: ['Grant'] }] }, user, sharedHh))
      .toMatch(/whole family can see it/i);
  });

  test('no receipt for a solo personal task (no nag)', () => {
    expect(handlers.buildValueReceipt({ ...base, tasksAdded: [{ title: 'Buy milk', assigned_to_names: [] }] }, user, sharedHh))
      .toBeNull();
  });

  test('no receipt for shopping-only adds', () => {
    expect(handlers.buildValueReceipt({ ...base, shoppingAdded: ['milk'] }, user, sharedHh)).toBeNull();
  });

  test('no family-visibility line in a single-member household', () => {
    expect(handlers.buildValueReceipt({ ...base, eventsAdded: [{ assigned_to_names: [] }] }, user, soloHh)).toBeNull();
  });
});

describe('handleDocument — school term-dates import', () => {
  const DATES = [
    { event_type: 'term_start', date: '2025-09-04', label: 'Autumn term', academic_year: '2025-2026' },
    { event_type: 'term_end', date: '2025-12-20', label: 'Autumn term', academic_year: '2025-2026' },
  ];

  beforeEach(() => {
    docExtract.extractTextFromDocument.mockResolvedValue({ text: 'Autumn term 4 Sep – 20 Dec, half term 21 Oct, INSET 2 Sep' });
    bulk.looksLikeSchoolTermDates.mockReturnValue(true);
    termExtract.extractTermDatesPreview.mockResolvedValue({ ok: true, status: 200, body: { dates: DATES } });
  });

  test('one school → imports directly (per-year merge), no event dump', async () => {
    db.getHouseholdSchools.mockResolvedValue([{ id: 's1', school_name: 'Wolfson Hillel' }]);
    const ctx = {};
    const res = await handlers.handleDocument(Buffer.from('x'), 'application/pdf', 'terms.pdf', user, household, ctx);
    expect(db.deleteTermDatesBySchoolAndAcademicYear).toHaveBeenCalledWith('s1', '2025-2026');
    expect(db.addSchoolTermDates).toHaveBeenCalledWith('s1', expect.arrayContaining([
      expect.objectContaining({ event_type: 'term_start', source: 'whatsapp_import' }),
    ]));
    expect(db.updateHouseholdSchoolMeta).toHaveBeenCalled();
    expect(res.response).toMatch(/Wolfson Hillel/);
    expect(bulk.extractAndApply).not.toHaveBeenCalled();
    expect(ctx.intent).toBe('term_dates_import');
  });

  test('multiple schools → asks which, then the reply resolves + imports', async () => {
    db.getHouseholdSchools.mockResolvedValue([
      { id: 's1', school_name: 'Wolfson Hillel' },
      { id: 's2', school_name: 'St Johns' },
    ]);
    const ctx = {};
    const ask = await handlers.handleDocument(Buffer.from('x'), 'application/pdf', 'terms.pdf', user, household, ctx);
    expect(ask.response).toMatch(/which school/i);
    expect(ask.response).toMatch(/Wolfson Hillel/);
    expect(db.addSchoolTermDates).not.toHaveBeenCalled();
    expect(ctx.intent).toBe('term_dates_import_disambiguation');

    const reply = await handlers.handleTextMessage('2', user, household, {});
    expect(db.addSchoolTermDates).toHaveBeenCalledWith('s2', expect.any(Array));
    expect(reply.response).toMatch(/St Johns/);
  });

  test('no schools → guidance to add one first, no import', async () => {
    db.getHouseholdSchools.mockResolvedValue([]);
    const res = await handlers.handleDocument(Buffer.from('x'), 'application/pdf', 'terms.pdf', user, household, {});
    expect(res.response).toMatch(/add (one|a school)/i);
    expect(db.addSchoolTermDates).not.toHaveBeenCalled();
  });

  test('extractor finds no dates → graceful message, no import, no event dump', async () => {
    db.getHouseholdSchools.mockResolvedValue([{ id: 's1', school_name: 'Wolfson Hillel' }]);
    termExtract.extractTermDatesPreview.mockResolvedValue({ ok: true, status: 200, body: { dates: [] } });
    const res = await handlers.handleDocument(Buffer.from('x'), 'application/pdf', 'terms.pdf', user, household, {});
    expect(db.addSchoolTermDates).not.toHaveBeenCalled();
    expect(bulk.extractAndApply).not.toHaveBeenCalled();
    expect(res.response).toMatch(/Family → Schools/);
  });

  test('a normal (non term-dates) document still goes through extraction', async () => {
    docExtract.extractTextFromDocument.mockResolvedValue({ text: 'Cricket fixtures 01/06 v The Hall' });
    bulk.looksLikeSchoolTermDates.mockReturnValue(false);
    bulk.extractAndApply.mockResolvedValue({ count: 1, response: 'Added 1 event.', actions: { eventsAdded: [{ title: 'Cricket' }] } });
    const res = await handlers.handleDocument(Buffer.from('x'), 'application/pdf', 'fixtures.pdf', user, household, {});
    expect(bulk.extractAndApply).toHaveBeenCalled();
    expect(res.response).toMatch(/Added 1 event/);
  });
});
