// queries.js imports the real Supabase client at load-time, which needs env
// vars. Mock it to a no-op; findSimilarEvent takes its db via the explicit arg.
jest.mock('./client', () => ({ supabase: {}, supabaseAdmin: {} }));
const { findSimilarEvent } = require('./queries');

// Chainable mock recording the .is() filters, resolving on .limit().
function mockDb(resultRows) {
  const isCalls = [];
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    is: (col, val) => { isCalls.push([col, val]); return chain; },
    ilike: () => chain,
    gte: () => chain,
    lte: () => chain,
    limit: () => Promise.resolve({ data: resultRows, error: null }),
  };
  return { db: chain, isCalls };
}

describe('findSimilarEvent', () => {
  const START = '2026-06-15T12:00:00.000Z';

  test('excludes synced events - filters external_feed_id IS NULL (and deleted_at)', async () => {
    const { db, isCalls } = mockDb([]);
    await findSimilarEvent('h1', 'Flicky', START, db);
    // The fix: a read-only synced/feed copy must not count as a duplicate.
    expect(isCalls).toContainEqual(['external_feed_id', null]);
    expect(isCalls).toContainEqual(['deleted_at', null]);
  });

  test('returns the matching native event when one exists', async () => {
    const { db } = mockDb([{ id: 'e1', title: 'Flicky', start_time: START }]);
    const out = await findSimilarEvent('h1', 'Flicky', START, db);
    expect(out).toMatchObject({ id: 'e1' });
  });

  test('returns null when nothing matches', async () => {
    const { db } = mockDb([]);
    expect(await findSimilarEvent('h1', 'Flicky', START, db)).toBeNull();
  });

  test('returns null for blank title or missing start (no query)', async () => {
    const { db } = mockDb([]);
    expect(await findSimilarEvent('h1', '   ', START, db)).toBeNull();
    expect(await findSimilarEvent('h1', 'Flicky', '', db)).toBeNull();
  });
});
