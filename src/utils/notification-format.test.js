/**
 * Change-summary tests. The end_time branch is the load-bearing one: an
 * end-only change ("change it to 23-26 Aug") used to produce an EMPTY
 * summary, so the user saw a bare 'Updated "X".' with no idea what changed
 * (real 2026-07-22 Nici Bournemouth transcript).
 */
const { summariseEventChanges } = require('./notification-format');

const TZ = 'Europe/London';

describe('summariseEventChanges', () => {
  const nici = {
    title: 'Staying at Nici Bournemouth',
    start_time: '2026-08-23T00:00:00Z',
    end_time: '2026-08-23T23:59:59Z',
    all_day: true,
  };

  test('end-date extension reads "now until <date>" (the Nici change)', () => {
    const out = summariseEventChanges(nici, { end_time: '2026-08-26T23:59:59Z' }, TZ);
    expect(out).toMatch(/now until/);
    expect(out).toMatch(/26 Aug/);
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
