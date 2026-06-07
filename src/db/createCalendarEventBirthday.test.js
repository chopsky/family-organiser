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
  test('age-agnostic birthday → category birthday, recurs yearly, title unchanged', async () => {
    const row = await create("Mia's birthday");
    expect(row.category).toBe('birthday');
    expect(row.recurrence).toBe('yearly');
    expect(row.title).toBe("Mia's birthday");
  });

  test('age-specific birthday → recurs yearly with the age stripped from the title', async () => {
    const row = await create("Mia's 7th birthday");
    expect(row.category).toBe('birthday');
    expect(row.recurrence).toBe('yearly');
    expect(row.title).toBe("Mia's birthday");
  });

  test('milestone age is stripped too (80th → recurring "Grandma\'s birthday")', async () => {
    const row = await create("Grandma's 80th birthday");
    expect(row.recurrence).toBe('yearly');
    expect(row.title).toBe("Grandma's birthday");
  });

  test('errand mentioning a birthday → not categorised, no recurrence', async () => {
    const row = await create('Buy birthday gift for John');
    expect(row.category).toBe('general');
    expect(row.recurrence).toBe(null);
  });

  test('explicit recurrence from caller is preserved', async () => {
    const row = await create("Mia's birthday", { recurrence: 'monthly' });
    expect(row.category).toBe('birthday');
    expect(row.recurrence).toBe('monthly');
  });

  test('non-birthday event is unaffected', async () => {
    const row = await create('Dentist appointment');
    expect(row.category).toBe('general');
    expect(row.recurrence).toBe(null);
  });
});
