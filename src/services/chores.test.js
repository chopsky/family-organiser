const { weekdayAbbrev, appliesOn, oneOffDay, buildDayView } = require('./chores');

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

  test('a multi-slot routine expands into one independent instance per slot', () => {
    const routineDefs = [
      { id: 'r1', type: 'routine', repeat: 'daily', whens: ['morning', 'evening'], assignee_ids: ['m'], position: 0, created_at: '2026-01-01' },
    ];
    // morning ticked, evening not - completion is keyed by slot
    const view = buildDayView(routineDefs, [{ definition_id: 'r1', member_id: 'm', slot: 'morning' }], date);
    expect(view).toHaveLength(2);
    const morning = view.find((t) => t.slot === 'morning');
    const evening = view.find((t) => t.slot === 'evening');
    expect(morning.done).toEqual({ m: true });
    expect(evening.done).toEqual({ m: false }); // ticking morning must NOT tick evening
    expect(morning.occurrence_key).toBe('r1|morning');
    expect(evening.occurrence_key).toBe('r1|evening');
  });

  test('a slotless completion does not mark a routine slot done (and vice versa)', () => {
    const routineDefs = [
      { id: 'r1', type: 'routine', repeat: 'daily', whens: ['morning'], assignee_ids: ['m'], position: 0, created_at: '2026-01-01' },
    ];
    // a legacy/slotless row ('') must not satisfy the 'morning' instance
    const view = buildDayView(routineDefs, [{ definition_id: 'r1', member_id: 'm', slot: '' }], date);
    expect(view.find((t) => t.slot === 'morning').done).toEqual({ m: false });
  });

  test('a single-slot routine gives one instance keyed by its slot', () => {
    const routineDefs = [
      { id: 'r2', type: 'routine', repeat: 'daily', whens: ['afternoon'], assignee_ids: ['l'], position: 0, created_at: '2026-01-01' },
    ];
    const view = buildDayView(routineDefs, [{ definition_id: 'r2', member_id: 'l', slot: 'afternoon' }], date);
    expect(view).toHaveLength(1);
    expect(view[0]).toMatchObject({ slot: 'afternoon', occurrence_key: 'r2|afternoon', done: { l: true } });
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

// Carry-forward is for one-offs ONLY. A recurring chore's next occurrence is a
// fresh one - a missed Tuesday must never pile up on Wednesday, or reappear
// alongside next Tuesday's. Pinned because the natural way to extend
// carry-forward later is to loosen the repeat check, which would do exactly
// that. `done` is empty throughout: the worst case for an accidental carry.
describe('recurring chores never carry forward', () => {
  const none = new Set();

  it('a weekly chore shows only on its weekdays, missed or not', () => {
    const weekly = { id: 'w1', repeat: 'weekly', days: ['TUE', 'THU'] };
    expect(appliesOn(weekly, '2026-07-28', { doneIds: none, today: '2026-08-31' })).toBe(true);  // Tue
    expect(appliesOn(weekly, '2026-07-29', { doneIds: none, today: '2026-08-31' })).toBe(false); // Wed — not carried
    expect(appliesOn(weekly, '2026-07-30', { doneIds: none, today: '2026-08-31' })).toBe(true);  // Thu — fresh
    expect(appliesOn(weekly, '2026-08-04', { doneIds: none, today: '2026-08-31' })).toBe(true);  // next Tue — fresh
  });

  it('a daily chore is just daily — no accumulation', () => {
    const daily = { id: 'd1', repeat: 'daily' };
    expect(appliesOn(daily, '2026-07-29', { doneIds: none, today: '2026-08-31' })).toBe(true);
    expect(appliesOn(daily, '2026-07-30', { doneIds: none, today: '2026-08-31' })).toBe(true);
  });

  it('buildDayView shows one instance of a weekly chore, not a backlog', () => {
    const weekly = { id: 'w1', repeat: 'weekly', days: ['TUE'], assignee_ids: ['m1'] };
    expect(buildDayView([weekly], [], '2026-08-04', { doneIds: none, today: '2026-08-31' })).toHaveLength(1);
    expect(buildDayView([weekly], [], '2026-08-05', { doneIds: none, today: '2026-08-31' })).toHaveLength(0);
  });
});

// ── One-offs occupy exactly one day ────────────────────────────────────────
// A one-off is a single thing, so it gets a single square. The first attempt
// carried it across every day from its due date onward and produced three
// distinct bugs, each pinned below:
//   1. it ran into future days — "go to tomorrow, it's showing there"
//   2. ticking it made it vanish from the day it was ticked
//   3. star credit is keyed by (definition, member, DATE), so appearing on two
//      days meant it could be ticked twice for double stars
describe('one-off placement', () => {
  const TODAY = '2026-07-29';
  const chore = (over) => ({ id: 'c1', repeat: 'once', assignee_ids: ['m1'], ...over });
  const on = (def, date, doneOn) => appliesOn(def, date, { today: TODAY, doneOn });

  it('an overdue one sits on today, not on the days it was missed', () => {
    const d = chore({ due_date: '2026-07-27' });
    expect(on(d, '2026-07-29')).toBe(true);
    expect(on(d, '2026-07-27')).toBe(false);
    expect(on(d, '2026-07-28')).toBe(false);
  });

  it('never reaches a day that has not happened', () => {
    const d = chore({ due_date: '2026-07-27' });
    expect(on(d, '2026-07-30')).toBe(false);
    expect(on(d, '2026-12-25')).toBe(false);
  });

  it('a future-dated one waits on its own day', () => {
    const d = chore({ due_date: '2026-08-20' });
    expect(on(d, '2026-08-20')).toBe(true);
    expect(on(d, TODAY)).toBe(false);
  });

  it('once ticked it stays on the day it was ticked — the record survives', () => {
    const d = chore({ due_date: '2026-07-27' });
    const doneOn = new Map([['c1', '2026-07-28']]);
    expect(on(d, '2026-07-28', doneOn)).toBe(true);
    expect(on(d, '2026-07-29', doneOn)).toBe(false); // no longer chasing today
  });

  it('appears on exactly ONE day, so it can never be ticked twice for stars', () => {
    const d = chore({ due_date: '2026-07-25' });
    const week = ['2026-07-25', '2026-07-26', '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30'];
    expect(week.filter((x) => on(d, x))).toHaveLength(1);
  });

  it('a routine never chases today — habits reset, they do not accrue', () => {
    const r = chore({ due_date: '2026-07-27', type: 'routine' });
    expect(on(r, '2026-07-27')).toBe(true);
    expect(on(r, TODAY)).toBe(false);
  });

  it('without today it falls back to the due date rather than guessing', () => {
    const d = chore({ due_date: '2026-07-27' });
    expect(appliesOn(d, '2026-07-27', {})).toBe(true);
    expect(appliesOn(d, TODAY, {})).toBe(false);
  });

  it('a dateless one-off has no day at all', () => {
    expect(oneOffDay(chore({ due_date: null }), TODAY)).toBeNull();
    expect(on(chore({ due_date: null }), TODAY)).toBe(false);
  });

  it('start_date still hides it — and buildDayView agrees with appliesOn', () => {
    const d = chore({ due_date: '2026-07-27', start_date: '2026-08-01' });
    expect(on(d, TODAY)).toBe(false);
    expect(buildDayView([d], [], TODAY, { today: TODAY })).toHaveLength(0);
  });

  it('flags an overdue instance so the UI can say where it came from', () => {
    const d = chore({ due_date: '2026-07-27' });
    const [inst] = buildDayView([d], [], TODAY, { today: TODAY, doneOn: new Map() });
    expect(inst.carried_from).toBe('2026-07-27');
    const dueToday = chore({ id: 'c2', due_date: TODAY });
    const [fresh] = buildDayView([dueToday], [], TODAY, { today: TODAY, doneOn: new Map() });
    expect(fresh.carried_from).toBeNull();
  });
});

// Carry-forward is for one-offs ONLY. A recurring chore's next occurrence is a
// fresh one — a missed Tuesday must never pile up on Wednesday.
describe('recurring chores are untouched by one-off placement', () => {
  const opts = { today: '2026-08-31', doneOn: new Map() };

  it('a weekly chore shows only on its weekdays, missed or not', () => {
    const weekly = { id: 'w1', repeat: 'weekly', days: ['TUE', 'THU'] };
    expect(appliesOn(weekly, '2026-07-28', opts)).toBe(true);  // Tue
    expect(appliesOn(weekly, '2026-07-29', opts)).toBe(false); // Wed
    expect(appliesOn(weekly, '2026-07-30', opts)).toBe(true);  // Thu
    expect(appliesOn(weekly, '2026-08-04', opts)).toBe(true);  // next Tue
  });

  it('a daily chore is just daily — no accumulation', () => {
    const daily = { id: 'd1', repeat: 'daily' };
    expect(appliesOn(daily, '2026-07-29', opts)).toBe(true);
    expect(appliesOn(daily, '2026-07-30', opts)).toBe(true);
  });
});
