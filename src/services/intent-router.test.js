/**
 * intent-router unit tests: flag gating and failure semantics. The routing
 * QUALITY (which phrasings fast-path vs fall through) is model behaviour and
 * lives in tests/bot-eval/router-cases.js (live calls), not here.
 */

jest.mock('./ai-client', () => ({
  callClaude: jest.fn(),
  CLAUDE_HAIKU_MODEL: 'claude-haiku-4-5-20251001',
}));
jest.mock('../db/client', () => ({ supabaseAdmin: { from: jest.fn() } }));

const { callClaude } = require('./ai-client');
const { supabaseAdmin } = require('../db/client');
const { routeReadIntent, ROUTER_SCHEMA } = require('./intent-router');

function mockUsageInsert() {
  const chain = { insert: jest.fn(() => ({ then: (r) => { r(); return { catch: () => {} }; } })) };
  supabaseAdmin.from.mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.BOT_ROUTER;
  mockUsageInsert();
});

test('flag off: returns null without any AI call', async () => {
  expect(await routeReadIntent("what's on my to do list?")).toBeNull();
  expect(callClaude).not.toHaveBeenCalled();
});

test('flag on: routes a read and passes Haiku + 3s cap + strict schema', async () => {
  process.env.BOT_ROUTER = '1';
  callClaude.mockResolvedValue({ text: JSON.stringify({ route: 'query_tasks' }) });
  const routed = await routeReadIntent("what's on my to do list?", { timezone: 'Europe/London' });
  expect(routed).toEqual({ route: 'query_tasks' });
  const call = callClaude.mock.calls[0][0];
  expect(call.model).toBe('claude-haiku-4-5-20251001');
  expect(call.timeoutMs).toBe(3000);
  expect(call.responseSchema).toBe(ROUTER_SCHEMA);
});

test('"other" falls through as null', async () => {
  process.env.BOT_ROUTER = '1';
  callClaude.mockResolvedValue({ text: JSON.stringify({ route: 'other' }) });
  expect(await routeReadIntent('add milk and show the list')).toBeNull();
});

test('calendar route carries extracted dates through', async () => {
  process.env.BOT_ROUTER = '1';
  callClaude.mockResolvedValue({ text: JSON.stringify({ route: 'query_calendar', query_start: '2026-07-13', query_end: '2026-07-19' }) });
  const routed = await routeReadIntent("what's on next week?");
  expect(routed.route).toBe('query_calendar');
  expect(routed.query_start).toBe('2026-07-13');
});

test('provider error/timeout falls through as null, never throws', async () => {
  process.env.BOT_ROUTER = '1';
  callClaude.mockRejectedValue(new Error('timeout'));
  expect(await routeReadIntent('show tasks')).toBeNull();
});

test('unexpected shape falls through as null', async () => {
  process.env.BOT_ROUTER = '1';
  callClaude.mockResolvedValue({ text: JSON.stringify({ route: 'delete_everything' }) });
  expect(await routeReadIntent('show tasks')).toBeNull();
});
