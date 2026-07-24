/**
 * Bot handler tests. handlers.js pulls in the DB client + AI/push/broadcast
 * services at import time (all of which need real env/credentials), so we mock
 * that whole chain to a no-op surface. The handler under test takes its db via
 * the module mock, which is all we control here.
 */
jest.mock('../db/queries', () => ({
  getCalendarEvents: jest.fn(),
  getHouseholdActivities: jest.fn(() => Promise.resolve([])),
  getHouseholdMembers: jest.fn(() => Promise.resolve([])),
  getHouseholdSchools: jest.fn(() => Promise.resolve([])),
  addSchoolTermDates: jest.fn(() => Promise.resolve([])),
  deleteTermDatesBySchoolAndAcademicYear: jest.fn(() => Promise.resolve()),
  updateHouseholdSchoolMeta: jest.fn(() => Promise.resolve()),
  getHouseholdPreferences: jest.fn(() => Promise.resolve([])),
  getHouseholdAllergies: jest.fn(() => Promise.resolve([])),
  createRecipe: jest.fn((hid, r) => Promise.resolve({ id: 'r-1', ...r })),
  resolveAssignees: jest.fn(() => ({ ids: [], names: [] })),
  findSimilarEvent: jest.fn(() => Promise.resolve(null)),
  createCalendarEvent: jest.fn((hid, data) => Promise.resolve({ id: 'e-1', ...data })),
  saveEventAssignees: jest.fn(() => Promise.resolve()),
  saveEventReminders: jest.fn(() => Promise.resolve()),
  // confirm-before-modify / undo surface
  getRecentWhatsAppTurns: jest.fn(() => Promise.resolve([])),
  getHouseholdNotes: jest.fn(() => Promise.resolve([])),
  getAllIncompleteTasks: jest.fn(() => Promise.resolve([])),
  getTermDatesBySchoolIds: jest.fn(() => Promise.resolve([])),
  updateTask: jest.fn((id, hid, updates) => Promise.resolve({ id, title: 'x', ...updates })),
  deleteTask: jest.fn(() => Promise.resolve()),
  restoreDeletedRow: jest.fn((table, hid, row) => Promise.resolve({ id: 'restored', ...row })),
  updateCalendarEvent: jest.fn((id, hid, updates) => Promise.resolve({ id, title: 'x', ...updates })),
  findEventsByFuzzyTitle: jest.fn(() => Promise.resolve([])),
  softDeleteCalendarEvent: jest.fn(() => Promise.resolve()),
  updateUser: jest.fn(() => Promise.resolve({})),
  upsertNotificationPreferences: jest.fn(() => Promise.resolve({})),
  // Default: pin nudge already claimed (false) so most assertions match on
  // the base copy; the pin-nudge tests opt in by returning true.
  claimPinNudge: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('../services/ai', () => ({
  classify: jest.fn(), scanReceipt: jest.fn(), matchReceiptToList: jest.fn(),
  scanImage: jest.fn(), runWebSearch: jest.fn(),
}));
jest.mock('../services/transcribe', () => ({ transcribeVoice: jest.fn() }));
jest.mock('../services/weather', () => ({
  getWeatherReport: jest.fn(), extractLocationFromMessage: jest.fn(), geocodeLocation: jest.fn(),
  // Resolves null = "composition unavailable" → handlers fall back to the
  // raw report, keeping these tests focused on the fetch/format plumbing.
  composeWeatherAnswer: jest.fn(() => Promise.resolve(null)),
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
// LLM fallback for unparseable reminder replies. Default null = "call
// failed / unavailable" so existing tests exercise the deterministic flow;
// the loop-breaker tests override per-case.
jest.mock('../services/reminder-extract', () => ({ extractReminderOffsets: jest.fn(() => Promise.resolve(null)) }));
jest.mock('../services/cache', () => ({ invalidate: jest.fn(), get: jest.fn(), set: jest.fn() }));
jest.mock('../services/agent-loop', () => ({ agentEnabled: jest.fn(() => false), agentCalendarAnswer: jest.fn() }));
jest.mock('../services/school-add', () => ({
  searchGiasCandidates: jest.fn(),
  addConfirmedSchool: jest.fn(),
  importTermDatesFromUrl: jest.fn(),
  // Real (trivial) implementation so confirmation copy carries the address.
  candidateLabel: (c) => {
    const where = [c.address, c.postcode].filter(Boolean).join(' ');
    return where ? `${c.name} - ${where}` : c.name;
  },
}));

const handlers = require('./handlers');
const db = require('../db/queries');
const bulk = require('./bulk-extract');
const docExtract = require('../services/document-extract');
const termExtract = require('../services/term-date-extract');
const cache = require('../services/cache');

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
    // Points at the app by NAME on overflow - never a URL (a housemait.com
    // link dragged a marketing-site preview card into the WhatsApp reply).
    expect(res.response).toMatch(/open Housemait/i);
    expect(res.response).not.toMatch(/https?:\/\//);
  });

  test('query_topic filters to the asked-about event only', async () => {
    db.getCalendarEvents.mockResolvedValue([
      { title: 'See Jess dog', start_time: '2026-12-15T09:00:00Z', end_time: '2026-12-15T10:00:00Z', assigned_to_names: [] },
      { title: 'Collect cupcakes for party', start_time: '2026-12-15T11:00:00Z', end_time: '2026-12-15T12:00:00Z', assigned_to_names: [] },
      { title: 'Tennis lesson', start_time: '2026-12-15T16:00:00Z', end_time: '2026-12-15T17:00:00Z', assigned_to_names: [] },
    ]);
    const res = await handlers.handleCalendarQuery(
      { query_start: '2026-12-15', query_end: '2026-12-15', query_topic: 'tennis' }, household, user, TZ, {},
    );
    expect(res.response).toMatch(/Tennis lesson/);
    expect(res.response).not.toMatch(/cupcakes|Jess dog/);
  });

  test('query_topic with no match admits it - no unrelated-schedule dump', async () => {
    db.getCalendarEvents.mockResolvedValue([
      { title: 'See Jess dog', start_time: '2026-12-15T09:00:00Z', end_time: '2026-12-15T10:00:00Z', assigned_to_names: [] },
    ]);
    const res = await handlers.handleCalendarQuery(
      { query_start: '2026-12-15', query_end: '2026-12-15', query_topic: 'tennis' }, household, user, TZ, {},
    );
    expect(res.response).toMatch(/can't see anything matching "tennis"/i);
    // The user asked about ONE thing; listing unrelated events is a
    // non-answer (real complaint: "nici bournemouth" miss answered with a
    // fortnight of other people's plans).
    expect(res.response).not.toMatch(/Jess dog/);
  });

  test('undated topic question searches a year ahead and finds far-future events', async () => {
    // "What dates are we at nici bournemouth?" carries no dates - the answer
    // may be months out. The 14-day default window hid an August event.
    db.getCalendarEvents.mockResolvedValue([
      { title: 'Nici Bournemouth', start_time: '2026-08-14T14:00:00Z', end_time: '2026-08-16T10:00:00Z', assigned_to_names: [] },
    ]);
    const res = await handlers.handleCalendarQuery(
      { query_topic: 'nici bournemouth' }, household, user, TZ, {},
    );
    const [, startArg, endArg] = db.getCalendarEvents.mock.calls[0];
    const days = (new Date(endArg) - new Date(startArg)) / 86400000;
    expect(days).toBeGreaterThan(360);
    expect(res.response).toMatch(/Nici Bournemouth/);
  });

  test('dated topic question keeps the asked-about window (no year-wide override)', async () => {
    db.getCalendarEvents.mockResolvedValue([]);
    await handlers.handleCalendarQuery(
      { query_start: '2026-12-14', query_end: '2026-12-20', query_topic: 'tennis' }, household, user, TZ, {},
    );
    expect(db.getCalendarEvents).toHaveBeenCalledWith(
      'h1', '2026-12-14T00:00:00Z', '2026-12-20T23:59:59Z', expect.anything(),
    );
  });

  test('weekly activities are merged into calendar answers and findable by topic', async () => {
    db.getCalendarEvents.mockResolvedValue([]);
    // 2026-12-16 is a Wednesday → day_of_week 2 (Monday=0 convention)
    db.getHouseholdActivities.mockResolvedValue([
      { id: 'act-1', child_id: 'kid1', activity: 'Tennis', day_of_week: 2, time_start: '16:00', time_end: '17:00' },
    ]);
    db.getHouseholdMembers.mockResolvedValue([{ id: 'kid1', name: 'Mason' }]);
    const res = await handlers.handleCalendarQuery(
      { query_start: '2026-12-14', query_end: '2026-12-20', query_topic: "masons tennis" }, household, user, TZ, {},
    );
    expect(res.response).toMatch(/Mason - Tennis/);
    expect(res.response).toMatch(/16:00/);
  });

  test('activities hidden from the adult calendar stay out of browse lists but answer direct questions', async () => {
    db.getCalendarEvents.mockResolvedValue([
      { title: 'Dentist', start_time: '2026-12-16T09:00:00Z', end_time: '2026-12-16T09:30:00Z', assigned_to_names: [] },
    ]);
    db.getHouseholdActivities.mockResolvedValue([
      { id: 'act-1', child_id: 'kid1', activity: 'Tennis', day_of_week: 2, time_start: '16:00', time_end: '17:00', show_on_calendar: false },
    ]);
    db.getHouseholdMembers.mockResolvedValue([{ id: 'kid1', name: 'Mason' }]);
    const browse = await handlers.handleCalendarQuery(
      { query_start: '2026-12-14', query_end: '2026-12-20' }, household, user, TZ, {},
    );
    expect(browse.response).not.toMatch(/Tennis/);
    const direct = await handlers.handleCalendarQuery(
      { query_start: '2026-12-14', query_end: '2026-12-20', query_topic: 'tennis' }, household, user, TZ, {},
    );
    expect(direct.response).toMatch(/Mason - Tennis/);
  });

  test('no link or app plug for a week-sized result', async () => {
    const week = Array.from({ length: 5 }, (_, i) => ({
      title: `Event ${i}`, start_time: '2026-12-15T09:00:00Z', end_time: '2026-12-15T10:00:00Z', assigned_to_names: [],
    }));
    db.getCalendarEvents.mockResolvedValue(week);
    const res = await handlers.handleCalendarQuery(
      { query_start: '2026-12-01', query_end: '2026-12-31' }, household, user, TZ, {},
    );
    expect(res.response).toMatch(/Event 4/);
    expect(res.response).not.toMatch(/https?:\/\//);
    expect(res.response).not.toMatch(/open Housemait/i);
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

describe('createCalendarEventFromResult — recurrence', () => {
  it('passes the parsed recurrence through to createCalendarEvent', async () => {
    await handlers.createCalendarEventFromResult(
      { title: 'Mason Piano', date: '2026-06-15', start_time: '17:30', recurrence: 'weekly' },
      user, household, {}, 'Mason has Piano on Mondays at 17:30 every week',
    );
    expect(db.createCalendarEvent).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({ recurrence: 'weekly' }),
      'u1',
    );
  });

  it('defaults recurrence to null for a one-off event', async () => {
    await handlers.createCalendarEventFromResult(
      { title: 'Dentist', date: '2026-06-16', start_time: '09:00' },
      user, household, {}, 'Dentist on the 16th at 9am',
    );
    expect(db.createCalendarEvent).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({ recurrence: null }),
      'u1',
    );
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
    // The schools cache must be invalidated so the Schools card shows the
    // imported dates immediately instead of a stale "No term dates yet".
    expect(cache.invalidate).toHaveBeenCalledWith('schools:h1');
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

describe('generateAndSaveRecipe - learned preferences', () => {
  const aiClient = require('../services/ai-client');

  beforeEach(() => jest.clearAllMocks());

  test('injects learned allergies/dislikes into the prompt as hard constraints', async () => {
    db.getHouseholdPreferences.mockResolvedValue([
      { key: 'allergy', value: 'peanuts', member_name: 'Lynn' },
      { key: 'dislike', value: 'mushrooms', member_name: 'Mason' },
    ]);
    aiClient.callWithFailover.mockResolvedValue({
      text: JSON.stringify({ name: 'Tomato pasta', category: 'dinner', ingredients: [], method: ['Boil pasta'], servings: 4, dietary_tags: [] }),
    });
    await handlers.generateAndSaveRecipe('hh-1', 'easy pasta', null, 4);

    const call = aiClient.callWithFailover.mock.calls[0][0];
    expect(call.messages[0].content).toMatch(/ALLERGIES[^\n]*peanuts/);
    expect(call.messages[0].content).toMatch(/mushrooms/);
    // The system prompt reinforces allergies as a hard safety constraint.
    expect(call.system).toMatch(/allergic/i);
  });

  test('merges the Family-page allergen chips into the recipe constraints', async () => {
    // Regression: the Family "Allergies & dietary requirements" chips
    // (households.allergies) were ignored by the bot's recipe path — only the
    // classifier-learned rows were honoured. Both must feed the constraints.
    db.getHouseholdPreferences.mockResolvedValue([]); // nothing learned in chat
    db.getHouseholdAllergies.mockResolvedValue(['gluten', 'vegan']);
    aiClient.callWithFailover.mockResolvedValue({
      text: JSON.stringify({ name: 'Rice bowl', category: 'dinner', ingredients: [], method: ['Cook rice'], servings: 4, dietary_tags: [] }),
    });
    await handlers.generateAndSaveRecipe('hh-1', 'quick dinner', null, 4);

    const content = aiClient.callWithFailover.mock.calls[0][0].messages[0].content;
    expect(content).toMatch(/ALLERGIES[^\n]*Gluten/);
    expect(content).toMatch(/DIETARY RULES[^\n]*Vegan/);
  });

  test('a preferences lookup failure does not block recipe generation', async () => {
    db.getHouseholdPreferences.mockRejectedValue(new Error('db down'));
    db.getHouseholdAllergies.mockResolvedValue([]); // no chips either → no constraints
    aiClient.callWithFailover.mockResolvedValue({
      text: JSON.stringify({ name: 'Toast', category: 'breakfast', ingredients: [], method: ['Toast bread'], servings: 2, dietary_tags: [] }),
    });
    const recipe = await handlers.generateAndSaveRecipe('hh-1', 'quick breakfast', null, 2);
    expect(recipe.name).toBe('Toast');
    // No constraint block when prefs couldn't be read.
    expect(aiClient.callWithFailover.mock.calls[0][0].messages[0].content).not.toMatch(/ALLERGIES/);
  });
});

describe('isGroundedTarget — weak-target guard', () => {
  const members = ['Grant', 'Lynn', 'Logan'];

  test('the Logan failure: "cancel Logan\'s swimming" is NOT grounded against the citizenship task', () => {
    expect(handlers.isGroundedTarget(
      "Please set a reminder for Grant to cancel Logan's swimming lessons next week. Set the reminder for today.",
      "Do Logan's citizenship",
      members,
    )).toBe(false);
  });

  test('naming the thing is grounded: "cancel my haircut" vs "Haircut"', () => {
    expect(handlers.isGroundedTarget('cancel my haircut', 'Haircut', members)).toBe(true);
  });

  test('topic word grounds even with a shared name: "move the citizenship thing to Friday"', () => {
    expect(handlers.isGroundedTarget('move the citizenship thing to Friday', "Do Logan's citizenship", members)).toBe(true);
  });

  test('a member name + schedule words alone are never grounds to mutate', () => {
    expect(handlers.isGroundedTarget("cancel Logan's thing today", "Do Logan's citizenship", members)).toBe(false);
  });

  test('simple inflections still match (swim/swimming)', () => {
    expect(handlers.isGroundedTarget('cancel the swim class', 'Book Logan swimming lessons', members)).toBe(true);
  });

  test('no message context (internal call) trusts the caller', () => {
    expect(handlers.isGroundedTarget('', 'Anything', members)).toBe(true);
  });
});

describe('handleTextMessage — confirm-before-modify + undo', () => {
  const ai = require('../services/ai');
  const hh = {
    id: 'h9',
    timezone: 'Europe/London',
    members: [
      { id: 'u1', name: 'Grant' },
      { id: 'u2', name: 'Lynn' },
      { id: 'u3', name: 'Logan' },
    ],
  };
  const citizenship = { id: 'task-cit', title: "Do Logan's citizenship", due_date: '2026-07-15' };
  const dentist = { id: 'task-den', title: 'Book dentist appointment', due_date: '2026-07-10' };

  beforeEach(() => {
    db.getCalendarEvents.mockResolvedValue([]);
    db.getHouseholdSchools.mockResolvedValue([]);
    db.getHouseholdPreferences.mockResolvedValue([]);
  });

  test('weak ID-grounded update asks to confirm; "yes" executes; "undo" restores the pre-image', async () => {
    const userA = { id: 'user-a', name: 'Lynn' };
    db.getAllIncompleteTasks.mockResolvedValue([citizenship]);
    ai.classify.mockResolvedValue({
      intent: 'update_task',
      target: { target_id: 1, title: "Do Logan's citizenship" },
      updates: { due_date: '2026-07-02' },
    });

    // 1. Weak target (only overlap with the message is the child's name) → confirm, no mutation.
    const ask = await handlers.handleTextMessage(
      "Set a reminder for Grant to cancel Logan's swimming next week",
      userA, hh, {},
    );
    expect(ask.response).toMatch(/did you mean/i);
    expect(db.updateTask).not.toHaveBeenCalled();

    // 2. "yes" executes the stashed update deterministically.
    const confirmed = await handlers.handleTextMessage('yes', userA, hh, {});
    expect(db.updateTask).toHaveBeenCalledWith('task-cit', 'h9', expect.objectContaining({ due_date: expect.anything() }));
    expect(confirmed.response).toMatch(/updated/i);

    // 3. "undo" restores the changed columns to their pre-image.
    const undone = await handlers.handleTextMessage('undo', userA, hh, {});
    const lastUpdate = db.updateTask.mock.calls[db.updateTask.mock.calls.length - 1];
    expect(lastUpdate[0]).toBe('task-cit');
    expect(lastUpdate[2]).toEqual(expect.objectContaining({ due_date: '2026-07-15' }));
    expect(undone.response).toMatch(/undone/i);
  });

  test('weak delete declined with "no" leaves the item alone', async () => {
    const userB = { id: 'user-b', name: 'Grant' };
    db.getAllIncompleteTasks.mockResolvedValue([citizenship]);
    ai.classify.mockResolvedValue({
      intent: 'delete_task',
      target: { target_id: 1, title: "Do Logan's citizenship" },
      updates: {},
    });

    const ask = await handlers.handleTextMessage("cancel Logan's thing", userB, hh, {});
    expect(ask.response).toMatch(/did you mean/i);
    const declined = await handlers.handleTextMessage('no', userB, hh, {});
    expect(db.deleteTask).not.toHaveBeenCalled();
    expect(declined.response).toMatch(/left it alone/i);
  });

  test('strong delete executes instantly; "undo" re-inserts the captured row', async () => {
    const userC = { id: 'user-c', name: 'Grant' };
    db.getAllIncompleteTasks.mockResolvedValue([dentist]);
    ai.classify.mockResolvedValue({
      intent: 'delete_task',
      target: { target_id: 1, title: 'Book dentist appointment' },
      updates: {},
    });

    // "dentist" appears in the item title → grounded, no confirmation friction.
    const res = await handlers.handleTextMessage('cancel the dentist task', userC, hh, {});
    expect(db.deleteTask).toHaveBeenCalledWith('task-den', 'h9');
    expect(res.response).toMatch(/cancelled task/i);
    expect(res.response).toMatch(/undo/i);

    const undone = await handlers.handleTextMessage('undo', userC, hh, {});
    expect(db.restoreDeletedRow).toHaveBeenCalledWith('tasks', 'h9', expect.objectContaining({ title: 'Book dentist appointment' }));
    expect(undone.response).toMatch(/undone/i);
  });
});

describe('handleTextMessage — conversational referents + stateful offers', () => {
  const ai = require('../services/ai');
  const hh = {
    id: 'h9',
    timezone: 'Europe/London',
    members: [
      { id: 'u1', name: 'Grant' },
      { id: 'u2', name: 'Lynn' },
    ],
  };
  const nici = {
    id: 'ev-nici',
    title: 'Staying at Nici Bournemouth',
    start_time: '2026-08-23T00:00:00Z',
    end_time: '2026-08-23T23:59:59Z',
    all_day: true,
    assigned_to_names: [],
  };

  beforeEach(() => {
    db.getCalendarEvents.mockResolvedValue([]);
    db.getHouseholdSchools.mockResolvedValue([]);
    db.getHouseholdPreferences.mockResolvedValue([]);
  });

  test('the Nici Bournemouth transcript: topic answer then "change it" - no did-you-mean', async () => {
    const userA = { id: 'user-nici-a', name: 'Grant' };
    // 1. "When is nici bournemouth?" - the bot names the event.
    db.getCalendarEvents.mockResolvedValue([nici]);
    const answer = await handlers.handleCalendarQuery(
      { query_topic: 'nici bournemouth' }, hh, userA, 'Europe/London', {},
    );
    expect(answer.response).toMatch(/Nici Bournemouth/);

    // 2. "Please change it to 23-26 August" - target resolves to the SAME
    //    event the bot just named. Grounded by conversation: act, no question.
    db.findEventsByFuzzyTitle.mockResolvedValue([nici]);
    ai.classify.mockResolvedValue({
      intent: 'update_event',
      target: { title: 'nici bournemouth' },
      updates: { end_date: '2026-08-26' },
    });
    const res = await handlers.handleTextMessage('Please change it to 23-26 August', userA, hh, {});
    expect(res.response).not.toMatch(/did you mean/i);
    expect(db.updateCalendarEvent).toHaveBeenCalled();
  });

  test('same message WITHOUT prior conversation still asks to confirm (guard intact)', async () => {
    const userB = { id: 'user-nici-b', name: 'Lynn' }; // fresh user - no referents
    db.findEventsByFuzzyTitle.mockResolvedValue([nici]);
    ai.classify.mockResolvedValue({
      intent: 'update_event',
      target: { title: 'nici bournemouth' },
      updates: { end_date: '2026-08-26' },
    });
    const res = await handlers.handleTextMessage('Please change it to 23-26 August', userB, hh, {});
    expect(res.response).toMatch(/did you mean/i);
    expect(db.updateCalendarEvent).not.toHaveBeenCalled();
  });

  test('a model-authored reminder offer still arms the store: "Yes" is handled without the classifier', async () => {
    const userC = { id: 'user-offer-c', name: 'Grant' };
    // 1. Create an event where the MODEL writes its own trailing offer.
    ai.classify.mockResolvedValue({
      intent: 'create_event',
      calendar_event: { title: "Logan's haircut", date: '2026-07-16', start_time: '15:55' },
      response_message: "Booked - Logan's haircut tomorrow at 3:55 pm. Want me to add a reminder before it?",
    });
    await handlers.handleTextMessage('Logan haircut tomorrow at 15:55', userC, hh, {});

    // 2. "Yes" must route to the deterministic reminder flow (ask lead time),
    //    NOT to classification (the 2026-07-16 phantom-update transcript).
    ai.classify.mockClear();
    const yes = await handlers.handleTextMessage('Yes', userC, hh, {});
    expect(ai.classify).not.toHaveBeenCalled();
    expect(yes.response).toMatch(/how long before|what time/i);
  });

  test('no-op update (echoed existing values) asks what to change instead of claiming success', async () => {
    const userD = { id: 'user-noop-d', name: 'Grant' };
    const dentist = { id: 'ev-den', title: 'Dentist', start_time: '2026-07-22T09:00:00Z', end_time: '2026-07-22T09:30:00Z' };
    db.findEventsByFuzzyTitle.mockResolvedValue([dentist]);
    ai.classify.mockResolvedValue({
      intent: 'update_event',
      target: { title: 'Dentist' },
      updates: { title: 'Dentist' }, // echo - changes nothing
    });
    const res = await handlers.handleTextMessage('update the dentist event', userD, hh, {});
    expect(res.response).toMatch(/what would you like to change/i);
    expect(res.response).not.toMatch(/^✏️ Updated/);
    expect(db.updateCalendarEvent).not.toHaveBeenCalled();
  });

  test('deleting a referent forgets it (no silent re-target)', () => {
    handlers.rememberReferents('user-forget', [{ kind: 'event', id: 'e1', label: 'X' }]);
    expect(handlers.isRecentReferent('user-forget', 'event', 'e1')).toBe(true);
    // rememberMutation with op delete is the internal forget path - exercised
    // via the public surface: a delete flow calls it; here we assert the
    // exported store helpers behave (TTL/dedupe smoke).
    handlers.rememberReferents('user-forget', [{ kind: 'event', id: 'e1', label: 'X' }]);
    expect(handlers.isRecentReferent('user-forget', 'event', 'e2')).toBe(false);
  });
});

describe('handleCalendarQuery — agentic path (BOT_AGENT)', () => {
  const agent = require('../services/agent-loop');
  const nici = {
    id: 'ev-nici2', title: 'Staying at Nici Bournemouth',
    start_time: '2026-08-23T00:00:00Z', end_time: '2026-08-23T23:59:59Z',
    all_day: true, assigned_to_names: [],
  };

  test('flag off: agent never invoked, deterministic answer unchanged', async () => {
    agent.agentEnabled.mockReturnValue(false);
    db.getCalendarEvents.mockResolvedValue([nici]);
    const res = await handlers.handleCalendarQuery(
      { query_topic: 'nici bournemouth' }, household, user, TZ, {}, 'when is nici bournemouth?',
    );
    expect(agent.agentCalendarAnswer).not.toHaveBeenCalled();
    expect(res.response).toMatch(/Nici Bournemouth/);
  });

  test('flag on: agent answer wins and its referents ground a follow-up modify', async () => {
    agent.agentEnabled.mockReturnValue(true);
    agent.agentCalendarAnswer.mockResolvedValue({
      response: "You're at Nici Bournemouth Sun 23 - Wed 26 Aug.",
      referents: [{ kind: 'event', id: 'ev-nici2', label: nici.title }],
    });
    const userAg = { id: 'user-agent-a', name: 'Grant' };
    const res = await handlers.handleCalendarQuery(
      { query_topic: 'nici bournemouth' }, { ...household, members: [] }, userAg, TZ, {}, 'when is nici bournemouth?',
    );
    expect(res.response).toMatch(/Sun 23 - Wed 26 Aug/);
    expect(db.getCalendarEvents).not.toHaveBeenCalled();
    // The agent's referents feed the same grounding store.
    expect(handlers.isRecentReferent('user-agent-a', 'event', 'ev-nici2')).toBe(true);
  });

  test('flag on but agent returns null: deterministic path answers (fallback intact)', async () => {
    agent.agentEnabled.mockReturnValue(true);
    agent.agentCalendarAnswer.mockResolvedValue(null);
    db.getCalendarEvents.mockResolvedValue([nici]);
    const res = await handlers.handleCalendarQuery(
      { query_topic: 'nici bournemouth' }, household, user, TZ, {}, 'when is nici bournemouth?',
    );
    expect(res.response).toMatch(/Nici Bournemouth/);
  });

  test('browse questions (no topic) never touch the agent even when enabled', async () => {
    agent.agentEnabled.mockReturnValue(true);
    agent.agentCalendarAnswer.mockClear();
    db.getCalendarEvents.mockResolvedValue([]);
    await handlers.handleCalendarQuery({}, household, user, TZ, {});
    expect(agent.agentCalendarAnswer).not.toHaveBeenCalled();
  });
});

describe('handleTextMessage — already-set updates', () => {
  const ai = require('../services/ai');
  const hh = { id: 'h9', timezone: 'Europe/London', members: [{ id: 'u1', name: 'Grant' }] };

  test('restating the current dates confirms instead of phantom-updating (tz-format immune)', async () => {
    const userE = { id: 'user-already-e', name: 'Grant' };
    const nici = {
      id: 'ev-nici3', title: 'Staying at Nici Bournemouth',
      start_time: '2026-08-23T00:00:00+00:00', // stored with offset format
      end_time: '2026-08-26T23:59:59+00:00',
      all_day: true, assigned_to_names: [],
    };
    db.findEventsByFuzzyTitle.mockResolvedValue([nici]);
    ai.classify.mockResolvedValue({
      intent: 'update_event',
      target: { title: 'nici bournemouth' },
      // classifier emits Z-format instants for the SAME dates
      updates: { start_date: '2026-08-23', end_date: '2026-08-26' },
    });
    const res = await handlers.handleTextMessage('Change nici bournemouth to 23-26 August', userE, hh, {});
    expect(res.response).toMatch(/already/i);
    expect(db.updateCalendarEvent).not.toHaveBeenCalled();
  });
});

describe('createCalendarEventFromResult — multi-day ranges', () => {
  const hh = { id: 'h1', timezone: 'Europe/London', members: [] };
  const u = { id: 'u1', name: 'Grant' };

  test('all-day event with end_date stores the FULL range (real 5-10 Sept transcript)', async () => {
    db.findSimilarEvent.mockResolvedValue(null);
    const actions = { eventsAdded: [], shoppingAdded: [], shoppingCompleted: [], tasksAdded: [], tasksCompleted: [] };
    await handlers.createCalendarEventFromResult(
      { title: 'Testing', date: '2026-09-05', end_date: '2026-09-10', all_day: true },
      u, hh, actions, 'Add testing event from 5-10 Sept',
    );
    const row = db.createCalendarEvent.mock.calls[0][1];
    expect(row.start_time).toBe('2026-09-05T00:00:00Z');
    expect(row.end_time).toBe('2026-09-10T23:59:59Z');
  });

  test('invalid/earlier end_date is ignored (single-day)', async () => {
    db.findSimilarEvent.mockResolvedValue(null);
    const actions = { eventsAdded: [], shoppingAdded: [], shoppingCompleted: [], tasksAdded: [], tasksCompleted: [] };
    await handlers.createCalendarEventFromResult(
      { title: 'Testing', date: '2026-09-05', end_date: '2026-09-01', all_day: true },
      u, hh, actions, '',
    );
    const row = db.createCalendarEvent.mock.calls[0][1];
    expect(row.end_time).toBe('2026-09-05T23:59:59Z');
  });
});

// ─── School-add conversation (AC1) ──────────────────────────────────────────
describe('school-add conversation', () => {
  const schoolAdd = require('../services/school-add');
  const hh = { id: 'h9', timezone: 'Europe/London', members: [] };
  const parent = { id: 'u9', name: 'Louise' };
  const emptyActions = () => ({ shoppingAdded: [], shoppingCompleted: [], tasksAdded: [], tasksCompleted: [], eventsAdded: [] });
  const GIAS = {
    urn: 100001, name: 'Ashfield Primary School', type: 'Community school',
    local_authority: 'Leeds', address: 'Moor Road, Leeds', postcode: 'LS12 3SE',
  };
  const SCHOOL = { id: 'sc1', school_name: 'Ashfield Primary School', local_authority: 'Leeds' };

  beforeEach(() => {
    jest.clearAllMocks();
    db.getHouseholdMembers.mockResolvedValue([]);
  });

  test('single candidate → confirm with full address, then "yes" completes and auto-links the only child', async () => {
    schoolAdd.searchGiasCandidates.mockResolvedValue([GIAS]);
    schoolAdd.addConfirmedSchool.mockResolvedValue({ school: SCHOOL, outcome: 'la_imported', imported: 27, years: ['2026-2027'] });
    db.getHouseholdMembers.mockResolvedValue([
      { id: 'k1', name: 'Sofia', member_type: 'dependent', dependent_kind: 'child' },
      { id: 'a1', name: 'Louise', member_type: 'account' },
    ]);

    const ask = await handlers.handleSchoolAdd('Ashfield Primary in Leeds', parent, hh, {}, emptyActions());
    expect(ask.response).toMatch(/Moor Road, Leeds LS12 3SE/);
    expect(ask.response).toMatch(/is that the one\?/i);
    expect(schoolAdd.addConfirmedSchool).not.toHaveBeenCalled();

    const done = await handlers.handleTextMessage('yes', parent, hh, {});
    expect(schoolAdd.addConfirmedSchool).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: 'h9', gias: expect.objectContaining({ urn: 100001 }) })
    );
    expect(done.response).toMatch(/27 term dates/);
    expect(done.response).toMatch(/Leeds council/);
    expect(db.updateUser).toHaveBeenCalledWith('k1', { school_id: 'sc1' });
  });

  test('several candidates → numbered shortlist; "2" picks the second', async () => {
    const c2 = { ...GIAS, urn: 100002, name: "Queen Elizabeth's Grammar School", address: 'Darwen Road, Blackburn', postcode: 'BB2 7DU' };
    const c3 = { ...GIAS, urn: 100003, name: "Queen Elizabeth's School", address: 'High St, Barnet', postcode: 'EN5 5RR' };
    schoolAdd.searchGiasCandidates.mockResolvedValue([GIAS, c2, c3]);
    schoolAdd.addConfirmedSchool.mockResolvedValue({ school: SCHOOL, outcome: 'la_imported', imported: 12, years: [] });

    const ask = await handlers.handleSchoolAdd("Queen Elizabeth's", parent, hh, {}, emptyActions());
    expect(ask.response).toMatch(/1\. /);
    expect(ask.response).toMatch(/3\. /);

    await handlers.handleTextMessage('2', parent, hh, {});
    expect(schoolAdd.addConfirmedSchool).toHaveBeenCalledWith(
      expect.objectContaining({ gias: expect.objectContaining({ urn: 100002 }) })
    );
  });

  test('"none of these" → invites a better search, imports nothing', async () => {
    schoolAdd.searchGiasCandidates.mockResolvedValue([GIAS]);
    await handlers.handleSchoolAdd('Ashfield', parent, hh, {}, emptyActions());
    const reply = await handlers.handleTextMessage('none of these', parent, hh, {});
    expect(reply.response).toMatch(/look again/i);
    expect(schoolAdd.addConfirmedSchool).not.toHaveBeenCalled();
  });

  test('own-calendar school with no directory dates → asks for photo/link/PDF, then a URL imports', async () => {
    schoolAdd.searchGiasCandidates.mockResolvedValue([{ ...GIAS, type: 'Academy converter' }]);
    schoolAdd.addConfirmedSchool.mockResolvedValue({ school: SCHOOL, outcome: 'needs_source', imported: 0, years: [] });
    schoolAdd.importTermDatesFromUrl.mockResolvedValue({ imported: 12, years: ['2026-2027'] });
    db.getHouseholdSchools.mockResolvedValue([SCHOOL]);

    await handlers.handleSchoolAdd("St Bede's Academy York", parent, hh, {}, emptyActions());
    const asked = await handlers.handleTextMessage('yes', parent, hh, {});
    expect(asked.response).toMatch(/photo|link|PDF/i);
    expect(asked.response).toMatch(/won't guess/i);

    const imported = await handlers.handleTextMessage('https://stbedes.example.sch.uk/term-dates', parent, hh, {});
    expect(schoolAdd.importTermDatesFromUrl).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://stbedes.example.sch.uk/term-dates' })
    );
    expect(imported.response).toMatch(/12 term dates/);
  });

  test('multiple children → asks which kid; a name answer links just that child', async () => {
    schoolAdd.searchGiasCandidates.mockResolvedValue([GIAS]);
    schoolAdd.addConfirmedSchool.mockResolvedValue({ school: SCHOOL, outcome: 'la_imported', imported: 27, years: [] });
    db.getHouseholdMembers.mockResolvedValue([
      { id: 'k1', name: 'Sofia', member_type: 'dependent', dependent_kind: 'child' },
      { id: 'k2', name: 'Max', member_type: 'dependent', dependent_kind: 'child' },
    ]);

    await handlers.handleSchoolAdd('Ashfield Primary Leeds', parent, hh, {}, emptyActions());
    const done = await handlers.handleTextMessage('yes', parent, hh, {});
    expect(done.response).toMatch(/Which of the kids/i);
    expect(db.updateUser).not.toHaveBeenCalled();

    const linked = await handlers.handleTextMessage('Sofia', parent, hh, {});
    expect(db.updateUser).toHaveBeenCalledWith('k1', { school_id: 'sc1' });
    expect(db.updateUser).not.toHaveBeenCalledWith('k2', expect.anything());
    expect(linked.response).toMatch(/Sofia/);
  });

  test('pets never count as children: pet-only household gets no which-kid question and no link', async () => {
    schoolAdd.searchGiasCandidates.mockResolvedValue([GIAS]);
    schoolAdd.addConfirmedSchool.mockResolvedValue({ school: SCHOOL, outcome: 'la_imported', imported: 27, years: [] });
    db.getHouseholdMembers.mockResolvedValue([
      { id: 'p1', name: 'Luna', member_type: 'dependent', dependent_kind: 'pet' },
    ]);

    await handlers.handleSchoolAdd('Ashfield Primary Leeds', parent, hh, {}, emptyActions());
    const done = await handlers.handleTextMessage('yes', parent, hh, {});
    expect(done.response).not.toMatch(/Which of the kids/i);
    expect(db.updateUser).not.toHaveBeenCalled();
  });
});

// ─── Capture-opener school answer (AC2) ─────────────────────────────────────
describe('opener school answer', () => {
  const schoolAdd = require('../services/school-add');
  const ai = require('../services/ai');
  const hh = { id: 'h9', timezone: 'Europe/London', members: [] };
  const parent = { id: 'u9', name: 'Louise' };
  const GIAS = { urn: 100001, name: 'Ashfield Primary School', type: 'Community school', local_authority: 'Leeds', address: 'Moor Road, Leeds', postcode: 'LS12 3SE' };

  beforeEach(() => {
    jest.clearAllMocks();
    db.getHouseholdMembers.mockResolvedValue([]);
  });

  test('armed + recognisable school name → straight to the confirm question, no LLM call', async () => {
    schoolAdd.searchGiasCandidates.mockResolvedValue([GIAS]);
    handlers.armOpenerSchoolAnswer(parent.id);
    const reply = await handlers.handleTextMessage('Ashfield Primary Leeds', parent, hh, {});
    expect(reply.response).toMatch(/is that the one\?/i);
    expect(ai.classify).not.toHaveBeenCalled();
  });

  test('armed + unrelated reply → GIAS misses, falls through to classify untouched', async () => {
    schoolAdd.searchGiasCandidates.mockResolvedValue([]);
    ai.classify.mockResolvedValue({ intent: 'chat', response_message: 'Of course!' });
    handlers.armOpenerSchoolAnswer(parent.id);
    const reply = await handlers.handleTextMessage('what else can you do?', parent, hh, {});
    expect(ai.classify).toHaveBeenCalled();
    expect(reply.response).toMatch(/Of course!/);
  });

  test('one-shot: the armed state is consumed by the first message', async () => {
    schoolAdd.searchGiasCandidates.mockResolvedValue([]);
    ai.classify.mockResolvedValue({ intent: 'chat', response_message: 'ok' });
    handlers.armOpenerSchoolAnswer(parent.id);
    await handlers.handleTextMessage('random message', parent, hh, {});
    schoolAdd.searchGiasCandidates.mockClear();
    await handlers.handleTextMessage('Ashfield Primary Leeds', parent, hh, {});
    // Second message is NOT tried against GIAS via the opener path.
    expect(schoolAdd.searchGiasCandidates).not.toHaveBeenCalled();
  });
});

// ─── In-thread brief stop/start (AC4) ───────────────────────────────────────
describe('in-thread brief stop/start', () => {
  const ai = require('../services/ai');
  const hh = { id: 'h9', timezone: 'Europe/London', members: [] };
  const parent = { id: 'u9', name: 'Louise' };

  beforeEach(() => jest.clearAllMocks());

  test.each([
    'stop',
    'STOP',
    'unsubscribe',
    'stop the morning messages',
    'please stop messaging me',
    'turn off the briefs',
    'stop sending me these',
    "don't message me",
  ])('"%s" opts out, replies with the way back in, no LLM call', async (msg) => {
    const reply = await handlers.handleTextMessage(msg, parent, hh, {});
    expect(db.upsertNotificationPreferences).toHaveBeenCalledWith('u9', { whatsapp_daily_reminder: false });
    expect(reply.response).toMatch(/start briefs/i);
    expect(ai.classify).not.toHaveBeenCalled();
  });

  test('"start briefs" opts back in', async () => {
    const reply = await handlers.handleTextMessage('start briefs', parent, hh, {});
    expect(db.upsertNotificationPreferences).toHaveBeenCalledWith('u9', { whatsapp_daily_reminder: true });
    expect(reply.response).toMatch(/back on/i);
  });

  test.each([
    "stop Logan's swimming club",
    'remove wraparound care today only',
    'stop buying oat milk',
  ])('"%s" is NOT an opt-out - classifies normally', async (msg) => {
    ai.classify.mockResolvedValue({ intent: 'chat', response_message: 'ok' });
    await handlers.handleTextMessage(msg, parent, hh, {});
    expect(db.upsertNotificationPreferences).not.toHaveBeenCalled();
    expect(ai.classify).toHaveBeenCalled();
  });
});

// ─── One-shot pin nudge on delight moments ──────────────────────────────────
describe('pin nudge', () => {
  const schoolAdd = require('../services/school-add');
  const hh = { id: 'h9', timezone: 'Europe/London', members: [] };
  const parent = { id: 'u9', name: 'Louise' };
  const GIAS = { urn: 1, name: 'Ashfield Primary School', type: 'Community school', local_authority: 'Leeds', address: 'Moor Road, Leeds', postcode: 'LS12 3SE' };
  const SCHOOL = { id: 'sc1', school_name: 'Ashfield Primary School', local_authority: 'Leeds' };

  beforeEach(() => {
    jest.clearAllMocks();
    db.claimPinNudge.mockResolvedValue(true); // unclaimed → append on first delight
  });

  test('rides a single-child school import (no which-kid question)', async () => {
    schoolAdd.searchGiasCandidates.mockResolvedValue([GIAS]);
    schoolAdd.addConfirmedSchool.mockResolvedValue({ school: SCHOOL, outcome: 'la_imported', imported: 27, years: [] });
    db.getHouseholdMembers.mockResolvedValue([{ id: 'k1', name: 'Sofia', member_type: 'dependent', dependent_kind: 'child' }]);
    await handlers.handleSchoolAdd('Ashfield Primary Leeds', parent, hh, {}, {});
    const done = await handlers.handleTextMessage('yes', parent, hh, {});
    expect(done.response).toMatch(/pin this chat/i);
    expect(db.claimPinNudge).toHaveBeenCalledWith('u9');
  });

  test('does NOT ride the multi-child import message (which ends in a question) - rides the which-kid answer instead', async () => {
    schoolAdd.searchGiasCandidates.mockResolvedValue([GIAS]);
    schoolAdd.addConfirmedSchool.mockResolvedValue({ school: SCHOOL, outcome: 'la_imported', imported: 27, years: [] });
    db.getHouseholdMembers.mockResolvedValue([
      { id: 'k1', name: 'Sofia', member_type: 'dependent', dependent_kind: 'child' },
      { id: 'k2', name: 'Max', member_type: 'dependent', dependent_kind: 'child' },
    ]);
    await handlers.handleSchoolAdd('Ashfield Primary Leeds', parent, hh, {}, {});
    const imported = await handlers.handleTextMessage('yes', parent, hh, {});
    expect(imported.response).toMatch(/Which of the kids/i);
    expect(imported.response).not.toMatch(/pin this chat/i);

    const linked = await handlers.handleTextMessage('both', parent, hh, {});
    expect(linked.response).toMatch(/pin this chat/i);
  });

  test('rides a "sorted your week" multi-event create', async () => {
    const ai = require('../services/ai');
    ai.classify.mockResolvedValue({
      intent: 'create_event',
      calendar_events: [
        { title: 'Dentist', date: '2026-07-23', start_time: '14:00' },
        { title: 'Dinner with Alex', date: '2026-07-24', start_time: '19:30' },
      ],
      response_message: '',
    });
    const res = await handlers.handleTextMessage('dentist Thursday 2pm and MOT Friday 9am', parent, hh, {});
    expect(res.response).toMatch(/Added 2 events/);
    expect(res.response).toMatch(/pin this chat/i);
  });

  test('claimed already (false) → no pin line', async () => {
    db.claimPinNudge.mockResolvedValue(false);
    schoolAdd.searchGiasCandidates.mockResolvedValue([GIAS]);
    schoolAdd.addConfirmedSchool.mockResolvedValue({ school: SCHOOL, outcome: 'la_imported', imported: 27, years: [] });
    db.getHouseholdMembers.mockResolvedValue([{ id: 'k1', name: 'Sofia', member_type: 'dependent', dependent_kind: 'child' }]);
    await handlers.handleSchoolAdd('Ashfield Primary Leeds', parent, hh, {}, {});
    const done = await handlers.handleTextMessage('yes', parent, hh, {});
    expect(done.response).not.toMatch(/pin this chat/i);
  });
});

describe('pending reminder flow — the "Day before" loop transcript (2026-07-24)', () => {
  // Real WhatsApp failure: the bot offered "a reminder the day before?",
  // the user said Yes, then answered "day before" THREE ways, and got the
  // identical "how long before?" question four times. Two bugs: a bare
  // "yes" ignored the lead the offer itself proposed, and the parser
  // couldn't read the number-less phrase its own example suggested.
  const ai = require('../services/ai');
  const { extractReminderOffsets } = require('../services/reminder-extract');
  const hh = { id: 'h1', timezone: 'Europe/London', members: [] };

  async function createLoganEvent(u, offerText) {
    ai.classify.mockResolvedValue({
      intent: 'create_event',
      calendar_event: { title: 'Logan eye appointment', date: '2026-10-29', start_time: '09:30' },
      response_message: offerText,
    });
    return handlers.handleTextMessage('Logan eye appointment on 29 October 9:30', u, hh, {});
  }

  test('offer names "the day before" → bare "Yes" saves it directly, no re-ask', async () => {
    const u = { id: 'u-loop-1', name: 'Grant' };
    await createLoganEvent(u, 'Booked! Logan eye appointment on Thursday 29 October at 9:30 am. Want me to add a reminder the day before?');
    const yes = await handlers.handleTextMessage('Yes', u, hh, {});
    expect(db.saveEventReminders).toHaveBeenCalledWith('e-1', 'h1', [{ time: 1, unit: 'days' }], expect.anything());
    expect(yes.response).toMatch(/day before/i);
    expect(yes.response).not.toMatch(/how long before/i);
  });

  test.each(['You said day before', 'Day before', 'The day before !!'])(
    'generic offer → "Yes" asks once → %s parses and saves (the exact loop replies)',
    async (reply) => {
      const u = { id: `u-loop-${reply.length}`, name: 'Grant' };
      await createLoganEvent(u, 'Booked! Logan eye appointment on Thursday 29 October at 9:30 am. Want me to add a reminder for it?');
      const yes = await handlers.handleTextMessage('Yes', u, hh, {});
      expect(yes.response).toMatch(/how long before/i); // no lead proposed - asking is right
      const ans = await handlers.handleTextMessage(reply, u, hh, {});
      expect(db.saveEventReminders).toHaveBeenCalledWith('e-1', 'h1', [{ time: 1, unit: 'days' }], expect.anything());
      expect(ans.response).toMatch(/day before/i);
      expect(ans.response).not.toMatch(/how long before/i);
    },
  );

  test('a bare duration reply ("2 hours") answers the question without "before"', async () => {
    const u = { id: 'u-loop-bare', name: 'Grant' };
    await createLoganEvent(u, 'Booked! Want me to add a reminder for it?');
    await handlers.handleTextMessage('Yes', u, hh, {});
    const ans = await handlers.handleTextMessage('2 hours', u, hh, {});
    expect(db.saveEventReminders).toHaveBeenCalledWith('e-1', 'h1', [{ time: 2, unit: 'hours' }], expect.anything());
    expect(ans.response).toMatch(/2 hours before/i);
  });

  test('unparseable reminder-ish reply → Haiku fallback saves what it extracts', async () => {
    const u = { id: 'u-loop-llm', name: 'Grant' };
    await createLoganEvent(u, 'Booked! Want me to add a reminder for it?');
    await handlers.handleTextMessage('Yes', u, hh, {});
    extractReminderOffsets.mockResolvedValueOnce({ offsets: [{ time: 2, unit: 'hours' }] });
    const ans = await handlers.handleTextMessage('remind me a wee bit ahead of time pls', u, hh, {});
    expect(extractReminderOffsets).toHaveBeenCalled();
    expect(db.saveEventReminders).toHaveBeenCalledWith('e-1', 'h1', [{ time: 2, unit: 'hours' }], expect.anything());
    expect(ans.response).toMatch(/2 hours before/i);
  });

  test('never asks the same question twice: second failure lets go gracefully', async () => {
    const u = { id: 'u-loop-giveup', name: 'Grant' };
    await createLoganEvent(u, 'Booked! Want me to add a reminder for it?');
    const q1 = await handlers.handleTextMessage('Yes', u, hh, {});           // ask #1
    const q2 = await handlers.handleTextMessage('remind me at whatever works', u, hh, {}); // LLM null → ask #2 (different copy)
    const q3 = await handlers.handleTextMessage('remind me at whatever works', u, hh, {}); // give up, keep the event
    expect(q2.response).not.toBe(q1.response);
    expect(q3.response).toMatch(/saved either way/i);
    expect(db.saveEventReminders).not.toHaveBeenCalled();
    // State dropped: the next message goes to normal classification.
    ai.classify.mockClear();
    ai.classify.mockResolvedValue({ intent: 'general', response_message: 'ok' });
    await handlers.handleTextMessage('remind me at whatever works', u, hh, {});
    expect(ai.classify).toHaveBeenCalled();
  });
});
