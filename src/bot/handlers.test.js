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
jest.mock('../services/cache', () => ({ invalidate: jest.fn(), get: jest.fn(), set: jest.fn() }));

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

  test('query_topic with no match admits it and shows what IS on', async () => {
    db.getCalendarEvents.mockResolvedValue([
      { title: 'See Jess dog', start_time: '2026-12-15T09:00:00Z', end_time: '2026-12-15T10:00:00Z', assigned_to_names: [] },
    ]);
    const res = await handlers.handleCalendarQuery(
      { query_start: '2026-12-15', query_end: '2026-12-15', query_topic: 'tennis' }, household, user, TZ, {},
    );
    expect(res.response).toMatch(/can't see anything matching "tennis"/i);
    expect(res.response).toMatch(/Jess dog/); // still helpful: shows the day
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
