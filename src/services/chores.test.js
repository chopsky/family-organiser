const { weekdayAbbrev, appliesOn, buildDayView } = require('./chores');

describe('weekdayAbbrev', () => {
  test('maps dates to UK weekday abbreviations (no tz drift)', () => {
    expect(weekdayAbbrev('2026-04-18')).toBe('SAT'); // Sat 18 Apr 2026
    expect(weekdayAbbrev('2026-04-13')).toBe('MON');
    expect(weekdayAbbrev('2026-04-19')).toBe('SUN');
  });
});

describe('appliesOn', () => {
  const sat = '2026-04-18'; // Saturday
  const sun = '2026-04-19';

  test('daily applies every day', () => {
    expect(appliesOn({ repeat: 'daily' }, sat)).toBe(true);
    expect(appliesOn({ repeat: 'daily' }, sun)).toBe(true);
  });

  test('weekly applies only on its weekdays', () => {
    const d = { repeat: 'weekly', days: ['SAT'] };
    expect(appliesOn(d, sat)).toBe(true);
    expect(appliesOn(d, sun)).toBe(false);
  });

  test('once applies only on its due_date', () => {
    const d = { repeat: 'once', due_date: sat };
    expect(appliesOn(d, sat)).toBe(true);
    expect(appliesOn(d, sun)).toBe(false);
  });

  test('start_date hides the task before it starts', () => {
    const d = { repeat: 'daily', start_date: sun };
    expect(appliesOn(d, sat)).toBe(false); // before start
    expect(appliesOn(d, sun)).toBe(true);
  });

  test('archived definitions never apply', () => {
    expect(appliesOn({ repeat: 'daily', archived_at: '2026-01-01T00:00:00Z' }, sat)).toBe(false);
  });
});

describe('buildDayView', () => {
  const date = '2026-04-18'; // Saturday
  const defs = [
    { id: 'd1', repeat: 'daily', assignee_ids: ['m', 'l'], position: 1, created_at: '2026-01-01' },
    { id: 'd2', repeat: 'weekly', days: ['SAT'], assignee_ids: ['m'], position: 0, created_at: '2026-01-02' },
    { id: 'd3', repeat: 'weekly', days: ['MON'], assignee_ids: ['l'], position: 2, created_at: '2026-01-03' }, // not Saturday
  ];

  test('includes only applicable defs, sorted by position', () => {
    const view = buildDayView(defs, [], date);
    expect(view.map((d) => d.id)).toEqual(['d2', 'd1']); // d3 excluded (Mon), d2 before d1 by position
  });

  test('annotates per-member done from that date\'s completions', () => {
    const completions = [
      { definition_id: 'd1', member_id: 'm' }, // Mason did the shared daily, Lily didn't
    ];
    const view = buildDayView(defs, completions, date);
    const d1 = view.find((d) => d.id === 'd1');
    expect(d1.done).toEqual({ m: true, l: false });
    const d2 = view.find((d) => d.id === 'd2');
    expect(d2.done).toEqual({ m: false });
  });

  test('a completion for a different member does not mark this member done', () => {
    const completions = [{ definition_id: 'd2', member_id: 'l' }]; // l isn't even assigned d2
    const view = buildDayView(defs, completions, date);
    expect(view.find((d) => d.id === 'd2').done).toEqual({ m: false });
  });

  test('anyone defs carry a shared completed flag + completed_by, not per-member done', () => {
    const anyoneDefs = [{ id: 'a1', repeat: 'daily', anyone: true, assignee_ids: [], position: 0, created_at: '2026-01-01' }];
    // unclaimed
    expect(buildDayView(anyoneDefs, [], date)[0]).toMatchObject({ id: 'a1', completed: false, completed_by: null, done: {} });
    // claimed by 'm' (the attributed completer)
    const claimed = buildDayView(anyoneDefs, [{ definition_id: 'a1', member_id: 'm' }], date)[0];
    expect(claimed).toMatchObject({ completed: true, completed_by: 'm', done: {} });
  });
});
