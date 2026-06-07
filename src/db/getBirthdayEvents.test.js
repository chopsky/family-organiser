// queries.js imports the real Supabase client at load-time, which needs env
// vars. Mock it to a no-op; the helper takes its db via the explicit argument.
jest.mock('./client', () => ({ supabase: {}, supabaseAdmin: {} }));
const { getBirthdayEvents } = require('./queries');

// Minimal chainable mock of the supabase query builder used by
// getBirthdayEvents: from(...).select(...).eq(...).not(...) → { data }.
function mockDb(members) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    not: () => Promise.resolve({ data: members, error: null }),
  };
  return { from: () => chain };
}

describe('getBirthdayEvents', () => {
  test('synthesises one all-day birthday per member within the window', async () => {
    const db = mockDb([
      { id: 'u1', name: 'Sarah', birthday: '1988-06-14' },
      { id: 'u2', name: 'Henry', birthday: '2020-09-08' },
    ]);
    const out = await getBirthdayEvents('h1', '2026-01-01', '2026-12-31', db);
    expect(out).toHaveLength(2);
    const sarah = out.find((e) => e.source_user_id === 'u1');
    expect(sarah.start_time).toBe('2026-06-14T00:00:00Z');
    expect(sarah.title).toBe("Sarah's Birthday 🎂");
    expect(sarah.all_day).toBe(true);
    expect(sarah.category).toBe('birthday');
  });

  test('recurs every year - one occurrence per year in a multi-year window', async () => {
    const db = mockDb([{ id: 'u1', name: 'Sarah', birthday: '1988-06-14' }]);
    const out = await getBirthdayEvents('h1', '2025-01-01', '2027-12-31', db);
    expect(out.map((e) => e.start_time)).toEqual([
      '2025-06-14T00:00:00Z',
      '2026-06-14T00:00:00Z',
      '2027-06-14T00:00:00Z',
    ]);
  });

  test('only includes occurrences inside the requested window', async () => {
    const db = mockDb([{ id: 'u1', name: 'Sarah', birthday: '1988-06-14' }]);
    // Window ends before this year's birthday → no occurrence.
    const out = await getBirthdayEvents('h1', '2026-01-01', '2026-05-31', db);
    expect(out).toHaveLength(0);
  });

  test('clamps a 29 Feb birthday to 28 Feb in non-leap years', async () => {
    const db = mockDb([{ id: 'u1', name: 'Leapy', birthday: '2000-02-29' }]);
    const out = await getBirthdayEvents('h1', '2027-01-01', '2027-12-31', db); // 2027 not leap
    expect(out[0].start_time).toBe('2027-02-28T00:00:00Z');
  });

  test('skips members with no birthday', async () => {
    const db = mockDb([{ id: 'u1', name: 'NoDOB', birthday: null }]);
    const out = await getBirthdayEvents('h1', '2026-01-01', '2026-12-31', db);
    expect(out).toHaveLength(0);
  });
});
