/**
 * Send-gate window maths for time-of-day scheduler jobs. Pure + dependency-free
 * so it's unit-testable without the DB/AI module graph.
 *
 * The daily brief job runs every minute and walks households sequentially; a
 * hard `now === '07:00'` gate meant any slow household pushed everyone behind it
 * past the minute and they were skipped for the whole day. A window fixes that:
 * the per-member day-lock still guarantees exactly one send, so re-checking
 * across the ticks in the window is safe.
 */

/**
 * Is "HH:MM" within [start, start+windowMin)? Same-day only (a morning window
 * like 07:00-07:30 never crosses midnight), so plain minute-of-day comparison.
 * Unparseable input returns false (fail closed - never send at the wrong time).
 */
function hhmmWithinWindow(nowHHMM, startHHMM, windowMin) {
  const toMin = (s) => {
    const parts = String(s).split(':');
    if (parts.length !== 2) return NaN;
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    return Number.isInteger(h) && Number.isInteger(m) ? h * 60 + m : NaN;
  };
  const now = toMin(nowHHMM);
  const start = toMin(startHHMM);
  return Number.isFinite(now) && Number.isFinite(start) && now >= start && now < start + windowMin;
}

module.exports = { hhmmWithinWindow };
