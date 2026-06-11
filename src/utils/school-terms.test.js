jest.mock('../db/queries', () => ({ getSchoolTermDates: jest.fn() }));
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));

const { deriveTerms, currentTerm, activityActiveOn, seasonLabel, resolveTermSchoolForChild } = require('./school-terms');

describe('resolveTermSchoolForChild', () => {
  test('prefers the child\'s explicit school_id', () => {
    const child = { school_id: 's-child' };
    expect(resolveTermSchoolForChild(child, [{ id: 's1' }, { id: 's2' }])).toBe('s-child');
  });

  test('falls back to the household\'s single school when the child has none', () => {
    expect(resolveTermSchoolForChild({ school_id: null }, [{ id: 's1' }])).toBe('s1');
    expect(resolveTermSchoolForChild({}, [{ id: 's1' }])).toBe('s1');
  });

  test('returns null when ambiguous (2+ schools) or no schools', () => {
    expect(resolveTermSchoolForChild({}, [{ id: 's1' }, { id: 's2' }])).toBeNull();
    expect(resolveTermSchoolForChild({}, [])).toBeNull();
    expect(resolveTermSchoolForChild({})).toBeNull();
  });
});

describe('deriveTerms', () => {
  const rows = [
    { event_type: 'term_start', academic_year: '2026/27', date: '2026-09-08', label: null },
    { event_type: 'term_end', academic_year: '2026/27', date: '2026-12-17', label: null },
    { event_type: 'term_start', academic_year: '2026/27', date: '2027-01-06', label: null },
    { event_type: 'term_end', academic_year: '2026/27', date: '2027-03-31', label: null },
    { event_type: 'inset_day', academic_year: '2026/27', date: '2026-10-20' }, // ignored
  ];

  test('pairs starts with ends into labelled terms, sorted by start', () => {
    const terms = deriveTerms(rows);
    expect(terms).toEqual([
      { label: 'Autumn Term 2026/27', academic_year: '2026/27', start_date: '2026-09-08', end_date: '2026-12-17' },
      { label: 'Spring Term 2026/27', academic_year: '2026/27', start_date: '2027-01-06', end_date: '2027-03-31' },
    ]);
  });

  test('ignores boilerplate row labels and includes the year so terms are unique', () => {
    const terms = deriveTerms([
      { event_type: 'term_start', academic_year: '2026/27', date: '2026-09-08', label: 'Autumn Term starts' },
      { event_type: 'term_end', academic_year: '2026/27', date: '2026-12-17' },
      { event_type: 'term_start', academic_year: '2027/28', date: '2027-09-07', label: 'Autumn Term starts' },
      { event_type: 'term_end', academic_year: '2027/28', date: '2027-12-16' },
    ]);
    expect(terms.map(t => t.label)).toEqual(['Autumn Term 2026/27', 'Autumn Term 2027/28']);
    // distinguishable - no duplicate labels
    expect(new Set(terms.map(t => t.label)).size).toBe(terms.length);
  });

  test('skips an unpaired term_start', () => {
    const terms = deriveTerms([
      { event_type: 'term_start', academic_year: '2026/27', date: '2026-09-08' },
    ]);
    expect(terms).toEqual([]);
  });

  test('empty input -> empty', () => {
    expect(deriveTerms([])).toEqual([]);
    expect(deriveTerms()).toEqual([]);
  });
});

describe('seasonLabel', () => {
  test('maps months to UK terms', () => {
    expect(seasonLabel('2026-09-08')).toBe('Autumn Term');
    expect(seasonLabel('2027-01-06')).toBe('Spring Term');
    expect(seasonLabel('2027-05-01')).toBe('Summer Term');
  });
});

describe('currentTerm', () => {
  const terms = [
    { label: 'Autumn', start_date: '2026-09-08', end_date: '2026-12-17' },
    { label: 'Spring', start_date: '2027-01-06', end_date: '2027-03-31' },
  ];
  test('finds the term covering the date', () => {
    expect(currentTerm(terms, '2026-10-01').label).toBe('Autumn');
    expect(currentTerm(terms, '2027-02-01').label).toBe('Spring');
  });
  test('returns null during a holiday between terms', () => {
    expect(currentTerm(terms, '2026-12-25')).toBeNull();
  });
});

describe('activityActiveOn', () => {
  test('ongoing activity (no window) is always active', () => {
    expect(activityActiveOn({ start_date: null, end_date: null }, '2030-01-01')).toBe(true);
  });
  test('within the window', () => {
    expect(activityActiveOn({ start_date: '2026-09-08', end_date: '2026-12-17' }, '2026-10-01')).toBe(true);
  });
  test('before the window', () => {
    expect(activityActiveOn({ start_date: '2026-09-08', end_date: '2026-12-17' }, '2026-09-01')).toBe(false);
  });
  test('after the window (last term auto-expires)', () => {
    expect(activityActiveOn({ start_date: '2026-09-08', end_date: '2026-12-17' }, '2027-01-10')).toBe(false);
  });
  test('open-ended end only', () => {
    expect(activityActiveOn({ start_date: '2026-09-08', end_date: null }, '2030-01-01')).toBe(true);
    expect(activityActiveOn({ start_date: '2026-09-08', end_date: null }, '2026-09-01')).toBe(false);
  });
});
