/**
 * Route tests for the chat delete_event action: the assistant can now
 * remove calendar events it (or anyone) created. Fuzzy title match,
 * synced events skipped, ambiguity prompts instead of deleting, and
 * keep_recurring cleans up duplicate one-offs without killing the series.
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

// Assistant reply carrying a delete_event action block.
const reply = (action) => ({
  text: `Done!\n\n\`\`\`json\n${JSON.stringify(action)}\n\`\`\``,
  provider: 'claude',
});

const swim = (over = {}) => ({
  id: over.id || 'e1',
  title: 'Logan swimming lesson',
  start_time: '2026-07-05T08:00:00Z',
  external_feed_id: null,
  recurrence: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  // buildSystemPrompt fans out over the household context reads.
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
  db.createConversation.mockResolvedValue({ id: 'c1' });
  db.getChatHistory.mockResolvedValue([]);
  db.saveChatMessage.mockResolvedValue({});
  db.touchConversation.mockResolvedValue({});
  db.softDeleteCalendarEvent.mockResolvedValue({});
});

describe('POST /api/chat delete_event action', () => {
  test('deletes a single unambiguous match', async () => {
    callWithFailover.mockResolvedValue(reply({ action: 'delete_event', title: 'Logan swimming' }));
    db.findEventsByFuzzyTitle.mockResolvedValue([swim()]);

    const res = await request(app()).post('/api/chat').send({ message: 'delete logan swimming' });
    expect(res.status).toBe(200);
    expect(db.softDeleteCalendarEvent).toHaveBeenCalledWith('e1', 'h1');
    expect(res.body.actions).toEqual([
      { type: 'events_deleted', count: 1, titles: ['Logan swimming lesson'] },
    ]);
  });

  test('all_matching deletes every copy; keep_recurring spares the series', async () => {
    callWithFailover.mockResolvedValue(reply({
      action: 'delete_event', title: 'Logan swimming', all_matching: true, keep_recurring: true,
    }));
    db.findEventsByFuzzyTitle.mockResolvedValue([
      swim({ id: 'dup1' }),
      swim({ id: 'dup2', start_time: '2026-07-12T08:00:00Z' }),
      swim({ id: 'series', recurrence: 'weekly' }),
    ]);

    const res = await request(app()).post('/api/chat').send({ message: 'remove the duplicate swims' });
    expect(res.status).toBe(200);
    const deletedIds = db.softDeleteCalendarEvent.mock.calls.map((c) => c[0]);
    expect(deletedIds.sort()).toEqual(['dup1', 'dup2']);
    expect(res.body.actions[0].count).toBe(2);
  });

  test('multiple matches without all_matching asks instead of deleting', async () => {
    callWithFailover.mockResolvedValue(reply({ action: 'delete_event', title: 'swimming' }));
    db.findEventsByFuzzyTitle.mockResolvedValue([swim({ id: 'a' }), swim({ id: 'b' })]);

    const res = await request(app()).post('/api/chat').send({ message: 'delete swimming' });
    expect(res.status).toBe(200);
    expect(db.softDeleteCalendarEvent).not.toHaveBeenCalled();
    expect(res.body.message).toMatch(/found 2 events matching/i);
  });

  test('synced (external feed) events are never deleted', async () => {
    callWithFailover.mockResolvedValue(reply({ action: 'delete_event', title: 'Mason tennis', all_matching: true }));
    db.findEventsByFuzzyTitle.mockResolvedValue([
      swim({ id: 'ext', title: 'Mason tennis', external_feed_id: 'feed1' }),
    ]);

    const res = await request(app()).post('/api/chat').send({ message: 'delete mason tennis' });
    expect(res.status).toBe(200);
    expect(db.softDeleteCalendarEvent).not.toHaveBeenCalled();
    expect(res.body.message).toMatch(/couldn't find/i);
  });
});
