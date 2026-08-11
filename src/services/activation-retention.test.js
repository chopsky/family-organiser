/**
 * Pure-function tests for the Activation & retention card: the bucket
 * classifier and the weekly retention curve. Data gathering is thin
 * Supabase plumbing exercised in prod; the judgement calls live here.
 */

jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));

const { classifyHousehold, buildWeeklyCurve } = require('./activation-retention');

const DAY = 86_400_000;

describe('classifyHousehold', () => {
  const base = { status: 'trialing', ageDays: 40, total: 50, first14: 30, last14: 10 };

  test('expired households are structural, never behavioural', () => {
    // Even a shape that would otherwise be petered_out reads as expired.
    expect(classifyHousehold({ ...base, status: 'expired', last14: 0 })).toBe('expired');
  });

  test('fewer than 5 actions ever = never_started, regardless of age', () => {
    expect(classifyHousehold({ ...base, total: 4, first14: 4, last14: 4 })).toBe('never_started');
    expect(classifyHousehold({ ...base, total: 0, first14: 0, last14: 0, ageDays: 90 })).toBe('never_started');
  });

  test('strong start then 14 silent days = petered_out (only once old enough)', () => {
    expect(classifyHousehold({ ...base, first14: 30, last14: 0, ageDays: 40 })).toBe('petered_out');
    // Too young to judge - a 20-day-old household silent for a fortnight
    // still had real usage; it lands in quiet, not petered_out.
    expect(classifyHousehold({ ...base, first14: 30, last14: 0, ageDays: 20 })).toBe('quiet');
  });

  test('strong start with recent activity under a quarter of it = fading', () => {
    expect(classifyHousehold({ ...base, first14: 100, last14: 20 })).toBe('fading');
    // At exactly a quarter it is NOT fading - just active.
    expect(classifyHousehold({ ...base, first14: 100, last14: 25 })).toBe('active');
  });

  test('anything in the last fortnight without a collapse = active', () => {
    expect(classifyHousehold({ ...base, first14: 8, last14: 3 })).toBe('active');
  });

  test('low-volume start that lapsed = quiet', () => {
    expect(classifyHousehold({ ...base, total: 7, first14: 7, last14: 0, ageDays: 20 })).toBe('quiet');
  });
});

describe('buildWeeklyCurve', () => {
  const now = new Date('2026-08-10T00:00:00Z').getTime();

  test('counts only households old enough for each week, activity in-window', () => {
    const rows = [
      // 3 weeks old: active in week 0 and week 2, silent week 1
      { signup: now - 21 * DAY, events: [now - 20 * DAY, now - 3 * DAY] },
      // 10 days old: only eligible for week 0, active there
      { signup: now - 10 * DAY, events: [now - 9 * DAY] },
      // 5 weeks old, never active
      { signup: now - 35 * DAY, events: [] },
    ];
    const curve = buildWeeklyCurve(rows, now);
    expect(curve[0]).toEqual({ week: 0, active: 2, eligible: 3, pct: 67 });
    expect(curve[1]).toEqual({ week: 1, active: 0, eligible: 2, pct: 0 });
    expect(curve[2]).toEqual({ week: 2, active: 1, eligible: 2, pct: 50 });
    // Weeks 3-4: only the 5-week household qualifies, inactive.
    expect(curve[3]).toEqual({ week: 3, active: 0, eligible: 1, pct: 0 });
  });

  test('stops when no household is old enough', () => {
    const curve = buildWeeklyCurve([{ signup: now - 8 * DAY, events: [] }], now);
    expect(curve).toHaveLength(1); // week 0 only
  });
});
