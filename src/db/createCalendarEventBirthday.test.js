jest.mock('./client', () => ({ supabase: {}, supabaseAdmin: {} }));
const { createCalendarEvent } = require('./queries');

// Capture the row passed to insert() without touching a real DB.
function captureDb() {
  const state = {};
  const chain = {
    insert: (row) => { state.row = row; return chain; },
    select: () => chain,
    single: () => Promise.resolve({ data: { id: 'evt1', ...state.row }, error: null }),
  };
  return { db: { from: () => chain }, state };
}

async function create(title, extra = {}) {
  const { db, state } = captureDb();
  await createCalendarEvent('h1', {
    title, start_time: '2026-06-14T00:00:00Z', end_time: '2026-06-14T00:00:00Z', ...extra,
  }, 'u1', db);
  return state.row;
}

describe('createCalendarEvent birthday auto-categorisation', () => {
  test('birthday → categorised, but does NOT auto-recur; title kept verbatim', async () => {
    const row = await create("Mia's birthday");
    expect(row.category).toBe('birthday');
    expect(row.recurrence).toBe(null);
    expect(row.title).toBe("Mia's birthday");
  });

  test('age-specific birthday → categorised, title kept exactly as typed', async () => {
    const row = await create("Mia's 7th birthday");
    expect(row.category).toBe('birthday');
    expect(row.recurrence).toBe(null);
    expect(row.title).toBe("Mia's 7th birthday");
  });

  test('errand mentioning a birthday → not categorised', async () => {
    const row = await create('Buy birthday gift for John');
    expect(row.category).toBe('general');
  });

  test('explicit recurrence from caller is preserved', async () => {
    const row = await create("Mia's birthday", { recurrence: 'yearly' });
    expect(row.category).toBe('birthday');
    expect(row.recurrence).toBe('yearly');
  });

  test('non-birthday event is unaffected', async () => {
    const row = await create('Dentist appointment');
    expect(row.category).toBe('general');
    expect(row.recurrence).toBe(null);
  });
});
