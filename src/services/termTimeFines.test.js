const {
  classifyAbsence, estimateFines, meetsThreshold, nearestBreak, countryOf, RULES, MAX_RANGE_DAYS, clampCounts, ayOf,
} = require('./termTimeFines');

// A split-notation council: each term published as two intervals around half
// term, plus one INSET day and a single-day closure.
const ROWS = [
  { academic_year: '2026-2027', event_type: 'term_start', date: '2026-09-02', end_date: null, label: 'Autumn term starts' },
  { academic_year: '2026-2027', event_type: 'term_end', date: '2026-10-23', end_date: null, label: null },
  { academic_year: '2026-2027', event_type: 'term_start', date: '2026-11-02', end_date: null, label: null },
  { academic_year: '2026-2027', event_type: 'term_end', date: '2026-12-18', end_date: null, label: null },
  { academic_year: '2026-2027', event_type: 'term_start', date: '2027-01-05', end_date: null, label: null },
  { academic_year: '2026-2027', event_type: 'term_end', date: '2027-02-12', end_date: null, label: null },
  { academic_year: '2026-2027', event_type: 'term_start', date: '2027-02-22', end_date: null, label: null },
  { academic_year: '2026-2027', event_type: 'term_end', date: '2027-03-26', end_date: null, label: null },
  { academic_year: '2026-2027', event_type: 'term_start', date: '2027-04-12', end_date: null, label: null },
  { academic_year: '2026-2027', event_type: 'term_end', date: '2027-05-28', end_date: null, label: null },
  { academic_year: '2026-2027', event_type: 'term_start', date: '2027-06-07', end_date: null, label: null },
  { academic_year: '2026-2027', event_type: 'term_end', date: '2027-07-21', end_date: null, label: null },
  { academic_year: '2026-2027', event_type: 'inset_day', date: '2026-09-01', end_date: null, label: 'INSET day' },
  { academic_year: '2026-2027', event_type: 'inset_day', date: '2026-11-27', end_date: null, label: 'INSET day' },
  // School-scoped row must NOT count as a council-wide closure.
  { academic_year: '2026-2027', event_type: 'inset_day', date: '2026-11-30', end_date: null, label: 'Alder Grange School INSET' },
];

// Single-interval notation (one autumn term row) with the half term as a range.
const SINGLE_ROWS = [
  { academic_year: '2026-2027', event_type: 'term_start', date: '2026-09-01', end_date: null, label: null },
  { academic_year: '2026-2027', event_type: 'term_end', date: '2026-12-18', end_date: null, label: null },
  { academic_year: '2026-2027', event_type: 'half_term_start', date: '2026-10-26', end_date: '2026-10-30', label: 'Half term' },
  { academic_year: '2026-2027', event_type: 'term_start', date: '2027-01-04', end_date: null, label: null },
  { academic_year: '2026-2027', event_type: 'term_end', date: '2027-03-26', end_date: null, label: null },
];

