// queries.js requires ./client at load (needs Supabase env); stub it.
jest.mock('./client', () => ({ supabaseAdmin: {}, supabase: {}, getUserClient: () => ({}), testConnection: () => {} }));
const { completeShoppingItemsByName } = require('./queries');

// Each from() returns a fresh builder. The select chain (select→eq→eq) is
// awaited directly and yields incomplete items; the update chain
// (update→in→select) yields the updated rows.
function fakeDb(items) {
  return {
    from() {
      let mode = 'select';
      let updateIds = null;
      const b = {
        select() { return b; },
        update() { mode = 'update'; return b; },
        eq() { return b; },
        in(_col, vals) { updateIds = vals; return b; },
        then(resolve) {
          if (mode === 'update') {
            resolve({ data: items.filter((i) => updateIds.includes(i.id)).map((i) => ({ ...i, completed: true })), error: null });
          } else {
            resolve({ data: items.filter((i) => !i.completed), error: null });
          }
        },
      };
      return b;
    },
  };
}

describe('completeShoppingItemsByName over-match guard', () => {
  test('"milk" checks off ONLY milk, not almond milk or milk chocolate', async () => {
    const items = [
      { id: 'a', item: 'milk', completed: false },
      { id: 'b', item: 'almond milk', completed: false },
      { id: 'c', item: 'milk chocolate', completed: false },
    ];
    const done = await completeShoppingItemsByName('hh', ['milk'], fakeDb(items));
    expect(done.map((d) => d.id)).toEqual(['a']);
  });

  test('two requested names check off one item each', async () => {
    const items = [
      { id: 'a', item: 'milk', completed: false },
      { id: 'b', item: 'eggs', completed: false },
      { id: 'c', item: 'bread', completed: false },
    ];
    const done = await completeShoppingItemsByName('hh', ['milk', 'eggs'], fakeDb(items));
    expect(done.map((d) => d.id).sort()).toEqual(['a', 'b']);
  });

  test('no exact match → picks a single best fuzzy item, not all', async () => {
    const items = [
      { id: 'a', item: 'almond milk', completed: false },
      { id: 'b', item: 'milk chocolate', completed: false },
    ];
    const done = await completeShoppingItemsByName('hh', ['milk'], fakeDb(items));
    expect(done.length).toBe(1);
  });

  test('returns [] when nothing matches', async () => {
    const items = [{ id: 'a', item: 'bread', completed: false }];
    const done = await completeShoppingItemsByName('hh', ['milk'], fakeDb(items));
    expect(done).toEqual([]);
  });
});
