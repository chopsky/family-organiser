jest.mock('./client', () => ({ supabaseAdmin: {}, supabase: {}, getUserClient: () => ({}), testConnection: () => {} }));
const { pauseOrResumeTrial } = require('./queries');

// from() #1 is the SELECT (single() -> household); from() #2 is the UPDATE
// (update() called, single() -> merged row). Captures the update payload.
function fakeDb(hh) {
  const calls = { updates: null };
  const db = {
    _updates: () => calls.updates,
    from() {
      let isUpdate = false;
      let payload = null;
      const b = {
        select() { return b; },
        update(u) { isUpdate = true; payload = u; calls.updates = u; return b; },
        eq() { return b; },
        single() {
          return Promise.resolve(isUpdate
            ? { data: { ...hh, ...payload }, error: null }
            : { data: hh, error: null });
        },
      };
      return b;
    },
  };
  return db;
}

describe('pauseOrResumeTrial', () => {
  test('pause stamps trial_paused_at and leaves trial_ends_at alone', async () => {
    const hh = { trial_ends_at: '2026-07-01T00:00:00.000Z', trial_paused_at: null };
    const db = fakeDb(hh);
    const out = await pauseOrResumeTrial('hh', true, db);
    expect(typeof out.trial_paused_at).toBe('string');
    expect(db._updates().trial_ends_at).toBeUndefined();
  });

  test('pause is a no-op when already paused', async () => {
    const hh = { trial_ends_at: '2026-07-01T00:00:00.000Z', trial_paused_at: '2026-06-01T00:00:00.000Z' };
    const db = fakeDb(hh);
    const out = await pauseOrResumeTrial('hh', true, db);
    expect(db._updates()).toBeNull(); // no update issued
    expect(out.trial_paused_at).toBe(hh.trial_paused_at);
  });

  test('resume adds the paused duration back onto trial_ends_at', async () => {
    const pausedAt = new Date(Date.now() - 3 * 86_400_000).toISOString(); // paused 3 days ago
    const trialEnd = new Date(Date.now() + 4 * 86_400_000).toISOString(); // 4 days left when paused
    const db = fakeDb({ trial_ends_at: trialEnd, trial_paused_at: pausedAt });
    const out = await pauseOrResumeTrial('hh', false, db);
    expect(out.trial_paused_at).toBeNull();
    // new end ≈ original end + 3 paused days
    const added = new Date(out.trial_ends_at).getTime() - new Date(trialEnd).getTime();
    expect(added).toBeGreaterThan(2.9 * 86_400_000);
    expect(added).toBeLessThan(3.1 * 86_400_000);
  });

  test('resume is a no-op when not paused', async () => {
    const db = fakeDb({ trial_ends_at: '2026-07-01T00:00:00.000Z', trial_paused_at: null });
    await pauseOrResumeTrial('hh', false, db);
    expect(db._updates()).toBeNull();
  });
});
