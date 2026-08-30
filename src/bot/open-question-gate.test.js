/**
 * Open-question gate on the READ fast-path. Contract: when the bot's
 * previous turn ended with a question, a SHORT reply ("Today") must skip
 * the history-blind read router and fall through to the full pipeline,
 * which reads history - the live padel bug turned a date answer into a
 * calendar dump. Harness mirrors handlers.test.js (the proven mock
 * surface), plus a mocked intent-router so the fast-path is observable.
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
  getNotificationPreferences: jest.fn(() => Promise.resolve(null)),
  getCalendarEventById: jest.fn(() => Promise.resolve(null)),
  // Named lists (create_list intent + list_name targeting)
  getDefaultShoppingList: jest.fn(() => Promise.resolve({ id: 'list-default', name: 'Default' })),
  findShoppingListByName: jest.fn(() => Promise.resolve(null)),
  createShoppingList: jest.fn((hid, name) => Promise.resolve({ id: 'list-new', name })),
  getShoppingLists: jest.fn(() => Promise.resolve([])),
  addShoppingItemsWithDedupe: jest.fn((hid, items) => Promise.resolve({
    created: items.map((i, n) => ({ id: `s-${n}`, ...i })), duplicates: [], updated: [],
  })),
  deleteShoppingItem: jest.fn(() => Promise.resolve()),
  deleteShoppingListIfEmpty: jest.fn(() => Promise.resolve(true)),
  // Runs before classify on every inbound message - default to "no offer
  // pending" so it stays out of the way of unrelated tests.
  takeEveningBriefOffer: jest.fn(() => Promise.resolve(false)),
  armEveningBriefOffer: jest.fn(() => Promise.resolve()),
  hasEveningBriefOfferBeenSent: jest.fn(() => Promise.resolve(true)),
  stampEveningBriefOfferSent: jest.fn(() => Promise.resolve()),
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

jest.mock('../services/intent-router', () => ({
  routeReadIntent: jest.fn(() => Promise.resolve(null)),
}));

const { routeReadIntent } = require('../services/intent-router');

beforeEach(() => jest.clearAllMocks());

async function routerCalls(text, history) {
  db.getRecentWhatsAppTurns.mockResolvedValue(history);
  db.getHouseholdMembers.mockResolvedValue([]);
  routeReadIntent.mockResolvedValue(null);
  // The gate + router sit ~80 lines into the pipeline; the classify stage
  // beyond them needs a far deeper mock surface that would add nothing to
  // THIS contract. A crash after the router leaves the call count intact.
  try { await handlers.handleTextMessage(text, user, household, {}); } catch { /* downstream mock gaps */ }
  return routeReadIntent.mock.calls.length;
}

describe('open-question gate on the READ fast-path', () => {
  const askedTurn = [
    { role: 'user', content: 'Padel 8PM at Powerleague Mill Hill' },
    { role: 'assistant', content: "Sure - what day is the padel? Once I've got a date I'll add it." },
  ];
  const statementTurn = [
    { role: 'user', content: 'Add milk' },
    { role: 'assistant', content: 'Done - milk is on the list.' },
  ];

  test('short reply after an open question skips the read router', async () => {
    expect(await routerCalls('Today', askedTurn)).toBe(0);
  });

  test('question ending with a stray quote still counts as open', async () => {
    expect(await routerCalls('Today', [{ role: 'assistant', content: 'What day is the padel?"' }])).toBe(0);
  });

  test('short message after a plain statement still fast-paths', async () => {
    expect(await routerCalls('Today', statementTurn)).toBe(1);
  });

  test('long message after an open question still fast-paths', async () => {
    expect(await routerCalls('Actually can you show me everything on the calendar for this whole week please', askedTurn)).toBe(1);
  });

  test('no history at all still fast-paths', async () => {
    expect(await routerCalls('Today', [])).toBe(1);
  });
});
