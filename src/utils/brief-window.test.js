/**
 * The daily brief's send gate is a WINDOW, not a single minute. The job runs
 * every minute and walks households sequentially; a slow household used to push
 * everyone behind it past a hard `=== '07:00'` check, silently skipping the
 * tail of the list for the whole day (2 consecutive misses, 22-23 Jul). The
 * window lets a slow morning delay the tail by a minute or two instead. The
 * per-member day-lock (tested elsewhere) still guarantees exactly one send.
 */
const { hhmmWithinWindow } = require('../utils/brief-window');

describe('hhmmWithinWindow (daily-brief send gate)', () => {
  const START = '07:00';
  const WIN = 30;

  test('the exact start minute is in the window', () => {
    expect(hhmmWithinWindow('07:00', START, WIN)).toBe(true);
  });

  test('a household reached late in the loop (07:01, 07:15, 07:29) still sends', () => {
    expect(hhmmWithinWindow('07:01', START, WIN)).toBe(true); // the exact miss on 22-23 Jul
    expect(hhmmWithinWindow('07:15', START, WIN)).toBe(true);
    expect(hhmmWithinWindow('07:29', START, WIN)).toBe(true);
  });

  test('the end of the window is exclusive (07:30 is out)', () => {
    expect(hhmmWithinWindow('07:30', START, WIN)).toBe(false);
  });

  test('before the window never fires', () => {
    expect(hhmmWithinWindow('06:59', START, WIN)).toBe(false);
    expect(hhmmWithinWindow('06:30', START, WIN)).toBe(false);
    expect(hhmmWithinWindow('00:00', START, WIN)).toBe(false);
  });

  test('well after the window never fires (no accidental all-day resend)', () => {
    expect(hhmmWithinWindow('07:31', START, WIN)).toBe(false);
    expect(hhmmWithinWindow('08:00', START, WIN)).toBe(false);
    expect(hhmmWithinWindow('23:59', START, WIN)).toBe(false);
  });

  test('garbage / missing time is treated as out of window (fail closed)', () => {
    expect(hhmmWithinWindow('', START, WIN)).toBe(false);
    expect(hhmmWithinWindow('not-a-time', START, WIN)).toBe(false);
  });
});
