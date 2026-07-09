const { computeStreak, milestonesReached, dayStatus, STREAK_MILESTONES, addDaysStr } = require('./kids-streak');
const { weekdayAbbrev } = require('./chores');

// --- builders -------------------------------------------------------------
const K = 'kid-1';
const dailyDef = (over = {}) => ({
  id: 'd1', anyone: false, assignee_ids: [K], type: 'chore', repeat: 'daily',
  whens: [], days: [], start_date: null, due_date: null,
  created_at: '2020-01-01T00:00:00Z', archived_at: null, ...over,
});
// completion rows for a member on a set of dates (one slot).
const mk = (defId, memberId, dates, slot = '') => dates.map((d) => ({ definition_id: defId, member_id: memberId, date: d, slot }));
// inclusive descending date list: today-from .. today-to  (from >= to)
const daysBack = (today, from, to) => { const out = []; for (let i = from; i >= to; i--) out.push(addDaysStr(today, -i)); return out; };
// nearest Sunday >= base, so today-0..today-6 all share one ISO (Mon-Sun) week.
const findSunday = (base) => { let d = base; for (let i = 0; i < 7; i++) { if (weekdayAbbrev(d) === 'SUN') return d; d = addDaysStr(d, 1); } return base; };

describe('computeStreak', () => {
  test('contiguous done tail through today counts today included', () => {
    const today = '2026-07-15';
    const defs = [dailyDef()];
    const completions = mk('d1', K, [addDaysStr(today, 0), addDaysStr(today, -1), addDaysStr(today, -2)]);
    const s = computeStreak({ defs, completions, skips: [], memberId: K, today });
    expect(s.current).toBe(3);
    expect(s.satisfiedToday).toBe(true);
    expect(s.atRisk).toBe(false);
    expect(s.nextMilestone).toBe(7);
  });

  test('today unfinished is at risk, not broken (streak = run through yesterday)', () => {
    const today = '2026-07-15';
    const defs = [dailyDef()];
    // done yesterday + day before; nothing for today
    const completions = mk('d1', K, [addDaysStr(today, -1), addDaysStr(today, -2)]);
    const s = computeStreak({ defs, completions, skips: [], memberId: K, today });
    expect(s.current).toBe(2);
    expect(s.satisfiedToday).toBe(false);
    expect(s.atRisk).toBe(true);
  });

  test('a day with nothing due bridges the streak without counting', () => {
    const today = '2026-07-15';
    const abbr = (n) => weekdayAbbrev(addDaysStr(today, n));
    // weekly chore due on today and the day-before-yesterday, but NOT yesterday
    const defs = [dailyDef({ repeat: 'weekly', days: [abbr(0), abbr(-2)] })];
    const completions = mk('d1', K, [addDaysStr(today, 0), addDaysStr(today, -2)]);
    const s = computeStreak({ defs, completions, skips: [], memberId: K, today });
    // done(today-2) -> NONE(today-1) bridges -> done(today) => 2, not 1
    expect(s.current).toBe(2);
    expect(s.satisfiedToday).toBe(true);
  });

  test('free weekly grace forgives one miss per ISO week', () => {
    const today = findSunday('2026-07-13'); // today..today-6 == one Mon-Sun week
    const defs = [dailyDef()];
    // whole week done EXCEPT Thursday (today-3) — the week's single miss
    const done = daysBack(today, 6, 0).filter((d) => d !== addDaysStr(today, -3));
    const s = computeStreak({ defs, completions: mk('d1', K, done), skips: [], memberId: K, today });
    // Mon,Tue,Wed,Fri,Sat,Sun done (6); graced Thu bridges but doesn't count
    expect(s.current).toBe(6);
  });

  test('a second miss the same week breaks the streak', () => {
    const today = findSunday('2026-07-13');
    const defs = [dailyDef()];
    // miss BOTH Thursday (today-3) and Friday (today-2)
    const done = daysBack(today, 6, 0).filter((d) => d !== addDaysStr(today, -3) && d !== addDaysStr(today, -2));
    const s = computeStreak({ defs, completions: mk('d1', K, done), skips: [], memberId: K, today });
    // break at the 2nd miss (Fri) -> only Sat + Sun survive
    expect(s.current).toBe(2);
  });

  test('"anyone" chores are excluded from a personal streak', () => {
    const today = '2026-07-15';
    const defs = [dailyDef({ anyone: true, assignee_ids: [] })];
    const s = computeStreak({ defs, completions: [], skips: [], memberId: K, today });
    expect(s.current).toBe(0);
    expect(s.atRisk).toBe(false); // an uncompleted shared chore is not a personal miss
  });

  test('a multi-slot routine needs every slot done for the day to count', () => {
    const today = '2026-07-15';
    const defs = [dailyDef({ type: 'routine', whens: ['morning', 'evening'] })];
    const onlyMorning = mk('d1', K, [today], 'morning');
    expect(computeStreak({ defs, completions: onlyMorning, skips: [], memberId: K, today }).satisfiedToday).toBe(false);
    const both = [...mk('d1', K, [today], 'morning'), ...mk('d1', K, [today], 'evening')];
    expect(computeStreak({ defs, completions: both, skips: [], memberId: K, today }).satisfiedToday).toBe(true);
  });

  test('a skipped chore is not due (no miss)', () => {
    const today = '2026-07-15';
    const defs = [dailyDef()];
    const completions = mk('d1', K, [addDaysStr(today, -1)]); // done yesterday only
    const skips = [{ definition_id: 'd1', date: today }];      // today hidden household-wide
    const s = computeStreak({ defs, completions, skips, memberId: K, today });
    expect(s.todayStatus).toBe('NONE');
    expect(s.current).toBe(1); // yesterday's done carries; today neither helps nor breaks
    expect(s.atRisk).toBe(false);
  });

  test('an ongoing pause protects the streak (missed days do not break it)', () => {
    const today = '2026-07-15';
    const defs = [dailyDef()];
    const done = daysBack(today, 8, 4); // 5 done days, then nothing for 4 days
    const pauses = [{ start_date: addDaysStr(today, -3), end_date: null }]; // paused since 3 days ago
    const s = computeStreak({ defs, completions: mk('d1', K, done), skips: [], pauses, memberId: K, today });
    expect(s.current).toBe(5);         // held at the pre-pause value
    expect(s.todayStatus).toBe('NONE'); // today is frozen
    expect(s.atRisk).toBe(false);
    // Without the pause the same gap would break it (2+ misses in a week):
    const noPause = computeStreak({ defs, completions: mk('d1', K, done), skips: [], memberId: K, today });
    expect(noPause.current).toBeLessThan(5);
  });

  test('a day the kid still completes during a pause keeps counting', () => {
    const today = '2026-07-15';
    const defs = [dailyDef()];
    const completions = mk('d1', K, [addDaysStr(today, -1), addDaysStr(today, 0)]); // did yesterday + today
    const pauses = [{ start_date: addDaysStr(today, -1), end_date: null }];         // paused, but did them anyway
    const s = computeStreak({ defs, completions, skips: [], pauses, memberId: K, today });
    expect(s.current).toBe(2);
    expect(s.satisfiedToday).toBe(true);
  });

  test('a closed pause window keeps those days frozen after resuming', () => {
    const today = '2026-07-15';
    const defs = [dailyDef()];
    const done = daysBack(today, 10, 6); // done through 6 days ago
    const pauses = [{ start_date: addDaysStr(today, -5), end_date: addDaysStr(today, -2) }]; // was paused, now resumed
    // Since resuming (today-2..today) nothing done -> those are real misses again.
    const s = computeStreak({ defs, completions: mk('d1', K, done), skips: [], pauses, memberId: K, today });
    expect(s.todayStatus).toBe('MISS'); // back off pause; today is live again
    expect(s.atRisk).toBe(true);
  });

  test('longest reflects a past run even after it is broken', () => {
    const today = findSunday('2026-07-13');
    const defs = [dailyDef()];
    const past = daysBack(today, 30, 20);   // 11 consecutive done days, long ago
    const recent = daysBack(today, 2, 0);   // 3 done days ending today
    const s = computeStreak({ defs, completions: mk('d1', K, [...past, ...recent]), skips: [], memberId: K, today });
    expect(s.current).toBe(3);
    expect(s.longest).toBe(11);
  });
});

describe('dayStatus recurrence gates', () => {
  test('a chore created today is not "due" (a miss) on past days', () => {
    const today = '2026-07-15';
    const mine = [dailyDef({ created_at: `${today}T09:00:00Z` })];
    // no completions, no skips
    expect(dayStatus(mine, new Set(), new Set(), addDaysStr(today, -1))).toBe('NONE');
    expect(dayStatus(mine, new Set(), new Set(), today)).toBe('MISS'); // due today, undone
  });
});

describe('milestonesReached', () => {
  test('returns the tiers a current streak has crossed', () => {
    expect(milestonesReached(6).map((m) => m.tier)).toEqual([]);
    expect(milestonesReached(7).map((m) => m.tier)).toEqual([7]);
    expect(milestonesReached(365).map((m) => m.tier)).toEqual(STREAK_MILESTONES.map((m) => m.tier));
  });
});
