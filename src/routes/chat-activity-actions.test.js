/**
 * Route tests for the chat activity actions (skip_activity /
 * update_activity / delete_activity): the assistant manages weekly
 * extracurriculars by id from the prompt's ground-truth list. Skips hide
 * ONE date ("remove wraparound care for today only" - the exact request
 * that used to dead-end with "couldn't find an event"); update patches
 * the series; delete removes it; and everything is household-scoped.
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

// Logan (u2) is in household h1; the wraparound-care activity belongs to him.
const ACTIVITY = { id: 'act-1', child_id: 'u2', day_of_week: 0, activity: 'Wraparound Care', time_start: '15:30:00' };

beforeEach(() => {
  jest.clearAllMocks();
  db.getHouseholdMembers.mockResolvedValue([
    { id: 'u1', name: 'Grant' },
    { id: 'u2', name: 'Logan', member_type: 'dependent' },
  ]);
  db.getHouseholdNotes.mockResolvedValue([]);
  db.getShoppingList.mockResolvedValue([]);
  db.getAllIncompleteTasks.mockResolvedValue([]);
  db.getCalendarEvents.mockResolvedValue([]);
  db.getHouseholdById.mockResolvedValue({ id: 'h1', name: 'Test', timezone: 'Europe/London' });
  db.getHouseholdSchools.mockResolvedValue([]);
  db.getRecipes.mockResolvedValue([]);
  db.getHouseholdPreferences.mockResolvedValue([]);
  db.getHouseholdActivities.mockResolvedValue([{ ...ACTIVITY, skips: [] }]);
  db.getTermDatesBySchoolIds.mockResolvedValue([]);
  db.createConversation.mockResolvedValue({ id: 'c1' });
  db.getChatHistory.mockResolvedValue([]);
  db.saveChatMessage.mockResolvedValue({});
  db.touchConversation.mockResolvedValue({});
  db.getChildActivityById.mockResolvedValue(ACTIVITY);
  db.addActivitySkip.mockResolvedValue();
  db.removeActivitySkip.mockResolvedValue();
  db.updateChildActivity.mockResolvedValue(ACTIVITY);
  db.deleteChildActivity.mockResolvedValue();
});

describe('POST /api/chat activity actions', () => {
  test('skip_activity writes one (activity, date) skip', async () => {
    callWithFailover.mockResolvedValue(reply({ action: 'skip_activity', activity_id: 'act-1', date: '2026-07-06' }));

    const res = await request(app()).post('/api/chat').send({ message: 'Remove Logan wraparound care from calendar for today only' });
    expect(res.status).toBe(200);
    expect(db.addActivitySkip).toHaveBeenCalledWith('act-1', 'h1', '2026-07-06', 'u1');
    expect(db.deleteChildActivity).not.toHaveBeenCalled();
    expect(res.body.actions).toEqual([
      { type: 'activity_skipped', activity: 'Wraparound Care', date: '2026-07-06' },
    ]);
  });

  test('skip_activity with unskip restores the date', async () => {
    callWithFailover.mockResolvedValue(reply({ action: 'skip_activity', activity_id: 'act-1', date: '2026-07-06', unskip: true }));

    const res = await request(app()).post('/api/chat').send({ message: 'wraparound care is back on today' });
    expect(res.status).toBe(200);
    expect(db.removeActivitySkip).toHaveBeenCalledWith('act-1', '2026-07-06');
    expect(res.body.actions).toEqual([
      { type: 'activity_unskipped', activity: 'Wraparound Care', date: '2026-07-06' },
    ]);
  });

  test('skip_activity without a parseable date warns instead of writing', async () => {
    callWithFailover.mockResolvedValue(reply({ action: 'skip_activity', activity_id: 'act-1', date: 'today' }));

    const res = await request(app()).post('/api/chat').send({ message: 'skip wraparound care' });
    expect(res.status).toBe(200);
    expect(db.addActivitySkip).not.toHaveBeenCalled();
    expect(res.body.message).toMatch(/couldn't work out which date/i);
  });

  test('override_activity writes a one-off change, keeping the session length when only the start moves', async () => {
    // Series is 15:30-16:30 (below); "piano at 4pm today" moves the start
    // to 16:00 and the end must follow to 17:00, not stay pinned.
    db.getChildActivityById.mockResolvedValue({ ...ACTIVITY, time_start: '15:30:00', time_end: '16:30:00', pickup_member_id: 'u1' });
    callWithFailover.mockResolvedValue(reply({
      action: 'override_activity', activity_id: 'act-1', date: '2026-07-06',
      time_start: '16:00', time_end: null, pickup_name: null,
    }));

    const res = await request(app()).post('/api/chat').send({ message: 'wraparound care is at 4pm today' });
    expect(res.status).toBe(200);
    expect(db.addActivitySkip).toHaveBeenCalledWith('act-1', 'h1', '2026-07-06', 'u1', {
      time_start: '16:00',
      time_end: '17:00', // 60-minute series duration preserved
      pickup_member_id: 'u1', // series pickup carried over, not cleared
    });
    expect(res.body.actions).toEqual([
      { type: 'activity_overridden', activity: 'Wraparound Care', date: '2026-07-06' },
    ]);
  });

  test('override_activity pickup-only change keeps the series times', async () => {
    db.getChildActivityById.mockResolvedValue({ ...ACTIVITY, time_start: '15:30:00', time_end: '16:30:00', pickup_member_id: null });
    callWithFailover.mockResolvedValue(reply({
      action: 'override_activity', activity_id: 'act-1', date: '2026-07-06',
      time_start: null, time_end: null, pickup_name: 'Grant',
    }));

    const res = await request(app()).post('/api/chat').send({ message: 'Grant collects from wraparound care today' });
    expect(res.status).toBe(200);
    expect(db.addActivitySkip).toHaveBeenCalledWith('act-1', 'h1', '2026-07-06', 'u1', {
      time_start: '15:30',
      time_end: '16:30',
      pickup_member_id: 'u1',
    });
  });

  test('update_activity patches only the provided fields and resolves pickup by name', async () => {
    callWithFailover.mockResolvedValue(reply({
      action: 'update_activity', activity_id: 'act-1', time_start: '16:00', time_end: null,
      day_of_week: null, activity: null, pickup_name: 'Grant', show_on_calendar: null,
    }));

    const res = await request(app()).post('/api/chat').send({ message: 'wraparound care now starts at 4pm, Grant picks up' });
    expect(res.status).toBe(200);
    expect(db.updateChildActivity).toHaveBeenCalledWith('act-1', { time_start: '16:00', pickup_member_id: 'u1' });
    expect(res.body.actions).toEqual([{ type: 'activity_updated', activity: 'Wraparound Care' }]);
  });

  test('delete_activity removes the series', async () => {
    callWithFailover.mockResolvedValue(reply({ action: 'delete_activity', activity_id: 'act-1' }));

    const res = await request(app()).post('/api/chat').send({ message: 'Logan quit wraparound care, remove it' });
    expect(res.status).toBe(200);
    expect(db.deleteChildActivity).toHaveBeenCalledWith('act-1');
    expect(res.body.actions).toEqual([{ type: 'activity_deleted', activity: 'Wraparound Care' }]);
  });

  test('an activity from another household is refused', async () => {
    // getChildActivityById resolves, but the child is not in h1's roster.
    db.getChildActivityById.mockResolvedValue({ ...ACTIVITY, child_id: 'intruder' });
    callWithFailover.mockResolvedValue(reply({ action: 'delete_activity', activity_id: 'act-1' }));

    const res = await request(app()).post('/api/chat').send({ message: 'delete wraparound care' });
    expect(res.status).toBe(200);
    expect(db.deleteChildActivity).not.toHaveBeenCalled();
    expect(db.addActivitySkip).not.toHaveBeenCalled();
    expect(res.body.message).toMatch(/couldn't find that activity/i);
  });

  test('assistant history is saved RAW (action block included) so replay does not teach block-less confirmations', async () => {
    // Real failure 2026-07-06: cleanContent (blocks stripped) was persisted
    // and replayed as history, so in long conversations the model mimicked
    // its own stripped confirmations and stopped emitting blocks - every
    // first attempt tripped the truth guard until the user said try again.
    const raw = `Done!\n\n\`\`\`json\n${JSON.stringify({ action: 'delete_activity', activity_id: 'act-1' })}\n\`\`\``;
    callWithFailover.mockResolvedValue({ text: raw, provider: 'claude' });

    const res = await request(app()).post('/api/chat').send({ message: 'remove wraparound care' });
    expect(res.status).toBe(200);
    const assistantSave = db.saveChatMessage.mock.calls.find((c) => c[2] === 'assistant');
    expect(assistantSave[3]).toContain('"action":"delete_activity"'); // block persisted
    // The response the user sees is still stripped.
    expect(res.body.message).not.toContain('delete_activity');
  });

  test('truth-guard appendix is persisted to history alongside the raw reply', async () => {
    // Prose claims an action but no block: the guard bounces it, and the
    // correction must survive into history so the model sees its failure.
    callWithFailover.mockResolvedValue({ text: "I've added **Babysitter** for tomorrow.", provider: 'claude' });

    const res = await request(app()).post('/api/chat').send({ message: 'babysitter tomorrow 17:30' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/wasn't able to save/i);
    const assistantSave = db.saveChatMessage.mock.calls.find((c) => c[2] === 'assistant');
    expect(assistantSave[3]).toMatch(/wasn't able to save/i);
  });

  test('GET /history strips action blocks from assistant messages for display', async () => {
    db.getChatHistory.mockResolvedValue([
      { role: 'user', content: 'add it' },
      { role: 'assistant', content: 'Done!\n\n```json\n{"action": "create_task", "title": "X"}\n```' },
    ]);
    const res = await request(app()).get('/api/chat/history?conversation_id=c1');
    expect(res.status).toBe(200);
    expect(res.body.messages[0].content).toBe('add it');
    expect(res.body.messages[1].content).toBe('Done!');
    expect(JSON.stringify(res.body.messages)).not.toContain('create_task');
  });

  test('the prompt ground truth lists activities with ids and skips', async () => {
    db.getHouseholdActivities.mockResolvedValue([
      { ...ACTIVITY, skips: ['2099-01-04'], pickup_member_id: 'u1' },
    ]);
    callWithFailover.mockResolvedValue({ text: 'Hello!', provider: 'claude' });

    await request(app()).post('/api/chat').send({ message: 'hi' });
    const sys = callWithFailover.mock.calls[0][0].system;
    expect(sys).toContain('Weekly Extracurricular Activities');
    expect(sys).toContain('Logan - Wraparound Care: Mondays 15:30');
    expect(sys).toContain('pickup: Grant');
    expect(sys).toContain('skipped: 2099-01-04');
    expect(sys).toContain('(id: act-1)');
    expect(sys).toContain('skip_activity');
  });
});
