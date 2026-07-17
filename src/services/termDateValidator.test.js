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

  it('picks the weekday closest to the date when the quote has a range', () => {
    // Real PDF case: "Monday 13 April – Thursday 25 June" emitted by
    // the AI as the source_quote for the term-start row (date 13 Apr).
    // 2026-04-13 IS a Monday, so the row should NOT be flagged — but
    // the older simple-find logic picked 'Thursday' (longer name, found
    // first) and false-flagged the row.
    const [row] = validateTermDates(
      [{ event_type: 'term_start', date: '2026-04-13', academic_year: '2025-2026', source_quote: 'Monday 13 April – Thursday 25 June' }],
      'Monday 13 April – Thursday 25 June',
      NOW
    );
    expect(row.warnings.filter(w => /says Thursday/i.test(w))).toEqual([]);
    expect(row.warnings.filter(w => /says Monday/i.test(w))).toEqual([]);
  });

  it('handles ordinal day numbers ("10th") in range quotes without false-flagging', () => {
    // Real user case (Immanuel College spring term): the term-END row quotes
    // the whole header "Monday 5th January 2026 – Friday 10th April 2026".
    // 2026-04-10 IS a Friday, but `\b10\b` never matched "10th" (no word
    // boundary between digit and letter), so the matcher fell back to the
    // FIRST weekday (Monday) and false-flagged a correct date.
    const rows = validateTermDates(
      [
        { event_type: 'term_start', date: '2026-01-05', label: 'Spring Term starts', academic_year: '2025-2026', source_quote: 'Monday 5th January 2026 – Friday 10th April 2026' },
        { event_type: 'term_end', date: '2026-04-10', label: 'End of Spring Term', academic_year: '2025-2026', source_quote: 'Monday 5th January 2026 – Friday 10th April 2026' },
      ],
      'Spring Term 2026 Monday 5th January 2026 – Friday 10th April 2026',
      NOW
    );
    expect(rows[0].warnings).toEqual([]);
    expect(rows[1].warnings).toEqual([]);
  });

  it('anchors to the weekday BEFORE the number, not the closer following one', () => {
    // Real Highgate School import: "Half-term Monday 25 – Friday 29 May".
    // 2026-05-25 IS a Monday, but start-to-start distance scored "Friday"
    // (5 chars away across the dash) closer than "Monday" (7 chars, its own
    // length counted against it) and false-flagged a correct date. Edge-to-
    // edge distance anchors 25 to the adjacent "Monday".
    const rows = validateTermDates(
      [
        { event_type: 'term_start', date: '2026-04-20', label: 'Summer term', academic_year: '2025-2026', source_quote: 'Term begins Monday 20 April' },
        { event_type: 'half_term_start', date: '2026-05-25', end_date: '2026-05-29', label: 'Half-term', academic_year: '2025-2026', source_quote: 'Half-term Monday 25 – Friday 29 May' },
        { event_type: 'term_end', date: '2026-07-08', label: 'Term ends', academic_year: '2025-2026', source_quote: 'Term ends Wednesday 8 July' },
      ],
      'Summer 2026. Term begins Monday 20 April. Half-term Monday 25 – Friday 29 May. Term ends Wednesday 8 July.',
      NOW
    );
    expect(rows[1].warnings).toEqual([]);
  });

  it('still flags a genuinely wrong date in an ordinal range quote', () => {
    // 2026-04-09 is a Thursday; the quote pins the 9th... nothing - the
    // quote only mentions the 5th (Monday) and 10th (Friday). A date of
    // the 9th claiming this quote anchors to neither, falls back to the
    // first weekday (Monday), and correctly draws a warning.
    const [row] = validateTermDates(
      [{ event_type: 'term_end', date: '2026-04-09', label: 'End of Spring Term', academic_year: '2025-2026', source_quote: 'Monday 5th January 2026 – Friday 10th April 2026' }],
      'Spring Term 2026 Monday 5th January 2026 – Friday 10th April 2026',
      NOW
    );
    expect(row.warnings.length).toBeGreaterThan(0);
  });

  it('still flags a real mismatch when the range contains the right weekday', () => {
    // Range quote, but for date 25 June (which IS a Thursday — no
    // mismatch — but we want to confirm the disambiguator picks
    // Thursday, not Monday, for this row).
    const [row] = validateTermDates(
      [{ event_type: 'term_end', date: '2026-06-25', academic_year: '2025-2026', source_quote: 'Monday 13 April – Thursday 25 June' }],
      'Monday 13 April – Thursday 25 June',
      NOW
    );
    // 2026-06-25 actually IS a Thursday so no warning. The point of
    // the test is: the disambiguator MUST attach Thursday to the 25,
    // not Monday — otherwise it would false-flag this row.
    expect(row.warnings.filter(w => /says Monday/i.test(w))).toEqual([]);
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

  it('flags same-label same-AY rows on different dates as near-duplicates', () => {
    // Real PDF case: AI emitted two "Term 2 Ends" term_end rows, one on
    // 24 June and one on 25 June, even though the source only said
    // "Thursday 25 June". Exact-date dedup misses this, so the label-
    // based check exists to surface the real-world duplicate.
    const rows = validateTermDates(
      [
        { event_type: 'term_end', date: '2026-06-24', label: 'Term 2 Ends', academic_year: '2025-2026' },
        { event_type: 'term_end', date: '2026-06-25', label: 'Term 2 Ends', academic_year: '2025-2026' },
      ],
      '',
      NOW
    );
    expect(rows[1].warnings.some(w => /Same label and academic year/i.test(w))).toBe(true);
    expect(rows[0].warnings.some(w => /Same label and academic year/i.test(w))).toBe(false);
  });

  it('does not flag recurring half-terms (same label + AY, months apart)', () => {
    // "Half term" legitimately occurs in October, February and May of one
    // academic year. Those are distinct events, not a hallucinated duplicate.
    const rows = validateTermDates(
      [
        { event_type: 'half_term_start', date: '2025-10-27', label: 'Half Term', academic_year: '2025-2026' },
        { event_type: 'half_term_start', date: '2026-02-16', label: 'Half Term', academic_year: '2025-2026' },
        { event_type: 'half_term_start', date: '2026-05-25', label: 'Half Term', academic_year: '2025-2026' },
      ],
      '',
      NOW
    );
    expect(rows.every(r => r.warnings.every(w => !/Same label/i.test(w)))).toBe(true);
  });

  it('does not flag same-label rows in different academic years', () => {
    const rows = validateTermDates(
      [
        { event_type: 'term_end', date: '2025-06-25', label: 'Term 2 Ends', academic_year: '2024-2025' },
        { event_type: 'term_end', date: '2026-06-25', label: 'Term 2 Ends', academic_year: '2025-2026' },
      ],
      '',
      NOW
    );
    expect(rows.every(r => r.warnings.filter(w => /Same label/i.test(w)).length === 0)).toBe(true);
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

  const INVENTED = "The quoted text isn't on the source page — the AI may have invented this date.";

  it('does NOT flag invented-date when the quote only differs by punctuation', () => {
    // Quote uses an en-dash + parentheses; the page uses a hyphen and none.
    const [row] = validateTermDates(
      [{ event_type: 'inset_day', date: '2025-09-01', label: 'INSET', academic_year: '2025-2026', source_quote: 'INSET Day – (No Pupils in School)' }],
      'INSET day - no pupils in school on 1 September 2025',
      NOW
    );
    expect(row.warnings).not.toContain(INVENTED);
  });

  it('still flags an invented date when the quote barely appears on the page', () => {
    const [row] = validateTermDates(
      [{ event_type: 'inset_day', date: '2025-10-15', label: 'INSET', academic_year: '2025-2026', source_quote: 'Sports Day and Summer Fair celebration afternoon' }],
      'The autumn term begins in September. Half term is in October.',
      NOW
    );
    expect(row.warnings).toContain(INVENTED);
  });
});
