// A timed event created with no end (or end == start) must default to a 1-hour
// duration - the AI/chat path returned end == start for "dinner at 20:15",
// producing a zero-length event the user then couldn't save when editing
// ("end time must be after the start time").
jest.mock('./client', () => ({ supabase: {}, supabaseAdmin: {} }));
const { createCalendarEvent } = require('./queries');

function captureDb() {
  const state = {};
  const chain = {
    insert: (row) => { state.row = row; return chain; },
    select: () => chain,
    single: () => Promise.resolve({ data: { id: 'evt1', ...state.row }, error: null }),
  };
  return { db: { from: () => chain }, state };
}

async function create(extra) {
  const { db, state } = captureDb();
  await createCalendarEvent('h1', { title: 'Dinner at Kapara', ...extra }, 'u1', db);
  return state.row;
}

describe('createCalendarEvent end-time defaulting', () => {
  test('end == start (timed) → defaults to a 1-hour duration', async () => {
    const row = await create({ start_time: '2026-06-30T20:15:00Z', end_time: '2026-06-30T20:15:00Z' });
    expect(row.end_time).toBe('2026-06-30T21:15:00.000Z');
  });

  test('missing end (timed) → defaults to a 1-hour duration', async () => {
    const row = await create({ start_time: '2026-06-30T20:15:00Z' });
    expect(row.end_time).toBe('2026-06-30T21:15:00.000Z');
  });

  test('a real end after the start is left untouched', async () => {
    const row = await create({ start_time: '2026-06-30T20:15:00Z', end_time: '2026-06-30T22:00:00Z' });
    expect(row.end_time).toBe('2026-06-30T22:00:00Z');
  });

  test('a deliberately short (30-min) duration is respected', async () => {
    const row = await create({ start_time: '2026-06-30T20:15:00Z', end_time: '2026-06-30T20:45:00Z' });
    expect(row.end_time).toBe('2026-06-30T20:45:00Z');
  });

  test('all-day event keeps its end as given (no hour added)', async () => {
    const row = await create({ start_time: '2026-06-30T00:00:00Z', end_time: '2026-06-30T00:00:00Z', all_day: true });
    expect(row.end_time).toBe('2026-06-30T00:00:00Z');
    expect(row.all_day).toBe(true);
  });
});
