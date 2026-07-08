jest.mock('./client', () => ({ supabase: {}, supabaseAdmin: {}, getUserClient: () => ({}), testConnection: () => {} }));
const { addTasks } = require('./queries');

// Fake db that captures the rows handed to .insert() and echoes them back.
const fakeDb = (captured) => ({
  from: () => ({
    insert: (rows) => {
      captured.push(...rows);
      return { select: () => Promise.resolve({ data: rows, error: null }) };
    },
  }),
});

describe('addTasks due_date resolution', () => {
  const today = new Date().toISOString().split('T')[0];

  test('no due_date defaults to today (digest/badge/bot views rely on it)', async () => {
    const rows = [];
    await addTasks('h1', [{ title: 'Buy milk' }], 'u1', [], fakeDb(rows));
    expect(rows[0].due_date).toBe(today);
  });

  test('explicit null still defaults to today (LLM channels emit nulls)', async () => {
    const rows = [];
    await addTasks('h1', [{ title: 'Buy milk', due_date: null }], 'u1', [], fakeDb(rows));
    expect(rows[0].due_date).toBe(today);
  });

  test("sentinel 'none' creates a genuinely undated task (Lists Someday adds)", async () => {
    const rows = [];
    await addTasks('h1', [{ title: 'Repaint the fence', due_date: 'none' }], 'u1', [], fakeDb(rows));
    expect(rows[0].due_date).toBeNull();
  });

  test('a real date passes through untouched', async () => {
    const rows = [];
    await addTasks('h1', [{ title: 'Dentist forms', due_date: '2026-09-01' }], 'u1', [], fakeDb(rows));
    expect(rows[0].due_date).toBe('2026-09-01');
  });
});
