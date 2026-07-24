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
const { checkAiHealth, featuresOverImpact } = require('./ai-health');

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

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks resets calls but NOT implementations - restore the lock to
  // "acquired" so a test that set it false (debounce) doesn't leak forward.
  db.acquireSchedulerLock.mockResolvedValue(true);
});

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

// ── Signal 4: a specific feature erroring for multiple users ──
const featErr = (user_id, feature = 'recipe_import_photo') =>
  ({ provider: 'claude', is_failover: false, error: '400 invalid base64 data', feature, user_id });

test('signal 4: a feature failing for 2 distinct users alerts (rate signals would miss it)', async () => {
  mockTables({ aiRows: [featErr('u1'), featErr('u2')] });
  await checkAiHealth();
  expect(email.sendAdminAlert).toHaveBeenCalledTimes(1);
  expect(email.sendAdminAlert.mock.calls[0][0]).toMatch(/recipe_import_photo.*failing/i);
});

test('signal 4: one user erroring repeatedly on a feature does NOT alert (dashboard-only)', async () => {
  mockTables({ aiRows: [featErr('u1'), featErr('u1'), featErr('u1')] });
  await checkAiHealth();
  expect(email.sendAdminAlert).not.toHaveBeenCalled();
});

describe('featuresOverImpact (pure)', () => {
  const row = (feature, user_id, error = '400 boom') => ({ feature, user_id, error });

  test('2 distinct users on one feature is surfaced with counts', () => {
    expect(featuresOverImpact([row('recipe_import_photo', 'a'), row('recipe_import_photo', 'b')]))
      .toEqual([{ feature: 'recipe_import_photo', count: 2, users: 2, sample: '400 boom' }]);
  });

  test('failover doubling for one user counts as ONE user', () => {
    const out = featuresOverImpact([
      row('recipe_import_photo', 'a', 'claude 400'), row('recipe_import_photo', 'a', 'gemini 400'),
      row('recipe_import_photo', 'b', 'claude 400'), row('recipe_import_photo', 'b', 'gemini 400'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ users: 2, count: 4 });
  });

  test('single-user, non-error, and empty inputs return nothing', () => {
    expect(featuresOverImpact([row('chat', 'a'), row('chat', 'a')])).toEqual([]);
    expect(featuresOverImpact([{ feature: 'chat', user_id: 'a', error: null }])).toEqual([]);
    expect(featuresOverImpact([])).toEqual([]);
    expect(featuresOverImpact(undefined)).toEqual([]);
  });

  test('threshold is configurable', () => {
    const rows = [row('chat', 'a'), row('chat', 'b'), row('chat', 'c')];
    expect(featuresOverImpact(rows, 3)).toHaveLength(1);
    expect(featuresOverImpact(rows, 4)).toHaveLength(0);
  });
});
