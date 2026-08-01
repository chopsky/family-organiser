/**
 * WhatsApp bot meal_plan_add: "spag bol on Tuesday" plans a real meal_plan
 * row instead of the bot claiming there is no meal plan feature (real
 * 2026-08-01 failure - the web chat said exactly that while Meals is a main
 * nav tab). Recipe Box recipes are linked by fuzzy name so the planned meal
 * opens the full recipe in the app.
 */
jest.mock('../db/queries', () => ({
  takeEveningBriefOffer: jest.fn(() => Promise.resolve(false)),
  armEveningBriefOffer: jest.fn(() => Promise.resolve()),
  getCalendarEvents: jest.fn(() => Promise.resolve([])),
  getHouseholdActivities: jest.fn(() => Promise.resolve([])),
  getHouseholdMembers: jest.fn(() => Promise.resolve([])),
  getHouseholdSchools: jest.fn(() => Promise.resolve([])),
  getHouseholdPreferences: jest.fn(() => Promise.resolve([])),
  getHouseholdAllergies: jest.fn(() => Promise.resolve([])),
  getRecentWhatsAppTurns: jest.fn(() => Promise.resolve([])),
  getHouseholdNotes: jest.fn(() => Promise.resolve([])),
  getAllIncompleteTasks: jest.fn(() => Promise.resolve([])),
  getTermDatesBySchoolIds: jest.fn(() => Promise.resolve([])),
  claimPinNudge: jest.fn(() => Promise.resolve(false)),
  getMealPlanForWeek: jest.fn(() => Promise.resolve([])),
  getShoppingList: jest.fn(() => Promise.resolve([])),
  // Meal-plan surface under test
  getRecipes: jest.fn(() => Promise.resolve([])),
  createMealPlanEntry: jest.fn((hid, data) => Promise.resolve({ id: `mp-${data.date}`, ...data })),
}));
jest.mock('../services/ai', () => ({
  classify: jest.fn(), scanReceipt: jest.fn(), matchReceiptToList: jest.fn(),
  scanImage: jest.fn(), runWebSearch: jest.fn(),
}));
jest.mock('../services/transcribe', () => ({ transcribeVoice: jest.fn() }));
jest.mock('../services/weather', () => ({
  getWeatherReport: jest.fn(), extractLocationFromMessage: jest.fn(), geocodeLocation: jest.fn(),
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
jest.mock('../services/cache', () => ({ invalidate: jest.fn(), get: jest.fn(), set: jest.fn() }));
jest.mock('../services/agent-loop', () => ({ agentEnabled: jest.fn(() => false), agentCalendarAnswer: jest.fn() }));
jest.mock('../services/school-add', () => ({
  searchGiasCandidates: jest.fn(), addConfirmedSchool: jest.fn(), importTermDatesFromUrl: jest.fn(),
  candidateLabel: (c) => c.name,
}));

const handlers = require('./handlers');
const db = require('../db/queries');
const { classify } = require('../services/ai');

const household = { id: 'h1', timezone: 'Europe/London', members: [] };
const user = { id: 'u1', name: 'Grant' };

beforeEach(() => jest.clearAllMocks());

test('plans each entry onto its day and names the days in the reply', async () => {
  classify.mockResolvedValue({
    intent: 'meal_plan_add',
    meal_plan_entries: [
      { date: '2026-08-04', meal_name: 'Spaghetti bolognese', category: 'dinner' },
      { date: '2026-08-07', meal_name: 'Fish and chips', category: 'dinner' },
    ],
    response_message: 'Planned!',
  });
  const res = await handlers.handleTextMessage('put spag bol on the meal plan for tuesday and fish and chips friday', user, household);

  expect(db.createMealPlanEntry).toHaveBeenCalledTimes(2);
  expect(db.createMealPlanEntry).toHaveBeenNthCalledWith(1, 'h1',
    { date: '2026-08-04', category: 'dinner', recipe_id: null, meal_name: 'Spaghetti bolognese' }, 'u1');
  expect(res.response).toMatch(/Tuesday 4 Aug/);
  expect(res.response).toMatch(/Friday 7 Aug/);
  expect(res.response).toMatch(/Spaghetti bolognese/);
});

test('links a Recipe Box recipe by fuzzy name match', async () => {
  db.getRecipes.mockResolvedValue([
    { id: 'r-9', name: 'One-Pan Lemon Garlic Chicken & Roast Veg' },
  ]);
  classify.mockResolvedValue({
    intent: 'meal_plan_add',
    meal_plan_entries: [{ date: '2026-08-05', meal_name: 'lemon garlic chicken', category: 'dinner' }],
    response_message: '',
  });
  await handlers.handleTextMessage('lemon garlic chicken for dinner wednesday', user, household);

  expect(db.createMealPlanEntry).toHaveBeenCalledWith('h1',
    { date: '2026-08-05', category: 'dinner', recipe_id: 'r-9', meal_name: 'lemon garlic chicken' }, 'u1');
});

test('no valid entries asks instead of pretending', async () => {
  classify.mockResolvedValue({
    intent: 'meal_plan_add',
    meal_plan_entries: [{ date: 'Tuesday', meal_name: 'Fish' }],
    response_message: 'Planned!',
  });
  const res = await handlers.handleTextMessage('plan some meals', user, household);

  expect(db.createMealPlanEntry).not.toHaveBeenCalled();
  expect(res.response).toMatch(/which meal should go on which day/i);
});

test('an unknown category falls back to dinner rather than a bad insert', async () => {
  classify.mockResolvedValue({
    intent: 'meal_plan_add',
    meal_plan_entries: [{ date: '2026-08-06', meal_name: 'Pancakes', category: 'brunch' }],
    response_message: '',
  });
  await handlers.handleTextMessage('pancakes thursday brunch on the meal plan', user, household);

  expect(db.createMealPlanEntry).toHaveBeenCalledWith('h1',
    { date: '2026-08-06', category: 'dinner', recipe_id: null, meal_name: 'Pancakes' }, 'u1');
});
