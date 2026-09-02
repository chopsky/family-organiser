/**
 * Moving only an event's START moves the whole event - the duration rides
 * along (default an hour), instead of a stale end that the midnight-
 * rollover repair pushes to tomorrow (real 2026-09-02 transcript:
 * "change time to 21:00" on an 18:00-19:00 meeting → "runs until
 * tomorrow"). Explicit end changes keep the rollover repair.
 */
jest.mock('../db/queries', () => ({
  resolveAssignees: jest.fn(() => ({ ids: [], names: [] })),
}));
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../services/ai', () => ({}));
jest.mock('../services/transcribe', () => ({}));
jest.mock('../services/ai-client', () => ({ callWithFailover: jest.fn() }));

const { buildEventUpdates } = require('./handlers');

const HH = { timezone: 'Europe/London', members: [] };
// 2 Sept 2026, 18:00-19:00 BST (17:00-18:00 UTC).
const meeting = {
  title: 'Meeting with Lynn',
  all_day: false,
  start_time: '2026-09-02T17:00:00Z',
  end_time: '2026-09-02T18:00:00Z',
};

describe('buildEventUpdates - start-only moves', () => {
  test('moving the start carries the 1h duration (the transcript case)', () => {
    const patch = buildEventUpdates({ start_time: '21:00' }, meeting, HH, null);
    expect(Date.parse(patch.start_time)).toBe(Date.parse('2026-09-02T20:00:00Z')); // 21:00 BST
    expect(Date.parse(patch.end_time)).toBe(Date.parse('2026-09-02T21:00:00Z'));   // 22:00 BST - same day
  });

  test('a 2h event moved keeps 2h', () => {
    const patch = buildEventUpdates(
      { start_time: '10:00' },
      { ...meeting, start_time: '2026-09-02T17:00:00Z', end_time: '2026-09-02T19:00:00Z' },
      HH, null,
    );
    expect(Date.parse(patch.end_time) - Date.parse(patch.start_time)).toBe(2 * 3600000);
  });

  test('zero-duration legacy event gets the hour default when moved', () => {
    const patch = buildEventUpdates(
      { start_time: '21:00' },
      { ...meeting, end_time: '2026-09-02T17:00:00Z' },
      HH, null,
    );
    expect(Date.parse(patch.end_time) - Date.parse(patch.start_time)).toBe(3600000);
  });

  test('moving start AND day still preserves duration on the new day', () => {
    const patch = buildEventUpdates({ date: '2026-09-04', start_time: '15:00' }, meeting, HH, null);
    expect(Date.parse(patch.start_time)).toBe(Date.parse('2026-09-04T14:00:00Z'));
    expect(Date.parse(patch.end_time)).toBe(Date.parse('2026-09-04T15:00:00Z'));
  });

  test('an explicit past-midnight END keeps the rollover repair', () => {
    const patch = buildEventUpdates({ start_time: '23:00', end_time: '00:30' }, meeting, HH, null);
    expect(Date.parse(patch.end_time)).toBeGreaterThan(Date.parse(patch.start_time));
    expect(Date.parse(patch.end_time) - Date.parse(patch.start_time)).toBe(1.5 * 3600000);
  });

  test('end-only change leaves the start alone and does not invent duration', () => {
    const patch = buildEventUpdates({ end_time: '20:00' }, meeting, HH, null);
    expect(Date.parse(patch.start_time)).toBe(Date.parse('2026-09-02T17:00:00Z'));
    expect(Date.parse(patch.end_time)).toBe(Date.parse('2026-09-02T19:00:00Z')); // 20:00 BST
  });

  test('all-day events are untouched by the duration rule', () => {
    const patch = buildEventUpdates(
      { date: '2026-09-05' },
      { all_day: true, start_time: '2026-09-02T00:00:00Z', end_time: '2026-09-02T23:59:59Z' },
      HH, null,
    );
    expect(patch.start_time).toBe('2026-09-05T00:00:00Z');
    expect(patch.end_time).toBe('2026-09-05T23:59:59Z');
  });
});
