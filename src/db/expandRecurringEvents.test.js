jest.mock('./client', () => ({ supabase: {}, supabaseAdmin: {}, getUserClient: () => ({}), testConnection: () => {} }));
const { expandRecurringEvents } = require('./queries');

const ev = (over = {}) => ({
  id: 'e1', title: 'Arts club', recurrence: 'weekly',
  start_time: '2026-09-08T15:30:00.000Z', end_time: '2026-09-08T17:30:00.000Z',
  ...over,
});

describe('expandRecurringEvents', () => {
  test('weekly event materialises every occurrence inside the window', () => {
    const out = expandRecurringEvents([ev()], '2026-09-01T00:00:00Z', '2026-09-30T23:59:59Z');
    const dates = out.map((o) => o.start_time.slice(0, 10));
    expect(dates).toEqual(['2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29']);
  });

  test('occurrences keep the series id but get a unique occurrence_key', () => {
    const out = expandRecurringEvents([ev()], '2026-09-01T00:00:00Z', '2026-09-22T23:59:59Z');
    expect(out.every((o) => o.id === 'e1')).toBe(true);
    expect(new Set(out.map((o) => o.occurrence_key)).size).toBe(out.length);
    expect(out[0].recurrence_instance).toBe(false); // base
    expect(out[1].recurrence_instance).toBe(true);  // repeat
  });

  test('window after the base still yields occurrences (row sits in the past)', () => {
    const out = expandRecurringEvents([ev()], '2026-10-01T00:00:00Z', '2026-10-31T23:59:59Z');
    expect(out.map((o) => o.start_time.slice(0, 10))).toEqual([
      '2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27',
    ]);
  });

  test('preserves event duration', () => {
    const out = expandRecurringEvents([ev()], '2026-09-08T00:00:00Z', '2026-09-15T23:59:59Z');
    const dur = new Date(out[0].end_time) - new Date(out[0].start_time);
    expect(dur).toBe(2 * 60 * 60 * 1000); // 2 hours
  });

  test('non-recurring events are ignored', () => {
    expect(expandRecurringEvents([ev({ recurrence: null })], '2026-09-01', '2026-12-31')).toEqual([]);
  });

  test('monthly + yearly cadences', () => {
    const monthly = expandRecurringEvents([ev({ recurrence: 'monthly' })], '2026-09-01', '2026-12-31');
    expect(monthly.map((o) => o.start_time.slice(0, 10))).toEqual(['2026-09-08', '2026-10-08', '2026-11-08', '2026-12-08']);
    const yearly = expandRecurringEvents([ev({ recurrence: 'yearly' })], '2026-01-01', '2028-12-31');
    expect(yearly.map((o) => o.start_time.slice(0, 7))).toEqual(['2026-09', '2027-09', '2028-09']);
  });

  // "Delete just this day": a skipSet entry of `${id}|${UTC date}` hides
  // exactly that occurrence; the series continues either side of it.
  test('skipSet suppresses a single occurrence, neighbours survive', () => {
    const skips = new Set(['e1|2026-09-15']);
    const out = expandRecurringEvents([ev()], '2026-09-01T00:00:00Z', '2026-09-30T23:59:59Z', 500, skips);
    expect(out.map((o) => o.start_time.slice(0, 10))).toEqual(['2026-09-08', '2026-09-22', '2026-09-29']);
  });

  test('skipSet only affects the event it names', () => {
    const other = ev({ id: 'e2' });
    const skips = new Set(['e1|2026-09-15']);
    const out = expandRecurringEvents([ev(), other], '2026-09-14T00:00:00Z', '2026-09-16T23:59:59Z', 500, skips);
    expect(out.map((o) => `${o.id}:${o.start_time.slice(0, 10)}`)).toEqual(['e2:2026-09-15']);
  });

  test('skipping the BASE occurrence still keeps the repeats', () => {
    const skips = new Set(['e1|2026-09-08']);
    const out = expandRecurringEvents([ev()], '2026-09-01T00:00:00Z', '2026-09-30T23:59:59Z', 500, skips);
    expect(out.map((o) => o.start_time.slice(0, 10))).toEqual(['2026-09-15', '2026-09-22', '2026-09-29']);
  });
});
