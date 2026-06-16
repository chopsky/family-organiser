// digest.js requires the real db client at load time, which needs env vars.
// Mock it; dedupeTodayEvents is a pure function and touches nothing else.
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../middleware/auth', () => ({
  requireAuth: (_req, _res, next) => next(),
  requireHousehold: (_req, _res, next) => next(),
}));
const { dedupeTodayEvents } = require('./digest');

describe('dedupeTodayEvents', () => {
  const ids = (events) => events.map((e) => e.id);

  it('drops a synced ghost shadowed by a native event of the same title+date', () => {
    // User deleted "Flicky" at the Apple source (it lingers as a synced row at
    // 12:00) and re-created it natively at 14:00. Up next should show the native.
    const out = dedupeTodayEvents([
      { id: 's', title: 'Flicky', start_time: '2026-06-16T12:00:00', external_feed_id: 'feed1' },
      { id: 'n', title: 'Flicky', start_time: '2026-06-16T14:00:00', external_feed_id: null },
    ]);
    expect(ids(out)).toEqual(['n']);
  });

  it('keeps a synced event that has no native counterpart', () => {
    const out = dedupeTodayEvents([
      { id: 's', title: 'Bins', start_time: '2026-06-16T07:00:00', external_feed_id: 'feed1' },
    ]);
    expect(ids(out)).toEqual(['s']);
  });

  it('still collapses exact title+start_time duplicates from sync', () => {
    const out = dedupeTodayEvents([
      { id: 'a', title: 'Gym', start_time: '2026-06-16T09:00:00', external_feed_id: null },
      { id: 'b', title: 'Gym', start_time: '2026-06-16T09:00:00', external_feed_id: null },
    ]);
    expect(ids(out)).toEqual(['a']);
  });

  it('leaves two genuinely different native events alone', () => {
    const out = dedupeTodayEvents([
      { id: 'a', title: 'Call', start_time: '2026-06-16T09:00:00', external_feed_id: null },
      { id: 'b', title: 'Call', start_time: '2026-06-16T17:00:00', external_feed_id: null },
    ]);
    expect(ids(out)).toEqual(['a', 'b']);
  });
});
