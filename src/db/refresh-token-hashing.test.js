/**
 * Refresh-token hashing invariants.
 *
 * Tokens must never be persisted in plaintext - a database leak must not
 * hand out live sessions. These tests inject a fake supabase client into
 * the queries (they all accept a `db` param) and pin:
 *
 *   1. createRefreshToken stores sha256(token), not the token.
 *   2. getValidRefreshToken finds a hashed row via the hash-first lookup.
 *   3. Legacy plaintext rows (pre-change) still resolve via the fallback
 *      AND get upgraded to the hash in place, so live sessions survive
 *      the rollout without a migration.
 */

// queries.js requires ./client at module load, which throws without Supabase
// env vars. Stub it - every call in these tests goes through the injected
// fake db, never the real client.
jest.mock('./client', () => ({
  supabase: { from: () => { throw new Error('real client must not be used'); } },
  supabaseAdmin: { from: () => { throw new Error('real client must not be used'); } },
}));

const crypto = require('crypto');
const db = require('./queries');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Minimal chainable supabase fake. Every builder method returns `this`;
 * terminal calls (single / thenable update-eq) pull from a scripted queue
 * so multi-step flows (hash miss -> legacy hit -> upgrade) can be staged.
 */
function makeFakeDb(script) {
  const calls = { inserts: [], updates: [], singleFilters: [] };
  const queue = [...script];
  function builder() {
    const filters = {};
    const b = {
      insert(row) { calls.inserts.push(row); return b; },
      update(row) { calls.updates.push({ row, filters }); return b; },
      select() { return b; },
      eq(col, val) { filters[col] = val; return b; },
      gt() { return b; },
      async single() {
        calls.singleFilters.push({ ...filters });
        const next = queue.shift() || { data: null, error: { code: 'PGRST116' } };
        return next;
      },
      // updates resolve without .single(); make the builder awaitable
      then(resolve) { resolve({ error: null }); },
    };
    return b;
  }
  return { from: () => builder(), calls };
}

describe('refresh-token hashing', () => {
  const TOKEN = 'a'.repeat(64); // shaped like generateToken() output

  test('createRefreshToken stores the sha256 hash, never the raw token', async () => {
    const fake = makeFakeDb([{ data: { id: 'rt-1' }, error: null }]);
    await db.createRefreshToken('user-1', TOKEN, '2027-01-01T00:00:00Z', {}, fake);
    expect(fake.calls.inserts).toHaveLength(1);
    expect(fake.calls.inserts[0].token).toBe(sha256(TOKEN));
    expect(JSON.stringify(fake.calls.inserts)).not.toContain(TOKEN);
  });

  test('getValidRefreshToken resolves a hashed row (hash-first lookup)', async () => {
    const row = { id: 'rt-1', user_id: 'user-1', token: sha256(TOKEN) };
    const fake = makeFakeDb([{ data: row, error: null }]);
    const found = await db.getValidRefreshToken(TOKEN, fake);
    expect(found).toEqual(row);
    expect(fake.calls.singleFilters[0].token).toBe(sha256(TOKEN));
    expect(fake.calls.updates).toHaveLength(0); // no upgrade needed
  });

  test('legacy plaintext row resolves via fallback and is upgraded in place', async () => {
    const legacyRow = { id: 'rt-legacy', user_id: 'user-1', token: TOKEN };
    const fake = makeFakeDb([
      { data: null, error: { code: 'PGRST116' } }, // hash lookup misses
      { data: legacyRow, error: null },            // plaintext lookup hits
    ]);
    const found = await db.getValidRefreshToken(TOKEN, fake);
    expect(found).toEqual(legacyRow);
    // Second lookup used the raw token (legacy path)
    expect(fake.calls.singleFilters[1].token).toBe(TOKEN);
    // Row upgraded to the hash, targeted by id
    expect(fake.calls.updates).toHaveLength(1);
    expect(fake.calls.updates[0].row).toEqual({ token: sha256(TOKEN) });
    expect(fake.calls.updates[0].filters.id).toBe('rt-legacy');
  });

  test('unknown token returns null without writes', async () => {
    const fake = makeFakeDb([]); // both lookups miss via default
    const found = await db.getValidRefreshToken(TOKEN, fake);
    expect(found).toBeNull();
    expect(fake.calls.updates).toHaveLength(0);
  });
});
