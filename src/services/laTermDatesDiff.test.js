const { diffTermDates, describeDiff } = require('./laTermDatesDiff');

const row = (ay, event_type, date, end_date = null, label = null) => ({ academic_year: ay, event_type, date, end_date, label });

describe('diffTermDates', () => {
  const held = [
    row('2026-2027', 'term_start', '2026-09-02'),
    row('2026-2027', 'term_end', '2026-10-23'),
    row('2026-2027', 'half_term_start', '2026-10-26', '2026-10-30', 'Autumn half term'),
    row('2025-2026', 'term_start', '2025-09-01'),
  ];

  it('reports identical when only labels differ', () => {
    const fresh = [
      row('2026-2027', 'term_start', '2026-09-02', null, 'Autumn Term starts'),
      row('2026-2027', 'term_end', '2026-10-23'),
      row('2026-2027', 'half_term_start', '2026-10-26', '2026-10-30', 'October half term'),
    ];
    const [d] = diffTermDates(['2026-2027'], held, fresh);
    expect(d.kind).toBe('identical');
    expect(d.unchanged).toBe(3);
    expect(describeDiff(d)).toBe('+0 -0 (identical)');
  });

  it('reports a moved date as one removed and one added', () => {
    const fresh = [
      row('2026-2027', 'term_start', '2026-09-03'),
      row('2026-2027', 'term_end', '2026-10-23'),
      row('2026-2027', 'half_term_start', '2026-10-26', '2026-10-30'),
    ];
    const [d] = diffTermDates(['2026-2027'], held, fresh);
    expect(d.kind).toBe('changed');
    expect(d.added).toEqual([{ event_type: 'term_start', date: '2026-09-03', end_date: null, label: null }]);
    expect(d.removed).toEqual([{ event_type: 'term_start', date: '2026-09-02', end_date: null, label: null }]);
    expect(describeDiff(d)).toBe('+1 -1 (changed)');
  });

  it('classifies a year the directory had never held as new_year', () => {
    const [d] = diffTermDates(['2027-2028'], held, [row('2027-2028', 'term_start', '2027-09-01')]);
    expect(d.kind).toBe('new_year');
    expect(d.added).toHaveLength(1);
  });

  it('only diffs the years being replaced, one result per year', () => {
    const fresh = [row('2026-2027', 'term_start', '2026-09-02'), row('2025-2026', 'term_start', '2025-09-01')];
    const ds = diffTermDates(['2025-2026', '2026-2027'], held, fresh);
    expect(ds.map((d) => d.academic_year)).toEqual(['2025-2026', '2026-2027']);
    expect(ds[0].kind).toBe('identical');
    expect(ds[1].kind).toBe('changed'); // two rows dropped
    expect(ds[1].removed).toHaveLength(2);
  });
});
