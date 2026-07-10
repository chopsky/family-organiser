/**
 * ai-health hourly monitor: the three alert conditions + the regression that
 * mattered — Claude-primary traffic (is_failover=false) is the EXPECTED shape
 * since classify went Claude-first (2026-07-02) and must NOT alert. The old
 * "gemini-skipped" signal treated exactly that as an incident.
 */

jest.mock('../db/client', () => ({ supabaseAdmin: { from: jest.fn() } }));
jest.mock('../db/queries', () => ({ acquireSchedulerLock: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../services/email', () => ({ sendAdminAlert: jest.fn(() => Promise.resolve()) }));

const { supabaseAdmin: supabase } = require('../db/client');
const db = require('../db/queries');
const email = require('../services/email');
const { checkAiHealth } = require('./ai-health');

// Chainable, awaitable supabase-query stub: every builder method returns the
// chain; awaiting it resolves to the canned result.
function chain(result) {
  const c = {};
  for (const m of ['select', 'gte', 'eq', 'not', 'order', 'limit']) c[m] = () => c;
  c.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return c;
}

function mockTables({ aiRows = [], userFailureCount = 0 } = {}) {
  supabase.from.mockImplementation((table) => {
    if (table === 'ai_usage_log') return chain({ data: aiRows, error: null });
    if (table === 'whatsapp_message_log') return chain({ count: userFailureCount, error: null });
    throw new Error(`unexpected table ${table}`);
  });
}

const claudePrimary = { provider: 'claude', is_failover: false, error: null };
const geminiRescue = { provider: 'gemini', is_failover: true, error: null };

beforeEach(() => jest.clearAllMocks());

test('healthy hour: Claude-primary traffic does NOT alert (old inverted signal)', async () => {
  mockTables({ aiRows: Array(10).fill(claudePrimary), userFailureCount: 0 });
  await checkAiHealth();
  expect(email.sendAdminAlert).not.toHaveBeenCalled();
});

test('≥3 user-visible bot failures alerts even on a low-volume hour', async () => {
  mockTables({ aiRows: [claudePrimary], userFailureCount: 3 }); // below MIN_VOLUME provider rows
  await checkAiHealth();
  expect(email.sendAdminAlert).toHaveBeenCalledTimes(1);
  expect(email.sendAdminAlert.mock.calls[0][0]).toMatch(/user-visible failures/i);
});

test('majority failover traffic alerts primary-failing', async () => {
  mockTables({ aiRows: [...Array(6).fill(geminiRescue), ...Array(4).fill(claudePrimary)] });
  await checkAiHealth();
  expect(email.sendAdminAlert).toHaveBeenCalledTimes(1);
  expect(email.sendAdminAlert.mock.calls[0][0]).toMatch(/primary provider struggling/i);
});

test('a single provider erroring on most of its attempts alerts provider-failing', async () => {
  const geminiErr = { provider: 'gemini', is_failover: false, error: '429 quota' };
  const geminiOk = { provider: 'gemini', is_failover: false, error: null };
  mockTables({ aiRows: [...Array(4).fill(geminiErr), geminiOk, ...Array(3).fill(claudePrimary)] });
  await checkAiHealth();
  expect(email.sendAdminAlert).toHaveBeenCalledTimes(1);
  expect(email.sendAdminAlert.mock.calls[0][0]).toMatch(/gemini failing/i);
});

test('debounce: no email when the daily lock was already taken', async () => {
  db.acquireSchedulerLock.mockResolvedValue(false);
  mockTables({ aiRows: [claudePrimary], userFailureCount: 5 });
  await checkAiHealth();
  expect(email.sendAdminAlert).not.toHaveBeenCalled();
});
