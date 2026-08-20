/**
 * Unit tests for the bank-holiday x school-calendar classification. The point
 * of the page is the annotation, so the annotation logic is what gets pinned.
 */
jest.mock('axios');
const { classifyBankHolidays, classifyDate, termIntervals } = require('./bankHolidays');

const AY = '2026-2027';
const row = (la_id, event_type, date, label = null) => ({ la_id, academic_year: AY, event_type, date, end_date: null, label });

// A standard-pattern council: three terms, each split in two.
const standard = (id) => [
  row(id, 'term_start', '2026-09-01'), row(id, 'term_end', '2026-10-23'),
  row(id, 'term_start', '2026-11-02'), row(id, 'term_end', '2026-12-18'),
  row(id, 'term_start', '2027-01-04'), row(id, 'term_end', '2027-03-25'),
  row(id, 'term_start', '2027-04-12'), row(id, 'term_end', '2027-05-28'),
  row(id, 'term_start', '2027-06-07'), row(id, 'term_end', '2027-07-21'),
];

describe('termIntervals', () => {
  test('pairs a clean structure', () => {
    expect(termIntervals(standard('x'))).toHaveLength(5);
  });
  test('the Neath Port Talbot trap: a whole-year start/end pair is not a term', () => {
    // One clean-looking pair spanning the entire school year would classify
    // Christmas Day as term time. It must be rejected as unresolvable.
    const rows = [row('x', 'term_start', '2026-09-01'), row('x', 'term_end', '2027-07-20')];
    expect(termIntervals(rows)).toBeNull();
  });

  test('returns null on unpairable structure rather than guessing', () => {
    expect(termIntervals([row('x', 'term_start', '2026-09-01')])).toBeNull();
  });
  test('school-scoped rows are excluded before pairing', () => {
    const rows = [...standard('x'), row('x', 'term_start', '2026-08-20', 'Godwin Primary opens early')];
    expect(termIntervals(rows)).toHaveLength(5); // odd row ignored, pairing intact
  });
});

describe('classifyDate', () => {
  const AUTHS = [{ id: 'a', name: 'Aleshire', slug: 'aleshire' }];

  test('May Day in term time -> extra day off', () => {
    const r = classifyDate('2027-05-03', AUTHS, standard('a'));
    expect(r.termTime).toHaveLength(1);
  });
  test('Spring bank holiday inside half term -> already off', () => {
    const r = classifyDate('2027-05-31', AUTHS, standard('a'));
    expect(r.off).toHaveLength(1);
  });
  test('Christmas Day inside the break -> already off', () => {
    const r = classifyDate('2026-12-25', AUTHS, standard('a'));
    expect(r.off).toHaveLength(1);
  });
  test('August bank holiday outside the school year -> already off', () => {
    const r = classifyDate('2026-08-31', AUTHS, standard('a'));
    expect(r.off).toHaveLength(1);
  });
  test('the single-interval notation: half term inside one long term interval is OFF, not term time', () => {
    // Many councils publish "Summer term: 12 Apr - 21 Jul" as one pair plus a
    // half-term RANGE row. The spring bank holiday sits inside that range.
    const rows = [
      row('a', 'term_start', '2027-04-12'), row('a', 'term_end', '2027-07-21'),
      { la_id: 'a', academic_year: AY, event_type: 'half_term_start', date: '2027-05-31', end_date: '2027-06-04', label: 'Half term' },
    ];
    const r = classifyDate('2027-05-31', AUTHS, rows);
    expect(r.off).toHaveLength(1);
    expect(r.termTime).toHaveLength(0);
  });

  test('unpairable council counted as unresolved, never guessed', () => {
    const r = classifyDate('2027-05-03', AUTHS, [row('a', 'term_start', '2026-09-01')]);
    expect(r.unresolved).toHaveLength(1);
  });
});

describe('classifyBankHolidays', () => {
  // Ten standard councils + one early starter, so the 90% majority threshold
  // behaves as it does at real scale (a lone outlier must not force 'mixed').
  const AUTHS = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, name: `Shire ${i}`, slug: `shire-${i}` }))
    .concat([{ id: 'lei', name: 'Earlyshire', slug: 'earlyshire' }]);
  // Earlyshire is the Leicestershire pattern: back before the August bank holiday.
  const entries = [
    ...AUTHS.slice(0, 10).flatMap((a) => standard(a.id)),
    row('lei', 'term_start', '2026-08-24'), row('lei', 'term_end', '2026-12-18'),
    row('lei', 'term_start', '2027-01-04'), row('lei', 'term_end', '2027-03-19'),
    row('lei', 'term_start', '2027-04-05'), row('lei', 'term_end', '2027-07-06'),
  ];
  const events = [
    { date: '2026-08-31', title: 'Summer bank holiday', notes: '' },
    { date: '2027-05-03', title: 'Early May bank holiday', notes: '' },
    { date: '2026-01-01', title: 'New Year (already past)', notes: '' },
  ];

  test('annotates each upcoming holiday and names small minorities', () => {
    const out = classifyBankHolidays(AUTHS, entries, events, { fromIso: '2026-08-01', untilIso: '2027-08-31' });
    expect(out).toHaveLength(2); // the past one is dropped
    const aug = out.find((e) => e.date === '2026-08-31');
    expect(aug.verdict).toBe('already-off'); // 10 of 11 in the holidays
    expect(aug.counts).toMatchObject({ termTime: 1, off: 10 });
    expect(aug.exceptions.map((e) => e.slug)).toContain('earlyshire'); // the outlier is named
    const may = out.find((e) => e.date === '2027-05-03');
    expect(may.verdict).toBe('extra-day');
    expect(may.counts.termTime).toBe(11);
  });
});