describe('classifyAbsence', () => {
  it('counts only weekdays in term time as school days', () => {
    // Mon 9 Nov - Sun 15 Nov 2026: five school days + weekend.
    const r = classifyAbsence({ fromIso: '2026-11-09', toIso: '2026-11-15', rows: ROWS });
    expect(r.ok).toBe(true);
    expect(r.schoolDays).toBe(5);
    expect(r.sessions).toBe(10);
    expect(r.byKind.weekend).toBe(2);
  });

  it('does not count bank holidays, council INSET days or published breaks', () => {
    // Fri 23 Oct (school) .. Mon 2 Nov (school) with half term between.
    const r = classifyAbsence({ fromIso: '2026-10-23', toIso: '2026-11-02', rows: ROWS });
    expect(r.schoolDays).toBe(2);
    expect(r.byKind.holiday).toBe(5);
    // INSET Fri 27 Nov: a week containing it is four school days, not five.
    const wk = classifyAbsence({ fromIso: '2026-11-23', toIso: '2026-11-27', rows: ROWS });
    expect(wk.schoolDays).toBe(4);
    expect(wk.byKind.closure).toBe(1);
    // Early May bank holiday (Mon 3 May 2027) inside term time.
    const may = classifyAbsence({ fromIso: '2027-05-03', toIso: '2027-05-07', rows: ROWS, bankHolidayDates: ['2027-05-03'] });
    expect(may.schoolDays).toBe(4);
    expect(may.byKind.bankHoliday).toBe(1);
  });

  it('ignores school-scoped INSET rows when deciding council-wide closures', () => {
    const r = classifyAbsence({ fromIso: '2026-11-30', toIso: '2026-11-30', rows: ROWS });
    expect(r.schoolDays).toBe(1);
  });

  it('treats a half-term RANGE row as a break for single-interval councils', () => {
    const r = classifyAbsence({ fromIso: '2026-10-26', toIso: '2026-10-30', rows: SINGLE_ROWS });
    expect(r.schoolDays).toBe(0);
    expect(r.byKind.holiday).toBe(5);
  });

  it('flags dates the council has not published a year for, without counting them', () => {
    const r = classifyAbsence({ fromIso: '2027-09-06', toIso: '2027-09-10', rows: ROWS });
    expect(r.ok).toBe(true);
    expect(r.schoolDays).toBe(0);
    expect(r.byKind.unknown).toBe(5);
    expect(r.coveredByCalendar).toBe(false);
  });

  it('rejects bad input clearly rather than throwing', () => {
    expect(classifyAbsence({ fromIso: 'nope', toIso: '2026-11-10', rows: ROWS })).toEqual({ ok: false, reason: 'invalid_dates' });
    expect(classifyAbsence({ fromIso: '2026-02-30', toIso: '2026-03-01', rows: ROWS }).reason).toBe('invalid_dates');
    expect(classifyAbsence({ fromIso: '2026-11-10', toIso: '2026-11-09', rows: ROWS }).reason).toBe('reversed');
    expect(classifyAbsence({ fromIso: '2026-09-01', toIso: '2026-12-01', rows: ROWS }).reason).toBe('too_long');
    expect(classifyAbsence({ fromIso: '2026-11-09', toIso: '2026-11-10', rows: [] }).reason).toBe('unresolved');
    expect(MAX_RANGE_DAYS).toBe(60);
  });
});

describe('data-shape edge cases from review', () => {
  const pair = (ay, s, e) => [
    { academic_year: ay, event_type: 'term_start', date: s, end_date: null, label: null },
    { academic_year: ay, event_type: 'term_end', date: e, end_date: null, label: null },
  ];

  it('marks a sandwiched unresolvable year as unpublished, never as holiday', () => {
    const rows = [
      ...pair('2025-2026', '2025-09-02', '2025-12-19'), ...pair('2025-2026', '2026-01-05', '2026-03-27'), ...pair('2025-2026', '2026-04-13', '2026-07-17'),
      // 2026-27 published badly: three starts, two ends -> cannot pair
      ...pair('2026-2027', '2026-09-02', '2026-12-18'), ...pair('2026-2027', '2027-01-04', '2027-03-26'),
      { academic_year: '2026-2027', event_type: 'term_start', date: '2027-04-12', end_date: null, label: null },
      ...pair('2027-2028', '2027-09-01', '2027-12-17'), ...pair('2027-2028', '2028-01-04', '2028-03-31'), ...pair('2027-2028', '2028-04-17', '2028-07-20'),
    ];
    const r = classifyAbsence({ fromIso: '2026-11-09', toIso: '2026-11-13', rows });
    expect(r.ok).toBe(true);
    expect(r.schoolDays).toBe(0);
    expect(r.byKind.unknown).toBe(5);
    expect(r.byKind.holiday).toBe(0);
    expect(r.coveredByCalendar).toBe(false);
    // ...and the gap across the missing year is not offered as a "break".
    const b = nearestBreak({ fromIso: '2026-11-09', toIso: '2026-11-13', rows });
    expect(b.weekdays).toBeLessThan(50);
  });

  it('pairs half_term_start / half_term_end single-day rows into a break', () => {
    const rows = [
      ...pair('2026-2027', '2026-09-01', '2026-12-18'),
      { academic_year: '2026-2027', event_type: 'half_term_start', date: '2026-10-26', end_date: null, label: 'Half term begins' },
      { academic_year: '2026-2027', event_type: 'half_term_end', date: '2026-10-30', end_date: null, label: 'Half term ends' },
      ...pair('2026-2027', '2027-01-04', '2027-03-26'),
    ];
    const r = classifyAbsence({ fromIso: '2026-10-26', toIso: '2026-10-30', rows });
    expect(r.schoolDays).toBe(0);
    expect(r.byKind.holiday).toBe(5);
    const b = nearestBreak({ fromIso: '2026-10-19', toIso: '2026-10-23', rows });
    expect([b.firstOff, b.lastOff]).toEqual(['2026-10-26', '2026-10-30']);
  });

  it('measures distance to the nearest break against the whole range, not just its start', () => {
    const b = nearestBreak({ fromIso: '2026-10-23', toIso: '2026-11-02', rows: ROWS });
    expect(b.name).toBe('October half term');
    expect(b.distanceDays).toBe(0);
  });

  it('clamps counts the same way everywhere', () => {
    expect(clampCounts({ parents: '', children: '' })).toEqual({ parents: 1, children: 1 });
    expect(clampCounts({ parents: 2, children: 99 })).toEqual({ parents: 2, children: 6 });
    expect(ayOf('2026-08-31')).toBe('2025-2026');
    expect(ayOf('2026-09-01')).toBe('2026-2027');
  });
});

