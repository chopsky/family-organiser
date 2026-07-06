/**
 * Regression test for getHouseholdActivities, which powers the household-level
 * Activities card. It must:
 *   1. scope by the joined users.household_id (no other household's rows),
 *   2. strip the joined `users` object so callers get clean activity rows, and
 *   3. attach each activity's skipped dates as `skips: []` (second query
 *      against activity_skips), degrading to empty arrays when the skips
 *      table doesn't exist yet (pre-migration).
 *
 * We mock ./client with a chainable fake and - crucially - call the function
 * with NO `db` argument so the DEFAULT parameter (the module's admin client) is
 * exercised. An earlier bug defaulted to a `supabaseAdmin` identifier that the
 * module never binds (it imports it as `supabase`), which threw a ReferenceError
 * at call time. The route test couldn't catch it because it mocked the query;
 * this exercises the real body.
 *
 * The fake resolves queued results in order: the function issues the
 * activities select first, then the skips select.
 */
const mockEqCalls = [];
let mockResults = [{ data: [], error: null }];
const mockChain = {
  from: jest.fn(() => mockChain),
  select: jest.fn(() => mockChain),
  order: jest.fn(() => mockChain),
  in: jest.fn(() => mockChain),
  eq: jest.fn((col, val) => { mockEqCalls.push([col, val]); return mockChain; }),
  // Thenable so `await query` resolves to the supabase-style result. Shift
  // through the queue; the last entry answers any further queries.
  then: (resolve) => resolve(mockResults.length > 1 ? mockResults.shift() : mockResults[0]),
};
jest.mock('./client', () => ({ supabaseAdmin: mockChain, supabase: mockChain }));

const queries = require('./queries');

describe('getHouseholdActivities', () => {
  beforeEach(() => { mockEqCalls.length = 0; });

  test('scopes by users.household_id, strips the joined users object, attaches skips (default client)', async () => {
    mockResults = [
      {
        data: [
          { id: 'a1', child_id: 'c-1', activity: 'Swimming', day_of_week: 1, users: { household_id: 'hh-1' } },
          { id: 'a2', child_id: 'c-2', activity: 'Football', day_of_week: 3, users: { household_id: 'hh-1' } },
        ],
        error: null,
      },
      // activity_skips rows: a2 is skipped on one date.
      { data: [{ activity_id: 'a2', date: '2026-07-08' }], error: null },
    ];
    // No db arg -> default parameter (the module's admin client) must resolve.
    const rows = await queries.getHouseholdActivities('hh-1');
    expect(mockEqCalls).toContainEqual(['users.household_id', 'hh-1']);
    expect(rows).toEqual([
      { id: 'a1', child_id: 'c-1', activity: 'Swimming', day_of_week: 1, skips: [] },
      { id: 'a2', child_id: 'c-2', activity: 'Football', day_of_week: 3, skips: ['2026-07-08'] },
    ]);
    // The join object must not leak through.
    expect(rows.every((r) => !('users' in r))).toBe(true);
  });

  test('returns [] when the household has no activities', async () => {
    mockResults = [{ data: [], error: null }];
    const rows = await queries.getHouseholdActivities('hh-empty');
    expect(rows).toEqual([]);
  });

  test('degrades to empty skips when activity_skips is missing (pre-migration)', async () => {
    mockResults = [
      { data: [{ id: 'a1', child_id: 'c-1', activity: 'Swimming', day_of_week: 1, users: { household_id: 'hh-1' } }], error: null },
      { data: null, error: { code: '42P01', message: 'relation "activity_skips" does not exist' } },
    ];
    const rows = await queries.getHouseholdActivities('hh-1');
    expect(rows).toEqual([{ id: 'a1', child_id: 'c-1', activity: 'Swimming', day_of_week: 1, skips: [] }]);
  });

  test('throws when the query errors', async () => {
    mockResults = [{ data: null, error: { message: 'boom' } }];
    await expect(queries.getHouseholdActivities('hh-1')).rejects.toBeDefined();
  });
});
