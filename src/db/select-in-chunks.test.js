/**
 * selectInChunks: the guard against PostgREST's querystring cliff.
 *
 * .in() lists travel in the URL, so a few hundred UUIDs overflow the request
 * line and the call fails at the NETWORK layer ("TypeError: fetch failed") -
 * invisible to PostgREST error handling. Measured 2026-09-03 on this project:
 * 300 ids fine, 427 fails. That is how the admin Households page broke with
 * no code change: the estate simply grew past the limit.
 */
jest.mock('./client', () => ({ supabase: {}, supabaseAdmin: {} }));

const { __test } = require('./queries');
const selectInChunks = __test?.selectInChunks;

const ids = (n) => Array.from({ length: n }, (_, i) => `id-${i}`);

describe('selectInChunks', () => {
  it('splits an oversized id list into requests no larger than the chunk size', async () => {
    const seen = [];
    const rows = await selectInChunks(ids(430), (chunk) => {
      seen.push(chunk.length);
      return Promise.resolve({ data: chunk.map((id) => ({ id })), error: null });
    });
    expect(Math.max(...seen)).toBeLessThanOrEqual(150);
    expect(seen.reduce((a, b) => a + b, 0)).toBe(430);
    expect(rows).toHaveLength(430);           // every chunk's rows concatenated
  });

  it('makes a single request when the list is small', async () => {
    let calls = 0;
    await selectInChunks(ids(10), () => { calls += 1; return Promise.resolve({ data: [], error: null }); });
    expect(calls).toBe(1);
  });

  it('does not call the database for an empty list', async () => {
    let calls = 0;
    const rows = await selectInChunks([], () => { calls += 1; return Promise.resolve({ data: [], error: null }); });
    expect(calls).toBe(0);
    expect(rows).toEqual([]);
  });

  it('propagates a PostgREST error rather than returning partial rows', async () => {
    await expect(selectInChunks(ids(200), (chunk) =>
      Promise.resolve(chunk[0] === 'id-150' ? { data: null, error: { message: 'boom' } } : { data: [], error: null })
    )).rejects.toMatchObject({ message: 'boom' });
  });
});
