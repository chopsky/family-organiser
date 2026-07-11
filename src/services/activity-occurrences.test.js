const { expandActivityOccurrences } = require('./activity-occurrences');

const MEMBERS = [{ id: 'kid1', name: 'Mason' }];

// Monday=0 convention: 2026-07-15 is a Wednesday → day_of_week 2.
const TENNIS = {
  id: 'act-1',
  child_id: 'kid1',
  activity: 'Tennis',
  day_of_week: 2,
  time_start: '16:00',
  time_end: '17:00',
};

describe('expandActivityOccurrences', () => {
  test('emits one occurrence per matching weekday with child-prefixed title', () => {
    const rows = expandActivityOccurrences([TENNIS], MEMBERS, '2026-07-13', '2026-07-26', 'Europe/London');
    expect(rows).toHaveLength(2); // Wed 15th + Wed 22nd
    expect(rows[0].title).toBe('Mason - Tennis');
    expect(rows[0].assigned_to_names).toEqual(['Mason']);
    // 16:00 BST = 15:00 UTC (DST-correct per date, not per "now")
    expect(rows[0].start_time).toBe('2026-07-15T15:00:00Z');
    expect(rows[0].end_time).toBe('2026-07-15T16:00:00Z');
  });

  test('honours per-date skips and term windows', () => {
    const act = { ...TENNIS, skips: ['2026-07-15'], start_date: '2026-07-01', end_date: '2026-07-21' };
    const rows = expandActivityOccurrences([act], MEMBERS, '2026-07-13', '2026-08-02', 'Europe/London');
    // 15th skipped, 22nd/29th past the term end → nothing left
    expect(rows).toHaveLength(0);
  });

  test('per-date override replaces the time for that date only', () => {
    const act = { ...TENNIS, overrides: { '2026-07-15': { time_start: '17:30', time_end: '18:30' } } };
    const rows = expandActivityOccurrences([act], MEMBERS, '2026-07-13', '2026-07-26', 'Europe/London');
    expect(rows[0].start_time).toBe('2026-07-15T16:30:00Z'); // 17:30 BST
    expect(rows[1].start_time).toBe('2026-07-22T15:00:00Z'); // back to normal
  });

  test('timeless activity becomes an all-day row; hidden flag carried through', () => {
    const act = { ...TENNIS, time_start: null, time_end: null, show_on_calendar: false };
    const rows = expandActivityOccurrences([act], MEMBERS, '2026-07-15', '2026-07-15', 'Europe/London');
    expect(rows).toHaveLength(1);
    expect(rows[0].all_day).toBe(true);
    expect(rows[0].show_on_calendar).toBe(false);
  });
});
