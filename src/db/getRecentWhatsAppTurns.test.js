// queries.js imports the real Supabase client at load time (needs env
// vars). Mock it to a no-op; the function under test takes its db via the
// explicit `db` argument, not the module default.
jest.mock('./client', () => ({ supabase: {}, supabaseAdmin: {} }));
const { getRecentWhatsAppTurns } = require('./queries');

// Supabase-query-builder stub that actually applies the .eq() filters the
// function uses (notably .eq('direction','inbound')) and the limit, so the
// test exercises real filtering rather than rubber-stamping every row.
function fakeDb(rows) {
  const filters = {};
  const builder = {
    from() { return builder; },
    select() { return builder; },
    eq(col, val) { filters[col] = val; return builder; },
    order() { return builder; },
    limit(n) {
      const out = rows
        .filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v))
        .slice(0, n);
      return Promise.resolve({ data: out, error: null });
    },
  };
  return builder;
}

const minsAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();
const inbound = (over) => ({ user_id: 'user-1', direction: 'inbound', message_type: 'text', error: null, ...over });
const outbound = (over) => ({ user_id: 'user-1', direction: 'outbound', error: null, ...over });

describe('getRecentWhatsAppTurns conversation window', () => {
  test('excludes a recent automated broadcast (weekly digest) entirely', async () => {
    // The Mallorca bug: a "Weekly roundup" digest went out minutes ago. Its
    // body must NOT be replayed (and certainly not as a role:'user' turn).
    const rows = [
      outbound({ body: '📊 Weekly roundup for the Shapiros... 13 tasks', response: null, created_at: minsAgo(4), message_type: 'weekly_digest' }),
      inbound({ body: 'what is on today?', response: 'Today you have swimming.', created_at: minsAgo(6) }),
    ];
    const turns = await getRecentWhatsAppTurns('user-1', { windowMinutes: 30 }, fakeDb(rows));
    expect(turns).toEqual([
      { role: 'user', content: 'what is on today?' },
      { role: 'assistant', content: 'Today you have swimming.' },
    ]);
    // No digest text anywhere.
    expect(JSON.stringify(turns)).not.toMatch(/roundup/i);
  });

  test('excludes a stale turn even when it is the most recent stored row', async () => {
    // Window is anchored to NOW, not the latest row.
    const rows = [
      inbound({ body: 'Mason has Myo Therapy', response: 'Added', created_at: minsAgo(150) }),
    ];
    const turns = await getRecentWhatsAppTurns('user-1', { windowMinutes: 30 }, fakeDb(rows));
    expect(turns).toEqual([]);
  });

  test('includes genuinely recent inbound turns within the window, oldest -> newest', async () => {
    const rows = [
      inbound({ body: 'what about tomorrow?', response: 'Tomorrow you have...', created_at: minsAgo(5) }),
      inbound({ body: 'what is on today?', response: 'Today you have...', created_at: minsAgo(10) }),
      outbound({ body: 'stale nudge', response: null, created_at: minsAgo(8), message_type: 'daily_reminder' }),
    ];
    const turns = await getRecentWhatsAppTurns('user-1', { windowMinutes: 30 }, fakeDb(rows));
    expect(turns).toEqual([
      { role: 'user', content: 'what is on today?' },
      { role: 'assistant', content: 'Today you have...' },
      { role: 'user', content: 'what about tomorrow?' },
      { role: 'assistant', content: 'Tomorrow you have...' },
    ]);
  });

  test('drops errored rows and returns [] for no user', async () => {
    expect(await getRecentWhatsAppTurns(null, {}, fakeDb([]))).toEqual([]);
    const rows = [inbound({ body: 'hi', response: 'hey', created_at: minsAgo(2), error: 'boom' })];
    expect(await getRecentWhatsAppTurns('user-1', { windowMinutes: 30 }, fakeDb(rows))).toEqual([]);
  });
});
