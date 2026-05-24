/**
 * Render a human-readable date/time line for an event, suitable for
 * dropping into a push body or a WhatsApp broadcast - "Sat 30 May,
 * 10:00-11:00" / "Sat 30 May, all day" / "Tomorrow, 14:00".
 *
 * Shared between routes/calendar.js (web-app event creation broadcast)
 * and bot/handlers.js (WhatsApp bot event creation broadcast) so both
 * notification paths read identically - previously the bot path sent
 * a bare title ("Grant added event: Padel") while the web-app path
 * sent the rich format ("Grant added event: testing - Today, 09:00-10:00").
 *
 * Inputs:
 *   event: { start_time, end_time, all_day } - timestamps may be ISO
 *          (TIMESTAMPTZ from Postgres) or "YYYY-MM-DD HH:mm" style.
 *   tz:    IANA timezone (household.timezone), defaults to Europe/London.
 *
 * Returns '' if no usable start info - the caller can fall back to a
 * bare title. Never throws.
 */
function formatEventWhen(event, tz = 'Europe/London') {
  if (!event?.start_time) return '';
  try {
    const start = new Date(event.start_time);
    if (isNaN(start.getTime())) return '';

    // Date label - relative if it's today / tomorrow (more useful than
    // the absolute date when the event is imminent), otherwise weekday
    // + day + short month.
    const today = new Date();
    const isSameDay = (a, b) =>
      a.toLocaleDateString('en-GB', { timeZone: tz }) ===
      b.toLocaleDateString('en-GB', { timeZone: tz });
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let dateLabel;
    if (isSameDay(start, today)) {
      dateLabel = 'Today';
    } else if (isSameDay(start, tomorrow)) {
      dateLabel = 'Tomorrow';
    } else {
      dateLabel = start.toLocaleDateString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short', timeZone: tz,
      });
    }

    if (event.all_day) return `${dateLabel}, all day`;

    const formatHM = (iso) => new Date(iso).toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz,
    });
    const startHM = formatHM(event.start_time);
    const endHM = event.end_time ? formatHM(event.end_time) : null;
    const timeStr = endHM ? `${startHM}-${endHM}` : startHM;
    return `${dateLabel}, ${timeStr}`;
  } catch {
    return '';
  }
}

module.exports = { formatEventWhen };
