/**
 * Route tests for the chat update_event action. Before this action
 * existed the model improvised delete_event for "change the time to X"
 * (real 2026-08-12 transcript) - the user watched their event vanish
 * instead of move. Covers: BST wall-clock conversion, duration kept when
 * only a start is given, date-only moves keeping the time, synced events
 * staying read-only, and ambiguity prompting instead of guessing.
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

// Stored 18:45 UTC = the buggy 7:45pm BST blood test.
const bloodTest = (over = {}) => ({
  id: 'e1',
  title: 'Blood Test (Phlebotomy)',
  start_time: '2026-08-14T18:45:00Z',
  end_time: '2026-08-14T19:45:00Z',
  all_day: false,
  external_feed_id: null,
  recurrence: null,
  location: null,
  assigned_to_names: [],
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  db.getHouseholdMembers.mockResolvedValue([{ id: 'u1', name: 'Maxine' }]);
  db.getHouseholdNotes.mockResolvedValue([]);
  db.getShoppingList.mockResolvedValue([]);
  db.getAllIncompleteTasks.mockResolvedValue([]);
  db.getCalendarEvents.mockResolvedValue([]);
  db.getHouseholdById.mockResolvedValue({ id: 'h1', name: 'Parry House', timezone: 'Europe/London' });
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
  db.updateCalendarEvent.mockImplementation(async (id, hh, patch) => ({ id, ...patch }));
  db.saveEventAssignees.mockResolvedValue([]);
  db.resolveAssignees.mockImplementation((names, members) => {
    const hit = (members || []).filter((m) => (names || []).some((n) => n.toLowerCase() === m.name.toLowerCase()));
    return { ids: hit.map((m) => m.id), names: hit.map((m) => m.name) };
  });
});

describe('POST /api/chat update_event action', () => {
  test('new start time converts from BST wall-clock and keeps the event length', async () => {
    callWithFailover.mockResolvedValue(reply({
      action: 'update_event', title: 'Blood Test', new_start_time: '18:45',
    }));
    db.findEventsByFuzzyTitle.mockResolvedValue([bloodTest()]);

    const res = await request(app()).post('/api/chat').send({ message: 'the blood test should be 6:45pm not 7:45pm' });
    expect(res.status).toBe(200);
    expect(db.updateCalendarEvent).toHaveBeenCalledTimes(1);
    const [id, hh, patch] = db.updateCalendarEvent.mock.calls[0];
    expect(id).toBe('e1');
    expect(hh).toBe('h1');
    // 6:45pm London (BST, UTC+1) = 17:45 UTC; 1h duration preserved.
    expect(patch.start_time).toBe('2026-08-14T17:45:00Z');
    expect(patch.end_time).toBe('2026-08-14T18:45:00Z');
    const updated = res.body.actions.find((a) => a.type === 'event_updated');
    expect(updated.event.start_time).toBe('2026-08-14T17:45:00Z');
  });

  test('date-only move keeps the wall-clock time', async () => {
    callWithFailover.mockResolvedValue(reply({
      action: 'update_event', title: 'Blood Test', new_date: '2026-08-21',
    }));
    db.findEventsByFuzzyTitle.mockResolvedValue([bloodTest()]);

    await request(app()).post('/api/chat').send({ message: 'move the blood test to next Friday' });
    const patch = db.updateCalendarEvent.mock.calls[0][2];
    // Stored 18:45 UTC reads as 19:45 BST; the move keeps 19:45 local.
    expect(patch.start_time).toBe('2026-08-21T18:45:00Z');
    expect(patch.end_time).toBe('2026-08-21T19:45:00Z');
  });

  test('synced events are read-only and explained, not touched', async () => {
    callWithFailover.mockResolvedValue(reply({
      action: 'update_event', title: 'Blood Test', new_start_time: '10:00',
    }));
    db.findEventsByFuzzyTitle.mockResolvedValue([bloodTest({ external_feed_id: 'feed-1' })]);

    const res = await request(app()).post('/api/chat').send({ message: 'change the blood test to 10am' });
    expect(db.updateCalendarEvent).not.toHaveBeenCalled();
    expect(res.body.message).toContain('syncs from another calendar');
  });

  test('multiple matches prompt for disambiguation instead of guessing', async () => {
    callWithFailover.mockResolvedValue(reply({
      action: 'update_event', title: 'Swimming', new_start_time: '16:00',
    }));
    db.findEventsByFuzzyTitle.mockResolvedValue([
      bloodTest({ id: 'e1', title: 'Swimming Jack' }),
      bloodTest({ id: 'e2', title: 'Swimming Finley' }),
    ]);

    const res = await request(app()).post('/api/chat').send({ message: 'change swimming to 4pm' });
    expect(db.updateCalendarEvent).not.toHaveBeenCalled();
    expect(res.body.message).toContain('which date you mean');
  });

  test('no match reports honestly', async () => {
    callWithFailover.mockResolvedValue(reply({
      action: 'update_event', title: 'Karate', new_start_time: '16:00',
    }));
    db.findEventsByFuzzyTitle.mockResolvedValue([]);

    const res = await request(app()).post('/api/chat').send({ message: 'change karate to 4pm' });
    expect(db.updateCalendarEvent).not.toHaveBeenCalled();
    expect(res.body.message).toContain("couldn't find");
  });

  test('reassignment resolves names and rewrites the assignee rows', async () => {
    callWithFailover.mockResolvedValue(reply({
      action: 'update_event', title: 'Blood Test', assigned_to_names: ['Maxine'],
    }));
    db.findEventsByFuzzyTitle.mockResolvedValue([bloodTest()]);

    await request(app()).post('/api/chat').send({ message: 'the blood test is for me, not the kids' });
    const patch = db.updateCalendarEvent.mock.calls[0][2];
    expect(patch.assigned_to_names).toEqual(['Maxine']);
    expect(patch.assigned_to_ids).toEqual(['u1']);
    expect(db.saveEventAssignees).toHaveBeenCalledWith('e1', 'h1', ['Maxine'], expect.anything());
  });

  test('an empty update asks what to change instead of claiming success', async () => {
    callWithFailover.mockResolvedValue(reply({
      action: 'update_event', title: 'Blood Test',
    }));
    db.findEventsByFuzzyTitle.mockResolvedValue([bloodTest()]);

    const res = await request(app()).post('/api/chat').send({ message: 'update the blood test' });
    expect(db.updateCalendarEvent).not.toHaveBeenCalled();
    expect(res.body.message).toContain('what to change');
  });
});
