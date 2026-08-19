/**
 * Unit tests for the seasonal cross-council derivations. The named cases are
 * real incidents from the 2026-08-19 data-verification pass - each one
 * produced a wrong claim when derivation was done naively.
 */
const { summariseSeason, breakWindow } = require('./termDatesSeasonal');

const AY = '2026-2027';
const OCT = { ay: AY, mode: 'break', from: '2026-10-01', to: '2026-11-15' };
const row = (la_id, event_type, date, end_date = null, label = null) =>
  ({ la_id, academic_year: AY, event_type, date, end_date, label });

describe('breakWindow', () => {
  test('the Manchester notation trap: break-up/return pairs equal the holiday-week form', () => {
    // Manchester publishes "term ends Fri 23 Oct / reopens Mon 2 Nov";
    // Stockport publishes "half term 26-30 Oct". Same five weekdays off.
    const manchester = [
      row('m', 'term_end', '2026-10-23'),
      row('m', 'term_start', '2026-11-02'),
    ];
    const stockport = [
      row('s', 'half_term_start', '2026-10-26', '2026-10-30'),
    ];
    const a = breakWindow(manchester, OCT);
    const b = breakWindow(stockport, OCT);
    expect(a).toMatchObject({ first: '2026-10-26', last: '2026-10-30', weekdays: 5 });
    expect(b).toMatchObject({ first: '2026-10-26', last: '2026-10-30', weekdays: 5 });
  });

  test('the Bexley trap: a school-scoped two-week row never overrides the council structure', () => {
    const bexley = [
      row('b', 'half_term_start', '2026-10-19', '2026-10-30', 'Two-week half term (Birkbeck, Crook Log, Danson Primary)'),
      row('b', 'term_end', '2026-10-23'),
      row('b', 'half_term_start', '2026-10-26', '2026-10-30', 'Half term holiday'),
      row('b', 'term_start', '2026-11-02'),
    ];
    expect(breakWindow(bexley, OCT)).toMatchObject({ first: '2026-10-26', last: '2026-10-30', weekdays: 5 });
  });

  test('a genuine two-week council (Rutland pattern) derives 10 weekdays', () => {
    const rutland = [
      row('r', 'term_end', '2026-10-16'),
      row('r', 'term_start', '2026-11-02'),
    ];
    expect(breakWindow(rutland, OCT)).toMatchObject({ first: '2026-10-19', last: '2026-10-30', weekdays: 10 });
  });

  test('school-scoped fallback rows are skipped entirely', () => {
    const rows = [row('x', 'half_term_start', '2026-10-19', '2026-10-23', 'Thames View Infants/Junior half term break')];
    expect(breakWindow(rows, OCT)).toBeNull();
  });

  test('implausibly long gaps (a whole missing term) are rejected, not reported as a break', () => {
    const rows = [
      row('x', 'term_end', '2026-10-02'),
      row('x', 'term_start', '2026-11-30'), // 40+ weekday gap = missing data, not a holiday
    ];
    expect(breakWindow(rows, { ay: AY, mode: 'break', from: '2026-09-20', to: '2026-12-05' })).toBeNull();
  });
});

describe('isSchoolScoped filtering (via firstDayBack)', () => {
  const { firstDayBack } = require('./termDatesSeasonal');
  test("the Leicester label trap: council-wide 'Schools open' labels are NOT school-scoped", () => {
    const rows = [{ event_type: 'term_start', date: '2026-08-24', end_date: null, label: 'Autumn Term begins - Schools open' }];
    expect(firstDayBack(rows, { from: '2026-08-10', to: '2026-09-30' })).toBe('2026-08-24');
  });
  test('a named school IS school-scoped', () => {
    const rows = [{ event_type: 'term_start', date: '2026-08-24', end_date: null, label: 'Godwin Primary opens early' }];
    expect(firstDayBack(rows, { from: '2026-08-10', to: '2026-09-30' })).toBeNull();
  });
});

describe('summariseSeason', () => {
  const AUTHS = [
    { id: 'a', name: 'Aleshire', slug: 'aleshire' },
    { id: 'b', name: 'Beeshire', slug: 'beeshire' },
    { id: 'c', name: 'Ceeshire', slug: 'ceeshire' },
  ];

  test('start mode groups councils by first day back and lists the unresolved', () => {
    const entries = [
      row('a', 'term_start', '2026-09-01'),
      row('b', 'term_start', '2026-09-01'),
      // Ceeshire has no start row in the window -> unresolved, never guessed.
      row('c', 'term_start', '2027-01-04'),
    ];
    const r = summariseSeason(AUTHS, entries, { ay: AY, mode: 'start', from: '2026-08-10', to: '2026-09-30' });
    expect(r.groups).toEqual([
      expect.objectContaining({ first: '2026-09-01', count: 2 }),
    ]);
    expect(r.unresolved).toEqual([{ name: 'Ceeshire', slug: 'ceeshire' }]);
  });

  test('end mode picks the latest term end in the window (summer break-up)', () => {
    const entries = [
      row('a', 'term_end', '2027-07-21'),
      row('a', 'term_end', '2027-05-28'), // half-term boundary, earlier - not the break-up
    ];
    const r = summariseSeason(AUTHS.slice(0, 1), entries, { ay: AY, mode: 'end', from: '2027-05-01', to: '2027-08-10' });
    expect(r.perCouncil[0]).toMatchObject({ slug: 'aleshire', first: '2027-07-21' });
  });

  test('rows from other academic years are invisible', () => {
    const entries = [{ la_id: 'a', academic_year: '2025-2026', event_type: 'term_start', date: '2026-09-01', end_date: null, label: null }];
    const r = summariseSeason(AUTHS.slice(0, 1), entries, { ay: AY, mode: 'start', from: '2026-08-10', to: '2026-09-30' });
    expect(r.unresolved).toHaveLength(1);
  });
});
