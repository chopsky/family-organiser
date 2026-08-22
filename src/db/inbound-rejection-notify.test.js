/**
 * Throttle for the blocked-sender notification.
 *
 * A silent rejection is why email forwarding looked broken, so the
 * notification matters - but a parent re-forwarding three letters in a
 * row should be nudged once, not three times. The throttle reads the
 * rejection log itself, which is written immediately BEFORE the
 * notification, so exactly one row means "this is the first".
 */
jest.mock('./client', () => ({ supabase: {}, supabaseAdmin: {} }));

const db = require('./queries');

/** Chainable stub resolving to `rows` (or an error) at .limit(). */
function stubDb(rows, error = null) {
  const q = {
    select: () => q, eq: () => q, ilike: () => q, gte: () => q,
    limit: () => Promise.resolve({ data: rows, error }),
  };
  return { from: () => q };
}

describe('wasSenderRejectionNotified', () => {
  test('first rejection from a sender -> not yet notified', async () => {
    // Only this rejection's own row exists.
    const out = await db.wasSenderRejectionNotified('hh1', 'maxine@example.com', stubDb([{ id: 'r1' }]));
    expect(out).toBe(false);
  });

  test('a second rejection within the day -> already notified', async () => {
    const out = await db.wasSenderRejectionNotified('hh1', 'maxine@example.com', stubDb([{ id: 'r1' }, { id: 'r2' }]));
    expect(out).toBe(true);
  });

  test('a query wobble FAILS OPEN so the nudge still goes out', async () => {
    const out = await db.wasSenderRejectionNotified('hh1', 'maxine@example.com', stubDb(null, new Error('boom')));
    expect(out).toBe(false);
  });

  test('an empty sender is never notified about', async () => {
    const out = await db.wasSenderRejectionNotified('hh1', '', stubDb([]));
    expect(out).toBe(true);
  });
});
