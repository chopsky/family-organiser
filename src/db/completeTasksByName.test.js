// queries.js requires ./client at load (needs Supabase env); stub it.
jest.mock('./client', () => ({ supabaseAdmin: {}, supabase: {}, getUserClient: () => ({}), testConnection: () => {} }));
const { completeTasksByName } = require('./queries');

// Minimal supabase stub. Each from() returns a fresh builder so concurrent
// completeTask() updates don't share an id filter. The select chain is
// awaited directly (thenable -> incomplete tasks); the update chain ends in
// .single() -> the matched task.
function fakeDb(tasks) {
  return {
    from() {
      let idFilter = null;
      const b = {
        select() { return b; },
        update() { return b; },
        eq(col, val) { if (col === 'id') idFilter = val; return b; },
        single() {
          const t = tasks.find((x) => x.id === idFilter);
          return Promise.resolve({ data: t ? { ...t, completed: true } : null, error: null });
        },
        then(resolve) { resolve({ data: tasks.filter((t) => !t.completed), error: null }); },
      };
      return b;
    },
  };
}

describe('completeTasksByName over-match guard', () => {
  test('"Call EUSS" completes ONLY the EUSS task, not every "Call …" task', async () => {
    const tasks = [
      { id: '1', title: 'Call EUSS', completed: false, assigned_to_names: ['Grant'] },
      { id: '2', title: 'Call eye doctor and make new app', completed: false, assigned_to_names: ['Grant'] },
      { id: '3', title: 'Call vet to discuss Odie neutering and insurance coverage', completed: false, assigned_to_names: ['Grant'] },
      { id: '4', title: 'Buy milk', completed: false, assigned_to_names: ['Grant'] },
    ];
    const done = await completeTasksByName('hh', ['Call EUSS'], 'Grant', fakeDb(tasks));
    expect(done.map((d) => d.title)).toEqual(['Call EUSS']);
  });

  test('a short "Pay X" query does not sweep up other "Pay …" tasks', async () => {
    const tasks = [
      { id: '1', title: 'Pay Elementor', completed: false, assigned_to_names: [] },
      { id: '2', title: 'Pay the electricity bill', completed: false, assigned_to_names: [] },
    ];
    const done = await completeTasksByName('hh', ['Pay Elementor'], null, fakeDb(tasks));
    expect(done.map((d) => d.title)).toEqual(['Pay Elementor']);
  });

  test('still matches a genuine paraphrase', async () => {
    const tasks = [{ id: '1', title: "Plan Mason's party", completed: false, assigned_to_names: [] }];
    const done = await completeTasksByName('hh', ["Mason's party planning"], null, fakeDb(tasks));
    expect(done.map((d) => d.title)).toEqual(["Plan Mason's party"]);
  });

  test('returns [] when nothing matches', async () => {
    const tasks = [{ id: '1', title: 'Walk the dog', completed: false, assigned_to_names: [] }];
    const done = await completeTasksByName('hh', ['Call EUSS'], null, fakeDb(tasks));
    expect(done).toEqual([]);
  });
});
