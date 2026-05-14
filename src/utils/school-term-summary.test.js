const { summariseSchoolTermDates } = require('./school-term-summary');

describe('summariseSchoolTermDates', () => {
  // Realistic SA fixture matching the data the AI gets for an
  // SA household with Herzlia's 2026 calendar imported.
  const herzlia = { id: 'school-h', school_name: 'Herzlia' };
  const dates = [
    { school_id: 'school-h', event_type: 'term_start', date: '2026-01-14', label: 'First Term Starts' },
    { school_id: 'school-h', event_type: 'term_end',   date: '2026-03-27', label: 'First Term Ends' },
    { school_id: 'school-h', event_type: 'term_start', date: '2026-04-14', label: 'Second Term Starts' },
    { school_id: 'school-h', event_type: 'term_end',   date: '2026-06-26', label: 'Second Term Ends' },
    { school_id: 'school-h', event_type: 'term_start', date: '2026-07-21', label: 'Third Term Starts' },
    { school_id: 'school-h', event_type: 'term_end',   date: '2026-09-18', label: 'Third Term Ends' },
    { school_id: 'school-h', event_type: 'term_start', date: '2026-09-30', label: 'Fourth Term Starts' },
    { school_id: 'school-h', event_type: 'term_end',   date: '2026-12-03', label: 'Fourth Term Ends' },
    { school_id: 'school-h', event_type: 'bank_holiday', date: '2026-05-15', label: 'Yom Yerushalayim' },
    { school_id: 'school-h', event_type: 'bank_holiday', date: '2026-05-22', label: 'Shavuot — School Closed' },
    { school_id: 'school-h', event_type: 'bank_holiday', date: '2026-04-22', label: 'Yom Ha\'atzmaut' }, // past
  ];

  it('returns empty string when there are no schools', () => {
    expect(summariseSchoolTermDates([], dates)).toBe('');
  });

  it('returns empty string when there are no term dates', () => {
    expect(summariseSchoolTermDates([herzlia], [])).toBe('');
  });

  it('marks the current term and ranks others', () => {
    const today = new Date('2026-05-14T12:00:00Z');
    const out = summariseSchoolTermDates([herzlia], dates, today);
    expect(out).toContain('Herzlia');
    expect(out).toContain('First Term: 14 Jan 2026 – 27 Mar 2026 (past)');
    expect(out).toContain('Second Term: 14 Apr 2026 – 26 Jun 2026 (CURRENT — ends in 43 days)');
    expect(out).toContain('Third Term: 21 Jul 2026 – 18 Sept 2026');
  });

  it('lists upcoming closures and skips past ones', () => {
    const today = new Date('2026-05-14T12:00:00Z');
    const out = summariseSchoolTermDates([herzlia], dates, today);
    expect(out).toContain('15 May 2026: Yom Yerushalayim');
    expect(out).toContain('22 May 2026: Shavuot — School Closed');
    // Past holiday should NOT appear
    expect(out).not.toContain('Yom Ha\'atzmaut');
  });

  it('skips schools that have no matching term-date rows', () => {
    const other = { id: 'school-x', school_name: 'Other School' };
    const today = new Date('2026-05-14T12:00:00Z');
    const out = summariseSchoolTermDates([herzlia, other], dates, today);
    expect(out).toContain('Herzlia');
    expect(out).not.toContain('Other School');
  });

  it('handles a household with multiple schools', () => {
    const wolfson = { id: 'school-w', school_name: 'Wolfson Primary' };
    const wDates = [
      { school_id: 'school-w', event_type: 'term_start', date: '2026-04-13', label: 'Summer term starts' },
      { school_id: 'school-w', event_type: 'term_end',   date: '2026-07-22', label: 'Summer term ends' },
    ];
    const today = new Date('2026-05-14T12:00:00Z');
    const out = summariseSchoolTermDates([herzlia, wolfson], [...dates, ...wDates], today);
    expect(out).toContain('Herzlia');
    expect(out).toContain('Wolfson Primary');
    expect(out).toContain('Summer term: 13 Apr 2026 – 22 Jul 2026 (CURRENT');
  });
});
