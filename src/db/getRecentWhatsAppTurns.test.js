// queries.js imports the real Supabase client at load time (needs env
// vars). Mock it to a no-op; the function under test takes its db via the
// explicit `db` argument, not the module default.
jest.mock('./client', () => ({ supabase: {}, supabaseAdmin: {} }));
const { getRecentWhatsAppTurns } = require('./queries');

// Minimal supabase-query-builder stub: every chainable method returns `this`,
// and the terminal `.limit()` resolves to { data, error }.
function fakeDb(rows) {
  const builder = {
    from() { return builder; },
    select() { return builder; },
    eq() { return builder; },
    order() { return builder; },
    limit() { return Promise.resolve({ data: rows, error: null }); },
  };
  return builder;
}

const minsAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();

describe('getRecentWhatsAppTurns conversation window', () => {
  test('excludes a stale message even when it is the most recent stored row', async () => {
    // The morning "overdue tasks" nudge went out hours ago and is the latest
    // row on file; a fresh unrelated message has not been logged yet. The
    // window must be anchored to NOW, so the stale nudge is dropped.
    const rows = [
      { direction: 'outbound', body: null, response: 'you have 8 overdue tasks', created_at: minsAgo(150), error: null, message_type: 'reminder' },
      { direction: 'inbound', body: 'Mason has Myo Therapy', response: 'Added', created_at: minsAgo(200), error: null, message_type: 'text' },
    ];
    const turns = await getRecentWhatsAppTurns('user-1', { windowMinutes: 30 }, fakeDb(rows));
    expect(turns).toEqual([]);
  });

  test('includes genuinely recent turns within the window', async () => {
    const rows = [
      { direction: 'inbound', body: 'what about tomorrow?', response: 'Tomorrow you have...', created_at: minsAgo(5), error: null, message_type: 'text' },
      { direction: 'inbound', body: 'what is on today?', response: 'Today you have...', created_at: minsAgo(10), error: null, message_type: 'text' },
      { direction: 'outbound', body: null, response: 'stale nudge', created_at: minsAgo(180), error: null, message_type: 'reminder' },
    ];
    const turns = await getRecentWhatsAppTurns('user-1', { windowMinutes: 30 }, fakeDb(rows));
    // chronological order, only the two recent rows, each expanded to user+assistant
    expect(turns).toEqual([
      { role: 'user', content: 'what is on today?' },
      { role: 'assistant', content: 'Today you have...' },
      { role: 'user', content: 'what about tomorrow?' },
      { role: 'assistant', content: 'Tomorrow you have...' },
    ]);
  });

  test('drops errored rows and returns [] for no user', async () => {
    expect(await getRecentWhatsAppTurns(null, {}, fakeDb([]))).toEqual([]);
    const rows = [{ direction: 'inbound', body: 'hi', response: 'hey', created_at: minsAgo(2), error: 'boom', message_type: 'text' }];
    expect(await getRecentWhatsAppTurns('user-1', { windowMinutes: 30 }, fakeDb(rows))).toEqual([]);
  });
});
