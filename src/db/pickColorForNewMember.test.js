// queries.js requires the real Supabase client at import-time, which
// in turn demands SUPABASE_URL etc. env vars. Mock the client to a
// no-op so the helper-under-test can import cleanly without us having
// to expose those credentials in CI. Every method called on the helper
// is provided via the explicit `db` argument below, not the module
// default, so the mock just has to be importable.
jest.mock('./client', () => ({ supabase: {}, supabaseAdmin: {} }));
const { pickColorForNewMember, COLOR_THEMES } = require('./queries');

// Tiny chainable-builder mock that mimics the supabase-js query builder
// surface the helper actually uses: from(table).select(cols).eq(col, val).
function mockDbWithMembers(members) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return Promise.resolve({ data: members, error: null });
            },
          };
        },
      };
    },
  };
}

describe('pickColorForNewMember', () => {
  it('returns the first colour for an empty household', async () => {
    const db = mockDbWithMembers([]);
    const result = await pickColorForNewMember('hh-1', db);
    expect(result).toBe(COLOR_THEMES[0]); // 'red'
  });

  it('returns the next unused colour when some are taken', async () => {
    const db = mockDbWithMembers([
      { color_theme: 'red' },
      { color_theme: 'burnt-orange' },
    ]);
    const result = await pickColorForNewMember('hh-1', db);
    expect(result).toBe(COLOR_THEMES[2]); // 'amber'
  });

  it('skips a NULL colour_theme and treats it as available', async () => {
    const db = mockDbWithMembers([
      { color_theme: 'red' },
      { color_theme: null }, // a user without an assigned colour yet
    ]);
    const result = await pickColorForNewMember('hh-1', db);
    expect(result).toBe(COLOR_THEMES[1]); // 'burnt-orange', not skipped
  });

  it('returns a colour from the list when all 16 are used', async () => {
    const db = mockDbWithMembers(COLOR_THEMES.map((c) => ({ color_theme: c })));
    const result = await pickColorForNewMember('hh-1', db);
    expect(COLOR_THEMES).toContain(result);
  });

  it('returns the first colour when householdId is falsy', async () => {
    const db = mockDbWithMembers([]); // shouldn't be queried
    const result = await pickColorForNewMember(null, db);
    expect(result).toBe(COLOR_THEMES[0]);
  });

  it('falls back to the first colour on DB error', async () => {
    const db = {
      from() {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({ data: null, error: { message: 'boom' } });
              },
            };
          },
        };
      },
    };
    const result = await pickColorForNewMember('hh-1', db);
    expect(result).toBe(COLOR_THEMES[0]);
  });

  it('exposes 16 canonical colours in stable order', () => {
    expect(COLOR_THEMES).toHaveLength(16);
    expect(COLOR_THEMES[0]).toBe('red');
    expect(COLOR_THEMES[COLOR_THEMES.length - 1]).toBe('slate');
  });
});
