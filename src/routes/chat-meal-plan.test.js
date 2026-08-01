/**
 * Web chat: meal-plan action + multi-object fence extraction.
 *
 * Born from a real 2026-08-01 failure: "add 5 easy dinners" produced five
 * create_recipe objects in ONE ```json fence - the extractor parsed only
 * the first, stripped the fence, and silently dropped the other four while
 * the prose claimed all five were saved. Then "add them to my meal plan"
 * dead-ended because no meal-plan action existed in the chat at all.
 */
jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'u1' }; next(); },
  requireHousehold: (req, _res, next) => { req.householdId = 'h1'; next(); },
}));
jest.mock('../services/ai', () => ({
  scanImage: jest.fn(), scanReceipt: jest.fn(), matchReceiptToList: jest.fn(), classify: jest.fn(),
}));
jest.mock('../services/ai-client', () => ({ callWithFailover: jest.fn() }));
jest.mock('../services/weather', () => ({
  getWeatherReport: jest.fn().mockResolvedValue(null),
  composeWeatherAnswer: jest.fn(),
  getCityFromTimezone: jest.fn().mockReturnValue(null),
  extractLocationFromMessage: jest.fn().mockReturnValue(null),
  geocodeLocation: jest.fn().mockResolvedValue(null),
  reverseGeocode: jest.fn().mockResolvedValue(null),
}));
jest.mock('../services/transcribe', () => ({ transcribeVoice: jest.fn() }));
jest.mock('../bot/handlers', () => ({
  generateAndSaveRecipe: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');
const { callWithFailover } = require('../services/ai-client');
const { generateAndSaveRecipe } = require('../bot/handlers');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/chat', require('./chat'));
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  db.getHouseholdMembers.mockResolvedValue([{ id: 'u1', name: 'Grant' }]);
  db.getHouseholdNotes.mockResolvedValue([]);
  db.getShoppingList.mockResolvedValue([]);
  db.getAllIncompleteTasks.mockResolvedValue([]);
  db.getCalendarEvents.mockResolvedValue([]);
  db.getHouseholdById.mockResolvedValue({ id: 'h1', name: 'Test', timezone: 'Europe/London' });
  db.getHouseholdSchools.mockResolvedValue([]);
  db.getRecipes.mockResolvedValue([]);
  db.getHouseholdPreferences.mockResolvedValue([]);
  db.getHouseholdActivities.mockResolvedValue([]);
  db.getTermDatesBySchoolIds.mockResolvedValue([]);
  db.getMealPlanForWeek.mockResolvedValue([]);
  db.createConversation.mockResolvedValue({ id: 'c1' });
  db.getChatHistory.mockResolvedValue([]);
  db.saveChatMessage.mockResolvedValue({});
  db.touchConversation.mockResolvedValue({});
  db.getRecipeById.mockResolvedValue(null);
  db.createMealPlanEntry.mockImplementation(async (_hh, data) => ({ id: `mp-${data.date}`, ...data }));
});

const fenceReply = (objects) => ({
  text: `Done!\n\n\`\`\`json\n${objects.map((o) => JSON.stringify(o)).join('\n')}\n\`\`\``,
  provider: 'claude',
});

describe('multi-object fences (the 1-of-5-recipes bug)', () => {
  test('every object in a single fence is executed, not just the first', async () => {
    generateAndSaveRecipe.mockImplementation(async (desc) => ({ id: `r-${desc}`, name: desc }));
    callWithFailover.mockResolvedValue(fenceReply([
      { action: 'create_recipe', description: 'lemon chicken', dietary: 'gluten-free', servings: 4 },
      { action: 'create_recipe', description: 'taco bowls', dietary: 'gluten-free', servings: 4 },
      { action: 'create_recipe', description: 'sausage traybake', dietary: 'gluten-free', servings: 4 },
      { action: 'create_recipe', description: 'lemon butter fish', dietary: 'gluten-free', servings: 4 },
      { action: 'create_recipe', description: 'chicken stir-fry', dietary: 'gluten-free', servings: 4 },
    ]));

    const res = await request(app()).post('/api/chat').send({ message: 'add 5 easy dinners for me this week' });

    expect(res.status).toBe(200);
    expect(generateAndSaveRecipe).toHaveBeenCalledTimes(5);
    expect(res.body.actions).toHaveLength(5);
    // The fence must be stripped from the visible reply.
    expect(res.body.message).not.toContain('create_recipe');
  });

  test('a malformed object mid-fence does not lose the ones after it', async () => {
    callWithFailover.mockResolvedValue({
      text: 'Done!\n\n```json\n{"action": "save_note", "key": "a", "value": "1"}\n{"action": broken}\n{"action": "save_note", "key": "b", "value": "2"}\n```',
      provider: 'claude',
    });
    db.upsertHouseholdNote.mockResolvedValue({});

    const res = await request(app()).post('/api/chat').send({ message: 'save both notes' });

    expect(res.status).toBe(200);
    expect(db.upsertHouseholdNote).toHaveBeenCalledTimes(2);
  });
});

describe('add_meal_plan action', () => {
  test('plans each meal onto its day, linking verified recipe ids', async () => {
    db.getRecipeById.mockImplementation(async (id) => (id === 'r-real' ? { id, name: 'Lemon Chicken' } : null));
    callWithFailover.mockResolvedValue(fenceReply([{
      action: 'add_meal_plan',
      meals: [
        { date: '2026-08-03', meal_name: 'Lemon Chicken', recipe_id: 'r-real', category: 'dinner' },
        { date: '2026-08-04', meal_name: 'Taco Bowls', recipe_id: 'r-hallucinated', category: 'dinner' },
      ],
    }]));

    const res = await request(app()).post('/api/chat').send({ message: 'add them to my meal plan' });

    expect(res.status).toBe(200);
    expect(db.createMealPlanEntry).toHaveBeenCalledTimes(2);
    expect(db.createMealPlanEntry).toHaveBeenNthCalledWith(1, 'h1',
      { date: '2026-08-03', category: 'dinner', recipe_id: 'r-real', meal_name: 'Lemon Chicken' }, 'u1');
    // A recipe id that doesn't belong to the household degrades to name-only.
    expect(db.createMealPlanEntry).toHaveBeenNthCalledWith(2, 'h1',
      { date: '2026-08-04', category: 'dinner', recipe_id: null, meal_name: 'Taco Bowls' }, 'u1');
    expect(res.body.actions).toEqual([{
      type: 'add_meal_plan',
      meals: [
        { date: '2026-08-03', name: 'Lemon Chicken', category: 'dinner', id: 'mp-2026-08-03' },
        { date: '2026-08-04', name: 'Taco Bowls', category: 'dinner', id: 'mp-2026-08-04' },
      ],
    }]);
  });

  test('an unparseable date or missing name skips that meal, keeping the rest', async () => {
    callWithFailover.mockResolvedValue(fenceReply([{
      action: 'add_meal_plan',
      meals: [
        { date: 'Tuesday', meal_name: 'Fish' },
        { date: '2026-08-05', meal_name: '' },
        { date: '2026-08-05', meal_name: 'Stir-Fry', category: 'supper' },
      ],
    }]));

    const res = await request(app()).post('/api/chat').send({ message: 'plan meals' });

    expect(res.status).toBe(200);
    expect(db.createMealPlanEntry).toHaveBeenCalledTimes(1);
    // Unknown category falls back to dinner.
    expect(db.createMealPlanEntry).toHaveBeenCalledWith('h1',
      { date: '2026-08-05', category: 'dinner', recipe_id: null, meal_name: 'Stir-Fry' }, 'u1');
  });
});
