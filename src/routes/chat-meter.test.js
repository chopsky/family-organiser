/**
 * The assistant meter on the app-chat route: quota questions answered
 * without a model, the over-limit gate fires BEFORE the model call, and
 * successful turns are charged + decorated on the response only.
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
jest.mock('../services/assistant-meter', () => {
  const real = jest.requireActual('../services/assistant-meter');
  return { ...real, meterStatus: jest.fn(), chargeIfNewBurst: jest.fn() };
});

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');
const { callWithFailover } = require('../services/ai-client');
const assistantMeter = require('../services/assistant-meter');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/chat', require('./chat'));
  return a;
}

const LAPSED = {
  id: 'h1', name: 'Test', timezone: 'Europe/London',
  subscription_status: 'expired', free_deal_announced_at: '2026-08-01T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.FREE_APP_MODE = '1';
  db.getHouseholdMembers.mockResolvedValue([{ id: 'u1', name: 'Grant' }]);
  db.getHouseholdNotes.mockResolvedValue([]);
  db.getShoppingList.mockResolvedValue([]);
  db.getAllIncompleteTasks.mockResolvedValue([]);
  db.getCalendarEvents.mockResolvedValue([]);
  db.getHouseholdById.mockResolvedValue(LAPSED);
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
  db.markMeterLimitNotice.mockResolvedValue();
  db.markFreeDealAnnounced.mockResolvedValue();
});
afterEach(() => { delete process.env.FREE_APP_MODE; });

test('a quota question is answered exactly, free, without any model call', async () => {
  assistantMeter.meterStatus.mockResolvedValue({ metered: true, used: 7, limit: 10, resetLabel: '1 September' });
  const res = await request(app()).post('/api/chat').send({ message: 'How many actions do I have left?' });
  expect(res.body.message).toMatch(/7 of your 10.*3 left.*1 September/);
  expect(callWithFailover).not.toHaveBeenCalled();
  expect(assistantMeter.chargeIfNewBurst).not.toHaveBeenCalled();
});

test('over the limit outside a burst: the gate answers BEFORE the model runs', async () => {
  assistantMeter.meterStatus.mockResolvedValue({
    metered: true, used: 10, limit: 10, exhausted: true, burstOpen: false, resetLabel: '1 September',
  });
  const res = await request(app()).post('/api/chat').send({ message: 'add milk' });
  expect(res.body.message).toMatch(/10 of your free AI uses/);
  expect(res.body.message).toMatch(/1 September/);
  expect(callWithFailover).not.toHaveBeenCalled();
});

test('over the limit but INSIDE an open burst still answers - they are mid-action', async () => {
  assistantMeter.meterStatus.mockResolvedValue({
    metered: true, used: 10, limit: 10, exhausted: true, burstOpen: true, resetLabel: '1 September',
  });
  assistantMeter.chargeIfNewBurst.mockResolvedValue({ charged: false, used: 10, limit: 10, resetLabel: '1 September' });
  callWithFailover.mockResolvedValue({ text: 'And eggs, done.', provider: 'claude' });
  const res = await request(app()).post('/api/chat').send({ message: 'and eggs' });
  expect(res.body.message).toMatch(/eggs, done/);
});

test('a successful turn is charged; the counter decorates the response but not saved history', async () => {
  assistantMeter.meterStatus.mockResolvedValue({ metered: true, used: 7, limit: 10, exhausted: false, burstOpen: false, resetLabel: '1 September' });
  assistantMeter.chargeIfNewBurst.mockResolvedValue({ charged: true, used: 8, limit: 10, resetLabel: '1 September' });
  callWithFailover.mockResolvedValue({ text: 'Milk added.', provider: 'claude' });
  const res = await request(app()).post('/api/chat').send({ message: 'add milk' });
  expect(res.body.message).toMatch(/Milk added/);
  expect(res.body.message).toMatch(/8 of 10 free AI uses/);
  const assistantSave = db.saveChatMessage.mock.calls.find((c) => c[2] === 'assistant');
  expect(assistantSave[3]).not.toMatch(/8 of 10/); // history stays clean for model replay
});

test('an unmetered (trialing) household chats without meter involvement', async () => {
  db.getHouseholdById.mockResolvedValue({ ...LAPSED, subscription_status: 'trialing' });
  callWithFailover.mockResolvedValue({ text: 'Hello!', provider: 'claude' });
  const res = await request(app()).post('/api/chat').send({ message: 'hi there what can you do' });
  expect(res.body.message).toBe('Hello!');
  expect(assistantMeter.chargeIfNewBurst).not.toHaveBeenCalled();
});
