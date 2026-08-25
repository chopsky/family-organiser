/**
 * Change-summary tests. The end_time branch is the load-bearing one: an
 * end-only change ("change it to 23-26 Aug") used to produce an EMPTY
 * summary, so the user saw a bare 'Updated "X".' with no idea what changed
 * (real 2026-07-22 Nici Bournemouth transcript).
 */
const { summariseEventChanges } = require('./notification-format');

const TZ = 'Europe/London';

describe('summariseEventChanges', () => {
  test('dates read in the household timezone, not UTC (padel "until Sat 22 Aug" bug, 2026-08-23)', () => {
    // Saturday-midnight BST end = Friday 23:00 UTC. The UTC slice showed
    // the Friday date; London says Saturday. (October dates keep the test
    // clock-independent - near-today dates render as "tomorrow" etc.)
    const prev = { start_time: '2026-10-10T19:00:00Z', end_time: '2026-10-10T20:00:00Z' };
    const out = summariseEventChanges(prev, { end_time: '2026-10-09T23:00:00Z' }, 'Europe/London');
    // In London both ends are Saturday - only the clock changed. The UTC
    // slice used to call this a move to Friday.
    expect(out).not.toMatch(/9 Oct/);
    expect(out).toMatch(/now ends 00:00/);
  });

  test('a rolled-past-midnight end reads as the next day in local time', () => {
    const prev = { start_time: '2026-10-10T19:00:00Z', end_time: '2026-10-10T20:00:00Z' };
    // Sunday 00:00 BST = Saturday 23:00 UTC.
    const out = summariseEventChanges(prev, { end_time: '2026-10-10T23:00:00Z' }, 'Europe/London');
    expect(out).toMatch(/until Sun 11 Oct/);
  });

  const nici = {
    title: 'Staying at Nici Bournemouth',
    start_time: '2026-08-23T00:00:00Z',
    end_time: '2026-08-23T23:59:59Z',
    all_day: true,
  };

  test('end-date extension reads "now until <date>" (the Nici change)', () => {
    const out = summariseEventChanges(nici, { end_time: '2026-08-26T23:59:59Z' }, TZ);
    expect(out).toMatch(/now until/);
    // formatDateLabel goes relative near today, so this assertion must not
    // depend on when the suite runs (it broke the day "26 Aug" became
    // "tomorrow").
    expect(out).toMatch(/26 Aug|tomorrow|today/);
  });

  test('same-day end-time change reads "now ends <time>"', () => {
    const prev = { title: 'Tennis', start_time: '2026-07-22T15:00:00Z', end_time: '2026-07-22T16:00:00Z' };
    const out = summariseEventChanges(prev, { end_time: '2026-07-22T17:00:00Z' }, TZ);
    expect(out).toMatch(/now ends/);
  });

  test('unchanged end_time contributes nothing', () => {
    const out = summariseEventChanges(nici, { end_time: nici.end_time, location: 'Bournemouth' }, TZ);
    expect(out).not.toMatch(/until|ends/);
    expect(out).toMatch(/now at Bournemouth/);
  });

  test('start move still reads "moved to" (existing behaviour intact)', () => {
    const out = summariseEventChanges(nici, { start_time: '2026-08-24T00:00:00Z' }, TZ);
    expect(out).toMatch(/moved to/);
  });
});
