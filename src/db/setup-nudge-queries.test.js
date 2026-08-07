/**
 * Unit tests for the setup/verify nudge finders + stamps in db/queries.js:
 *   • findUsersAwaitingSetupNudge: verified + NO household (household_id IS
 *     NULL - the state create-household's claim flips) + unstamped, windowed
 *     24h-7d after created_at.
 *   • findUsersAwaitingVerifyNudge: unverified + unstamped, same window.
 *   • Missing-column self-heal (42703 / PGRST204 → []) so the cron no-ops
 *     before migration-setup-nudge-emails.sql runs.
 *   • markSetupNudgeSent / markVerifyNudgeSent stamp a timestamptz.
 *   • findUsersAwaitingWhatsAppFollowup now EXCLUDES householdless users -
 *     they belong to the setup nudge, not the WhatsApp pitch.
 */
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));

const {
  findUsersAwaitingSetupNudge,
  findUsersAwaitingVerifyNudge,
  findUsersAwaitingWhatsAppFollowup,
  markSetupNudgeSent,
  markVerifyNudgeSent,
} = require('./queries');

// Thenable chainable query builder: records every (method, args) filter call
// and resolves to `result` when awaited.
function fakeDb(result = { data: [], error: null }) {
  const filters = [];
  const state = { table: null, selected: null, updated: null, filters };
  const chain = {
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  for (const m of ['eq', 'is', 'lt', 'gt', 'not']) {
    chain[m] = (...args) => { filters.push([m, ...args]); return chain; };
  }
  chain.select = (cols) => { state.selected = cols; return chain; };
  chain.update = (row) => { state.updated = row; return chain; };
  const db = { from: (table) => { state.table = table; return chain; } };
  return { db, state };
}

const has = (state, ...call) =>
  state.filters.some((f) => f.length === call.length && f.every((v, i) => v === call[i]));

const windowArgs = (state) => ({
  lt: state.filters.find((f) => f[0] === 'lt' && f[1] === 'created_at')?.[2],
  gt: state.filters.find((f) => f[0] === 'gt' && f[1] === 'created_at')?.[2],
});

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('findUsersAwaitingSetupNudge', () => {
  test('filters: verified, householdless, unstamped, enabled, email present', async () => {
    const { db, state } = fakeDb({ data: [{ id: 'u1', name: 'A', email: 'a@b.c' }], error: null });
    const rows = await findUsersAwaitingSetupNudge(db);

    expect(state.table).toBe('users');
    expect(has(state, 'eq', 'email_verified', true)).toBe(true);
    expect(has(state, 'is', 'household_id', null)).toBe(true);      // "no household"
    expect(has(state, 'is', 'setup_nudge_sent_at', null)).toBe(true);
    expect(has(state, 'is', 'disabled_at', null)).toBe(true);
    expect(has(state, 'not', 'email', 'is', null)).toBe(true);
    expect(rows).toEqual([{ id: 'u1', name: 'A', email: 'a@b.c' }]);
  });

  test('window is 24h-7d after created_at', async () => {
    const { db, state } = fakeDb();
    await findUsersAwaitingSetupNudge(db);
    const { lt, gt } = windowArgs(state);
    expect(Math.abs(Date.now() - 24 * 3600e3 - new Date(lt).getTime())).toBeLessThan(5000);
    expect(Math.abs(Date.now() - 7 * 24 * 3600e3 - new Date(gt).getTime())).toBeLessThan(5000);
  });

  test.each(['42703', 'PGRST204'])('self-heals to [] when the stamp column is unmigrated (%s)', async (code) => {
    const { db } = fakeDb({ data: null, error: { code, message: 'column missing' } });
    await expect(findUsersAwaitingSetupNudge(db)).resolves.toEqual([]);
    expect(console.error).not.toHaveBeenCalled(); // quiet warn, not an error
  });

  test('returns [] on any other query error', async () => {
    const { db } = fakeDb({ data: null, error: { code: '57014', message: 'timeout' } });
    await expect(findUsersAwaitingSetupNudge(db)).resolves.toEqual([]);
  });
});

describe('findUsersAwaitingVerifyNudge', () => {
  test('filters: UNverified, unstamped, enabled, email present - no household condition', async () => {
    const { db, state } = fakeDb({ data: [{ id: 'u2', name: 'B', email: 'b@b.c' }], error: null });
    const rows = await findUsersAwaitingVerifyNudge(db);

    expect(state.table).toBe('users');
    expect(has(state, 'eq', 'email_verified', false)).toBe(true);
    expect(has(state, 'is', 'verify_nudge_sent_at', null)).toBe(true);
    expect(has(state, 'is', 'disabled_at', null)).toBe(true);
    expect(has(state, 'not', 'email', 'is', null)).toBe(true);
    expect(state.filters.some((f) => f[1] === 'household_id')).toBe(false);
    expect(rows).toEqual([{ id: 'u2', name: 'B', email: 'b@b.c' }]);
  });

  test('window is 24h-7d after created_at', async () => {
    const { db, state } = fakeDb();
    await findUsersAwaitingVerifyNudge(db);
    const { lt, gt } = windowArgs(state);
    expect(Math.abs(Date.now() - 24 * 3600e3 - new Date(lt).getTime())).toBeLessThan(5000);
    expect(Math.abs(Date.now() - 7 * 24 * 3600e3 - new Date(gt).getTime())).toBeLessThan(5000);
  });

  test.each(['42703', 'PGRST204'])('self-heals to [] when the stamp column is unmigrated (%s)', async (code) => {
    const { db } = fakeDb({ data: null, error: { code, message: 'column missing' } });
    await expect(findUsersAwaitingVerifyNudge(db)).resolves.toEqual([]);
  });
});

describe('findUsersAwaitingWhatsAppFollowup - setup-nudge exclusion', () => {
  test('requires a household: householdless users get the setup nudge instead', async () => {
    const { db, state } = fakeDb();
    await findUsersAwaitingWhatsAppFollowup(db);
    expect(has(state, 'not', 'household_id', 'is', null)).toBe(true);
    // unchanged core criteria still present
    expect(has(state, 'eq', 'email_verified', true)).toBe(true);
    expect(has(state, 'eq', 'whatsapp_linked', false)).toBe(true);
    expect(has(state, 'is', 'whatsapp_followup_sent_at', null)).toBe(true);
  });
});

describe('stamps', () => {
  test('markSetupNudgeSent writes setup_nudge_sent_at for the user', async () => {
    const { db, state } = fakeDb({ error: null });
    await markSetupNudgeSent('u9', db);
    expect(state.table).toBe('users');
    expect(new Date(state.updated.setup_nudge_sent_at).getTime()).toBeGreaterThan(0);
    expect(has(state, 'eq', 'id', 'u9')).toBe(true);
  });

  test('markVerifyNudgeSent writes verify_nudge_sent_at for the user', async () => {
    const { db, state } = fakeDb({ error: null });
    await markVerifyNudgeSent('u9', db);
    expect(new Date(state.updated.verify_nudge_sent_at).getTime()).toBeGreaterThan(0);
    expect(has(state, 'eq', 'id', 'u9')).toBe(true);
  });
});
