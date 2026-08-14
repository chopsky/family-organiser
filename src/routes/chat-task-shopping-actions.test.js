/**
 * Route tests for the chat task-management, shopping-management, and
 * bulk/recurrence event actions - the top capability gaps from the
 * "AI said no" transcript mining (2026-08-13): households repeatedly
 * asked chat to delete/move tasks and clear shopping items and were
 * refused because the actions didn't exist.
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
  getCityFromTimezone: jest.fn().mockReturnValue(null),
  extractLocationFromMessage: jest.fn().mockReturnValue(null),
  geocodeLocation: jest.fn().mockResolvedValue(null),
  reverseGeocode: jest.fn().mockResolvedValue(null),
}));
jest.mock('../services/transcribe', () => ({ transcribeVoice: jest.fn() }));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');
const { callWithFailover } = require('../services/ai-client');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/chat', require('./chat'));
  return a;
}

const reply = (action) => ({
  text: `Done!\n\n\`\`\`json\n${JSON.stringify(action)}\n\`\`\``,
  provider: 'claude',
});

beforeEach(() => {
  jest.clearAllMocks();
  db.getHouseholdMembers.mockResolvedValue([{ id: 'u1', name: 'Grant' }, { id: 'u2', name: 'Lynn' }]);
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
  db.resolveAssignees.mockImplementation((names, members) => {
    const hit = (members || []).filter((m) => (names || []).some((n) => n.toLowerCase() === m.name.toLowerCase()));
    return { ids: hit.map((m) => m.id), names: hit.map((m) => m.name) };
  });
  db.completeTask.mockResolvedValue({});
  db.deleteTask.mockResolvedValue({});
  db.updateTask.mockImplementation(async (id, hh, patch) => ({ id, ...patch }));
  db.completeShoppingItemById.mockResolvedValue({});
  db.deleteShoppingItem.mockResolvedValue({});
  db.clearShoppingItems.mockResolvedValue({ removed: 4 });
  db.updateCalendarEvent.mockImplementation(async (id, hh, patch) => ({ id, ...patch }));
  db.saveEventAssignees.mockResolvedValue([]);
});

const task = (over = {}) => ({ id: 't1', title: 'Pack kit bag', due_date: '2026-08-14', ...over });

describe('chat task management actions', () => {
  test('delete_task removes the single match (the 13-stuck-to-dos case)', async () => {
    callWithFailover.mockResolvedValue(reply({ action: 'delete_task', title: 'Pack kit bag' }));
    db.findTasksByFuzzyTitle.mockResolvedValue([task()]);
    const res = await request(app()).post('/api/chat').send({ message: 'delete the pack kit bag task' });
    expect(db.deleteTask).toHaveBeenCalledWith('t1', 'h1');
    expect(res.body.actions.find((a) => a.type === 'tasks_deleted')).toEqual({ type: 'tasks_deleted', count: 1, titles: ['Pack kit bag'] });
  });

  test('delete_task all_matching removes every match', async () => {
    callWithFailover.mockResolvedValue(reply({ action: 'delete_task', title: 'kitchen', all_matching: true }));
    db.findTasksByFuzzyTitle.mockResolvedValue([task({ id: 't1' }), task({ id: 't2' }), task({ id: 't3' })]);
    await request(app()).post('/api/chat').send({ message: 'delete all the kitchen tasks' });
    expect(db.deleteTask).toHaveBeenCalledTimes(3);
  });

  test('complete_task ticks off the match', async () => {
    callWithFailover.mockResolvedValue(reply({ action: 'complete_task', title: 'Pack kit bag' }));
    db.findTasksByFuzzyTitle.mockResolvedValue([task()]);
    const res = await request(app()).post('/api/chat').send({ message: 'the kit bag is packed' });
    expect(db.completeTask).toHaveBeenCalledWith('t1');
    expect(res.body.actions.find((a) => a.type === 'tasks_completed')).toBeTruthy();
  });

  test('update_task all_matching moves every match to the new date', async () => {
    callWithFailover.mockResolvedValue(reply({ action: 'update_task', title: 'kitchen', all_matching: true, new_due_date: '2026-08-15' }));
    db.findTasksByFuzzyTitle.mockResolvedValue([task({ id: 't1' }), task({ id: 't2' })]);
    const res = await request(app()).post('/api/chat').send({ message: 'move all kitchen tasks to Saturday' });
    expect(db.updateTask).toHaveBeenCalledTimes(2);
    expect(db.updateTask.mock.calls[0][2]).toEqual({ due_date: '2026-08-15' });
    expect(res.body.actions.find((a) => a.type === 'tasks_updated').count).toBe(2);
  });

  test('multiple matches without all_matching ask instead of guessing', async () => {
    callWithFailover.mockResolvedValue(reply({ action: 'delete_task', title: 'call' }));
    db.findTasksByFuzzyTitle.mockResolvedValue([task({ id: 't1', title: 'Call JAECOO' }), task({ id: 't2', title: 'Call Ecovacs' })]);
    const res = await request(app()).post('/api/chat').send({ message: 'delete the call task' });
    expect(db.deleteTask).not.toHaveBeenCalled();
    expect(res.body.message).toContain('all of them');
  });
});

describe('chat shopping management actions', () => {
  const item = (over = {}) => ({ id: 's1', item: 'milk', quantity: null, ...over });

  test('complete_shopping_item ticks off the match', async () => {
    callWithFailover.mockResolvedValue(reply({ action: 'complete_shopping_item', item: 'milk' }));
    db.findShoppingItemsByFuzzyName.mockResolvedValue([item()]);
    const res = await request(app()).post('/api/chat').send({ message: 'we got the milk' });
    expect(db.completeShoppingItemById).toHaveBeenCalledWith('s1');
    expect(res.body.actions.find((a) => a.type === 'shopping_completed')).toBeTruthy();
  });

  test('delete_shopping_item removes the match', async () => {
    callWithFailover.mockResolvedValue(reply({ action: 'delete_shopping_item', item: 'crisps' }));
    db.findShoppingItemsByFuzzyName.mockResolvedValue([item({ id: 's2', item: 'crisps' })]);
    await request(app()).post('/api/chat').send({ message: 'take crisps off the list' });
    expect(db.deleteShoppingItem).toHaveBeenCalledWith('s2', 'h1');
  });

  test('clear_shopping defaults to completed-only', async () => {
    callWithFailover.mockResolvedValue(reply({ action: 'clear_shopping' }));
    const res = await request(app()).post('/api/chat').send({ message: 'clear off what we bought' });
    expect(db.clearShoppingItems).toHaveBeenCalledWith('h1', { mode: 'completed' });
    expect(res.body.actions.find((a) => a.type === 'shopping_cleared').count).toBe(4);
  });

  test('clear_shopping mode all wipes the list', async () => {
    callWithFailover.mockResolvedValue(reply({ action: 'clear_shopping', mode: 'all' }));
    await request(app()).post('/api/chat').send({ message: 'clear the whole list' });
    expect(db.clearShoppingItems).toHaveBeenCalledWith('h1', { mode: 'all' });
  });
});

describe('chat event recurrence + bulk updates', () => {
  const bday = (over = {}) => ({
    id: 'e1', title: "Jack's Birthday", start_time: '2026-09-20T10:00:00Z', end_time: '2026-09-20T12:00:00Z',
    all_day: false, external_feed_id: null, recurrence: null, location: null, assigned_to_names: [], ...over,
  });

  test('update_event all_matching sets recurrence on every match', async () => {
    callWithFailover.mockResolvedValue(reply({ action: 'update_event', title: 'Birthday', all_matching: true, new_recurrence: 'yearly' }));
    db.findEventsByFuzzyTitle.mockResolvedValue([bday({ id: 'e1' }), bday({ id: 'e2', title: "Lynn's Birthday" })]);
    const res = await request(app()).post('/api/chat').send({ message: 'make all the birthdays repeat yearly' });
    expect(db.updateCalendarEvent).toHaveBeenCalledTimes(2);
    expect(db.updateCalendarEvent.mock.calls[0][2]).toEqual({ recurrence: 'yearly' });
    expect(res.body.actions.find((a) => a.type === 'events_updated').count).toBe(2);
  });

  test('explicit null recurrence stops an event repeating', async () => {
    callWithFailover.mockResolvedValue(reply({ action: 'update_event', title: "Jack's Birthday", new_recurrence: null }));
    db.findEventsByFuzzyTitle.mockResolvedValue([bday({ recurrence: 'yearly' })]);
    await request(app()).post('/api/chat').send({ message: 'stop jacks birthday repeating' });
    expect(db.updateCalendarEvent.mock.calls[0][2]).toEqual({ recurrence: null });
  });
});