describe('estimateFines / meetsThreshold', () => {
  it('scales per parent per child in England', () => {
    const e = estimateFines({ country: 'England', parents: 2, children: 2 });
    expect(e.notices).toBe(4);
    expect(e.firstEarlyTotal).toBe(320);
    expect(e.firstLateTotal).toBe(640);
    expect(e.secondTotal).toBe(640);
  });

  it('uses the Welsh amounts for Welsh councils and has no second-notice uplift', () => {
    expect(countryOf({ region: 'Wales' })).toBe('Wales');
    expect(countryOf({ region: 'England' })).toBe('England');
    const e = estimateFines({ country: 'Wales', parents: 1, children: 1 });
    expect(e.firstEarlyTotal).toBe(RULES.Wales.firstEarly);
    expect(e.firstLateTotal).toBe(RULES.Wales.firstLate);
    expect(e.secondTotal).toBeNull();
  });

  it('clamps silly counts', () => {
    const e = estimateFines({ country: 'England', parents: 9, children: -3 });
    expect(e.parents).toBe(2);
    expect(e.children).toBe(1);
  });

  it('applies the England threshold of 10 sessions and none for Wales', () => {
    expect(meetsThreshold('England', 8)).toBe(false);
    expect(meetsThreshold('England', 10)).toBe(true);
    expect(meetsThreshold('Wales', 10)).toBeNull();
  });
});

describe('nearestBreak', () => {
  it('finds the closest published break of at least three weekdays', () => {
    const b = nearestBreak({ fromIso: '2026-11-09', rows: ROWS });
    expect(b.name).toBe('October half term');
    expect(b.firstOff).toBe('2026-10-24');
    expect(b.lastOff).toBe('2026-11-01');
    expect(b.weekdays).toBe(5);
  });

  it('reports distance zero when the chosen dates are already inside a break', () => {
    const b = nearestBreak({ fromIso: '2026-12-28', rows: ROWS });
    expect(b.name).toBe('Christmas holidays');
    expect(b.distanceDays).toBe(0);
  });

  it('uses range rows for single-interval councils', () => {
    const b = nearestBreak({ fromIso: '2026-10-19', rows: SINGLE_ROWS });
    expect(b.firstOff).toBe('2026-10-26');
    expect(b.lastOff).toBe('2026-10-30');
  });

  it('returns null when the calendar cannot be resolved', () => {
    expect(nearestBreak({ fromIso: '2026-10-19', rows: [] })).toBeNull();
  });
});
