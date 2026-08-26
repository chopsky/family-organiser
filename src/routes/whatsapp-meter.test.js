/**
 * applyAssistantMeter: the WhatsApp webhook's charge + decoration step.
 * Deal announced once, counter lines by count, chain intents uncharged,
 * failures send the reply undecorated.
 */
jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../services/whatsapp', () => ({ sendMessage: jest.fn(), sendTypingIndicator: jest.fn() }));
jest.mock('../services/broadcast', () => ({ toHousehold: jest.fn() }));
jest.mock('../bot/handlers', () => ({ hasOpenQuestion: jest.fn(() => false) }));
jest.mock('../services/cache', () => ({ invalidate: jest.fn(), get: jest.fn(), set: jest.fn() }));
jest.mock('../services/document-extract', () => ({ isSupportedDocument: jest.fn(() => false) }));
jest.mock('../services/assistant-meter', () => {
  const real = jest.requireActual('../services/assistant-meter');
  return { ...real, chargeIfNewBurst: jest.fn() };
});

const db = require('../db/queries');
const assistantMeter = require('../services/assistant-meter');
const { applyAssistantMeter } = require('./whatsapp');

const USER = { id: 'u1' };
const lapsed = (over = {}) => ({
  id: 'h1', subscription_status: 'expired', timezone: 'Europe/London',
  free_deal_announced_at: '2026-08-01T00:00:00Z', ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.FREE_APP_MODE = '1';
  db.markFreeDealAnnounced.mockResolvedValue();
  db.markMeterLimitNotice.mockResolvedValue();
});
afterEach(() => { delete process.env.FREE_APP_MODE; });

test('an unmetered household gets its reply untouched, uncharged', async () => {
  const out = await applyAssistantMeter(lapsed({ subscription_status: 'trialing' }), USER, { intent: 'create_event' }, 'Done.', 'whatsapp');
  expect(out).toBe('Done.');
  expect(assistantMeter.chargeIfNewBurst).not.toHaveBeenCalled();
});

test('a charged action mid-tank (2-6) carries no counter line', async () => {
  assistantMeter.chargeIfNewBurst.mockResolvedValue({ charged: true, used: 3, limit: 10, resetLabel: '1 September' });
  const out = await applyAssistantMeter(lapsed(), USER, { intent: 'create_event' }, 'Done.', 'whatsapp');
  expect(out).toBe('Done.');
});

test('action 8 appends the countdown line', async () => {
  assistantMeter.chargeIfNewBurst.mockResolvedValue({ charged: true, used: 8, limit: 10, resetLabel: '1 September' });
  const out = await applyAssistantMeter(lapsed(), USER, { intent: 'create_event' }, 'Done.', 'whatsapp');
  expect(out).toMatch(/8 of 10 free actions/);
});

test('action 10 appends the limit announcement and stamps the notice', async () => {
  assistantMeter.chargeIfNewBurst.mockResolvedValue({ charged: true, used: 10, limit: 10, resetLabel: '1 September' });
  const out = await applyAssistantMeter(lapsed(), USER, { intent: 'create_event' }, 'Done.', 'whatsapp');
  expect(out).toMatch(/last of your 10 free assistant actions/);
  expect(out).toMatch(/1 September/);
  expect(db.markMeterLimitNotice).toHaveBeenCalledWith('h1');
});

test('the first post-lapse reply carries the deal announcement, once, without a stacked counter', async () => {
  assistantMeter.chargeIfNewBurst.mockResolvedValue({ charged: true, used: 1, limit: 10, resetLabel: '1 September' });
  const hh = lapsed({ free_deal_announced_at: null });
  const first = await applyAssistantMeter(hh, USER, { intent: 'create_event' }, 'Done.', 'whatsapp');
  expect(first).toMatch(/your free trial has ended/i);
  expect(first).toMatch(/10 free assistant actions a month/);
  expect(first).not.toMatch(/1 of 10/); // the announcement already says "this was one"
  expect(db.markFreeDealAnnounced).toHaveBeenCalledWith('h1');
  // Second reply: already announced (the helper stamped the row in hand).
  assistantMeter.chargeIfNewBurst.mockResolvedValue({ charged: false, used: 1, limit: 10, resetLabel: '1 September' });
  const second = await applyAssistantMeter(hh, USER, { intent: 'chat' }, 'Sure.', 'whatsapp');
  expect(second).toBe('Sure.');
});

test('chain intents pass isChainReply so they can never start a new action', async () => {
  assistantMeter.chargeIfNewBurst.mockResolvedValue({ charged: false, used: 5, limit: 10, resetLabel: '1 September' });
  await applyAssistantMeter(lapsed(), USER, { intent: 'reminder_followup' }, 'Done.', 'whatsapp');
  expect(assistantMeter.chargeIfNewBurst).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ isChainReply: true }));
});

test('zero-cost intents (greetings, brief toggles) never touch the meter', async () => {
  for (const intent of ['trivial', 'brief_optin', 'brief_optout', 'meter_query']) {
    const out = await applyAssistantMeter(lapsed(), USER, { intent }, 'Hi!', 'whatsapp');
    expect(out).toBe('Hi!');
  }
  expect(assistantMeter.chargeIfNewBurst).not.toHaveBeenCalled();
});

test('a meter explosion sends the reply undecorated - never costs the family their answer', async () => {
  assistantMeter.chargeIfNewBurst.mockRejectedValue(new Error('db down'));
  const out = await applyAssistantMeter(lapsed(), USER, { intent: 'create_event' }, 'Done.', 'whatsapp');
  expect(out).toBe('Done.');
});
