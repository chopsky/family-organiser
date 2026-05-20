const { validateTermDates } = require('./termDateValidator');

// Fixed reference "now" so the sane-window check is deterministic.
const NOW = new Date('2026-05-18T12:00:00Z');

describe('validateTermDates', () => {
  it('returns an empty array for empty input', () => {
    expect(validateTermDates([], 'source')).toEqual([]);
  });

  it('returns rows with empty warnings when everything looks good', () => {
    const rows = validateTermDates(
      [
        { event_type: 'term_start', date: '2026-09-01', label: 'Autumn term', academic_year: '2026-2027', source_quote: 'Autumn term begins Tuesday 1 September 2026' },
        { event_type: 'term_end',   date: '2026-12-18', label: 'Autumn ends',  academic_year: '2026-2027', source_quote: 'Autumn term ends Friday 18 December 2026' },
      ],
      'Autumn term begins Tuesday 1 September 2026. Autumn term ends Friday 18 December 2026.',
      NOW
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].warnings).toEqual([]);
    expect(rows[1].warnings).toEqual([]);
  });

  it('flags a day-of-week mismatch between date and source quote', () => {
    // 2026-01-06 is a Tuesday; the quote claims Monday.
    const [row] = validateTermDates(
      [{ event_type: 'term_start', date: '2026-01-06', label: 'Spring term', academic_year: '2025-2026', source_quote: 'Spring term begins Monday 6 January 2026' }],
      'Spring term begins Monday 6 January 2026',
      NOW
    );
    expect(row.warnings.some(w => /Tuesday.*says Monday/i.test(w))).toBe(true);
  });

  it('flags term_end before term_start in the same academic year', () => {
    // After date-sort, the walk sees term_end first (no openStart → warning)
    // and then term_start with no matching close (also a warning). Either
    // flag is enough to surface the issue to the admin.
    const rows = validateTermDates(
      [
        { event_type: 'term_start', date: '2026-09-10', academic_year: '2026-2027' },
        { event_type: 'term_end',   date: '2026-09-05', academic_year: '2026-2027' },
      ],
      '',
      NOW
    );
    const endRow = rows.find(r => r.event_type === 'term_end');
    const startRow = rows.find(r => r.event_type === 'term_start');
    const flagged = endRow.warnings.some(w => /no matching term-start/i.test(w))
      || startRow.warnings.some(w => /no matching term-end/i.test(w));
    expect(flagged).toBe(true);
  });

  it('flags term_end with the same date as term_start (zero-length term)', () => {
    const rows = validateTermDates(
      [
        { event_type: 'term_start', date: '2026-09-10', academic_year: '2026-2027' },
        { event_type: 'term_end',   date: '2026-09-10', academic_year: '2026-2027' },
      ],
      '',
      NOW
    );
    const endRow = rows.find(r => r.event_type === 'term_end');
    expect(endRow.warnings.some(w => /on or before its term-start/i.test(w))).toBe(true);
  });

  it('flags a half_term that falls outside any term in the same year', () => {
    const rows = validateTermDates(
      [
        { event_type: 'term_start',      date: '2026-09-01', academic_year: '2026-2027' },
        { event_type: 'term_end',        date: '2026-10-20', academic_year: '2026-2027' },
        { event_type: 'half_term_start', date: '2026-11-15', academic_year: '2026-2027' },
      ],
      '',
      NOW
    );
    const halfRow = rows.find(r => r.event_type === 'half_term_start');
    expect(halfRow.warnings.some(w => /falls outside any term/i.test(w))).toBe(true);
  });

  it('does NOT flag a half_term that sits inside a term', () => {
    const rows = validateTermDates(
      [
        { event_type: 'term_start',      date: '2026-09-01', academic_year: '2026-2027' },
        { event_type: 'half_term_start', date: '2026-10-26', academic_year: '2026-2027' },
        { event_type: 'half_term_end',   date: '2026-10-30', academic_year: '2026-2027' },
        { event_type: 'term_end',        date: '2026-12-18', academic_year: '2026-2027' },
      ],
      '',
      NOW
    );
    const halfStart = rows.find(r => r.event_type === 'half_term_start');
    const halfEnd = rows.find(r => r.event_type === 'half_term_end');
    expect(halfStart.warnings.filter(w => /falls outside/i.test(w))).toEqual([]);
    expect(halfEnd.warnings.filter(w => /falls outside/i.test(w))).toEqual([]);
  });

  it('flags an inset_day that falls on a Saturday', () => {
    // 2026-09-05 is a Saturday.
    const [row] = validateTermDates(
      [{ event_type: 'inset_day', date: '2026-09-05', academic_year: '2026-2027' }],
      '',
      NOW
    );
    expect(row.warnings.some(w => /INSET.*Saturday/i.test(w))).toBe(true);
  });

  it('flags source_quote not found in source text (hallucination)', () => {
    const [row] = validateTermDates(
      [{ event_type: 'term_start', date: '2026-09-01', source_quote: 'Term begins on the festival of Glipnar' }],
      'Autumn term begins Tuesday 1 September 2026',
      NOW
    );
    expect(row.warnings.some(w => /may have invented/i.test(w))).toBe(true);
  });

  it('does not flag a quote that IS present (case + whitespace normalised)', () => {
    const [row] = validateTermDates(
      [{ event_type: 'term_start', date: '2026-09-01', source_quote: 'autumn   TERM  begins' }],
      'Welcome - Autumn term begins on Tuesday',
      NOW
    );
    expect(row.warnings.filter(w => /may have invented/i.test(w))).toEqual([]);
  });

  it('flags duplicate rows', () => {
    const rows = validateTermDates(
      [
        { event_type: 'bank_holiday', date: '2026-12-25', label: 'Christmas', academic_year: '2026-2027' },
        { event_type: 'bank_holiday', date: '2026-12-25', label: 'Christmas Day', academic_year: '2026-2027' },
      ],
      '',
      NOW
    );
    expect(rows[1].warnings.some(w => /duplicate/i.test(w))).toBe(true);
    expect(rows[0].warnings.some(w => /duplicate/i.test(w))).toBe(false);
  });

  it('flags a date more than 18 months from now', () => {
    const [row] = validateTermDates(
      [{ event_type: 'term_start', date: '2031-09-01', academic_year: '2031-2032' }],
      '',
      NOW
    );
    expect(row.warnings.some(w => /18 months/i.test(w))).toBe(true);
  });

  it('flags an unparseable date', () => {
    const [row] = validateTermDates(
      [{ event_type: 'term_start', date: 'not a date' }],
      '',
      NOW
    );
    expect(row.warnings.some(w => /couldn't be read/i.test(w))).toBe(true);
  });

  it('does not mutate the input rows', () => {
    const input = [{ event_type: 'term_start', date: '2026-09-01' }];
    validateTermDates(input, '', NOW);
    expect(input[0]).not.toHaveProperty('warnings');
  });
});
