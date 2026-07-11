/**
 * Expand weekly extracurricular activities (child_weekly_schedule rows) into
 * concrete dated occurrences for a date range.
 *
 * Same rules as the outbound iCal feed in routes/calendar.js (the original
 * inline implementation): day_of_week is Monday=0 (app-wide convention),
 * term windows (start_date/end_date) bound the series, per-date skips drop
 * an occurrence, per-date overrides replace its time, and each occurrence's
 * wall-clock time converts to UTC per date via localToUTC so DST transitions
 * stay correct.
 *
 * Returns rows shaped like calendar events ({ title, start_time, end_time,
 * all_day, assigned_to_names }) so consumers like formatEventWhen and the
 * bot's calendar-answer formatter can treat them uniformly. Each row also
 * carries { activity_id, show_on_calendar } so callers can respect the
 * "hidden from adult calendar" flag for browse-style lists while still
 * finding hidden activities for direct "when is X?" questions.
 */
const { localToUTC } = require('../utils/local-time');

/**
 * @param {Array} activities  child_weekly_schedule rows (with skips/overrides)
 * @param {Array} members     household members (to resolve child names)
 * @param {string} startYmd   inclusive YYYY-MM-DD
 * @param {string} endYmd     inclusive YYYY-MM-DD
 * @param {string} timezone   IANA household timezone
 */
function expandActivityOccurrences(activities, members, startYmd, endYmd, timezone = 'Europe/London') {
  if (!Array.isArray(activities) || activities.length === 0) return [];
  const nameById = new Map((members || []).map((m) => [m.id, m.name]));
  const out = [];

  const [sy, sm, sd] = startYmd.split('-').map(Number);
  const [ey, em, ed] = endYmd.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  // Hard cap the walk (the bot can ask for ~12-month "when is X?" ranges).
  const MAX_DAYS = 400;

  for (let i = 0; i < MAX_DAYS; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    if (d > end) break;
    const wd = (d.getDay() + 6) % 7; // 0=Monday, app-wide convention
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    for (const act of activities) {
      if (act.day_of_week !== wd) continue;
      if (act.start_date && dateStr < act.start_date) continue;
      if (act.end_date && dateStr > act.end_date) continue;
      if (act.skips && act.skips.includes(dateStr)) continue;
      const ov = act.overrides ? act.overrides[dateStr] : null;
      const effStart = ov ? ov.time_start : act.time_start;
      const effEnd = ov ? ov.time_end : act.time_end;
      const childName = nameById.get(act.child_id);
      const row = {
        activity_id: act.id,
        title: childName ? `${childName} - ${act.activity}` : act.activity,
        assigned_to_names: childName ? [childName] : [],
        show_on_calendar: act.show_on_calendar !== false,
      };
      if (effStart) {
        row.start_time = localToUTC(dateStr, String(effStart).slice(0, 5), timezone);
        row.end_time = effEnd
          ? localToUTC(dateStr, String(effEnd).slice(0, 5), timezone)
          : new Date(new Date(row.start_time).getTime() + 3600000).toISOString();
        row.all_day = false;
      } else {
        row.start_time = `${dateStr}T00:00:00Z`;
        row.end_time = `${dateStr}T23:59:59Z`;
        row.all_day = true;
      }
      out.push(row);
    }
  }
  return out;
}

module.exports = { expandActivityOccurrences };
