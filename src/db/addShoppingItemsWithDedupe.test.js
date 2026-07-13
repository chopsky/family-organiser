// queries.js requires ./client at load (needs Supabase env); stub it.
jest.mock('./client', () => ({ supabaseAdmin: {}, supabase: {}, getUserClient: () => ({}), testConnection: () => {} }));
const { addShoppingItemsWithDedupe } = require('./queries');

/**
 * Chainable stub over one list's rows. The first awaited select yields ALL
 * rows (active + completed - the dedupe pass partitions them itself); an
 * update chain (update→eq→select→single) applies the patch to the matching
 * row and yields it; an insert chain yields the inserted rows.
 */
function fakeDb(rows) {
  return {
    from() {
      let mode = 'select';
      let patch = null;
      let targetId = null;
      let inserted = null;
      const b = {
        select() { return b; },
        update(p) { mode = 'update'; patch = p; return b; },
        insert(r) { mode = 'insert'; inserted = r.map((x, i) => ({ id: `new-${i}`, ...x })); return b; },
        eq(col, val) { if (mode === 'update' && col === 'id') targetId = val; return b; },
        in() { return b; },
        single() { return b; },
        then(resolve) {
          if (mode === 'update') {
            const row = rows.find((r) => r.id === targetId);
            Object.assign(row, patch);
            resolve({ data: { ...row }, error: null });
          } else if (mode === 'insert') {
            resolve({ data: inserted, error: null });
          } else {
            resolve({ data: rows.map((r) => ({ ...r })), error: null });
          }
        },
      };
      return b;
    },
  };
}

describe('addShoppingItemsWithDedupe: completed twins reactivate instead of duplicating', () => {
  test('re-adding a ticked-off item revives the Done row (no second row)', async () => {
    const rows = [
      { id: 'done-1', list_id: 'l1', item: 'Beef Sausages', completed: true, completed_at: '2026-07-10T10:00:00Z' },
    ];
    const { created, duplicates, updated } = await addShoppingItemsWithDedupe(
      'hh', [{ item: 'beef sausages', list_id: 'l1' }], 'u1', {}, fakeDb(rows),
    );
    expect(created).toEqual([]); // nothing inserted
    expect(duplicates).toEqual([]);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ id: 'done-1', completed: false, completed_at: null });
  });

  test('an ACTIVE twin still wins over a completed one (plain duplicate, no revive)', async () => {
    const rows = [
      { id: 'act-1', list_id: 'l1', item: 'milk', completed: false },
      { id: 'done-1', list_id: 'l1', item: 'Milk', completed: true, completed_at: '2026-07-10T10:00:00Z' },
    ];
    const { created, duplicates, updated } = await addShoppingItemsWithDedupe(
      'hh', [{ item: 'milk', list_id: 'l1' }], 'u1', {}, fakeDb(rows),
    );
    expect(created).toEqual([]);
    expect(updated).toEqual([]);
    expect(duplicates).toHaveLength(1);
    expect(rows.find((r) => r.id === 'done-1').completed).toBe(true); // untouched
  });

  test('the MOST RECENTLY completed twin is the one revived; new quantity carries over', async () => {
    const rows = [
      { id: 'old', list_id: 'l1', item: 'eggs', completed: true, completed_at: '2026-06-01T10:00:00Z' },
      { id: 'recent', list_id: 'l1', item: 'Eggs', completed: true, completed_at: '2026-07-10T10:00:00Z' },
    ];
    const { updated } = await addShoppingItemsWithDedupe(
      'hh', [{ item: 'eggs', list_id: 'l1', quantity: '12' }], 'u1', {}, fakeDb(rows),
    );
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ id: 'recent', completed: false, quantity: '12' });
    expect(rows.find((r) => r.id === 'old').completed).toBe(true);
  });

  test('a genuinely new item still inserts', async () => {
    const rows = [
      { id: 'done-1', list_id: 'l1', item: 'bread', completed: true, completed_at: '2026-07-10T10:00:00Z' },
    ];
    const { created, updated } = await addShoppingItemsWithDedupe(
      'hh', [{ item: 'butter', list_id: 'l1' }], 'u1', {}, fakeDb(rows),
    );
    expect(created).toHaveLength(1);
    expect(updated).toEqual([]);
  });
});
