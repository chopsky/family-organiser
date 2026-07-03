/**
 * Convert a household-local wall-clock time to a UTC ISO string.
 *
 * localToUTC('2026-07-06', '17:30', 'Europe/London') → '2026-07-06T16:30:00Z'
 *
 * Same algorithm as the copies in routes/chat.js and bot/handlers.js
 * (extracted here for the outbound calendar feed): treat the local string
 * as UTC, ask Intl what that instant reads as in the target timezone, and
 * the difference is the zone's offset at that date - which makes the
 * conversion DST-correct per date, not per "now".
 */
function localToUTC(date, time, timezone) {
  if (!timezone) return `${date}T${time || '00:00'}:00Z`;
  try {
    const localStr = `${date}T${time || '00:00'}:00`;
    const dt = new Date(localStr + 'Z');
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(dt);
    const get = (type) => parts.find(p => p.type === type)?.value || '00';
    const tzDate = `${get('year')}-${get('month')}-${get('day')}`;
    const tzTime = `${get('hour')}:${get('minute')}:${get('second')}`;

    const localMs = new Date(localStr + 'Z').getTime();
    const inTzMs = new Date(`${tzDate}T${tzTime}Z`).getTime();
    const offsetMs = inTzMs - localMs;

    return new Date(localMs - offsetMs).toISOString().replace('.000Z', 'Z');
  } catch {
    return `${date}T${time || '00:00'}:00Z`;
  }
}

module.exports = { localToUTC };
