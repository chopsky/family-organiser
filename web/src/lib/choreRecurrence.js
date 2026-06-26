// Chore recurrence + week helpers for the desktop Tasks "Week" view.
//
// appliesOnDate() and weekdayAbbrev() MIRROR src/services/chores.js exactly, so
// the week grid's "does this run today?" never disagrees with the server's Day
// view. Keep the two in lockstep.

const WD_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const WD_LABEL = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };

function ymd(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// Weekday abbreviation ('MON'..'SUN') for a 'YYYY-MM-DD' string, parsed as a
// LOCAL calendar date (never UTC) so it can't drift across a tz boundary.
export function weekdayAbbrev(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return WD_ABBR[new Date(y, (m || 1) - 1, d || 1).getDay()];
}

// Does a definition apply on dateStr? Hidden before start_date; weekly → the
// weekday is in `days`; once → due_date matches; daily → always. Archived never.
export function appliesOnDate(def, dateStr) {
  if (!def || def.archived_at) return false;
  if (def.start_date && dateStr < def.start_date) return false;
  if (def.repeat === 'weekly') return (def.days || []).includes(weekdayAbbrev(dateStr));
  if (def.repeat === 'once') return def.due_date === dateStr;
  return true; // daily (or unset)
}

// The 7 day objects for the Monday-anchored week starting at fromStr.
// past/today/future are relative to todayStr (the household's today).
export function buildWeek(fromStr, todayStr) {
  const [y, m, d] = String(fromStr).split('-').map(Number);
  const start = new Date(y, (m || 1) - 1, d || 1);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(start);
    dt.setDate(start.getDate() + i);
    const str = ymd(dt);
    const wd = WD_ABBR[dt.getDay()];
    days.push({
      str,
      wd,
      label: WD_LABEL[wd],
      dom: dt.getDate(),
      isToday: str === todayStr,
      isPast: str < todayStr,
      isFuture: str > todayStr,
    });
  }
  return days;
}

// Expand a member's NON-anyone definitions into per-(definition, slot) row
// instances, grouped into the four time-of-day sections. A multi-slot routine
// yields one row per slot (Morning/Evening…); a slotless routine and every
// chore land in 'chores'. Mirrors buildDayView's instance expansion + ordering.
export function weekRowsForMember(defs, memberId) {
  const sections = { morning: [], afternoon: [], evening: [], chores: [] };
  for (const def of defs || []) {
    if (def.archived_at || def.anyone) continue;
    if (!(def.assignee_ids || []).includes(memberId)) continue;
    const slots = (def.type === 'routine' && (def.whens || []).length) ? def.whens : [''];
    for (const slot of slots) {
      const section = slot || 'chores';
      if (!sections[section]) continue;
      sections[section].push({ def, slot, occurrenceKey: slot ? `${def.id}|${slot}` : def.id });
    }
  }
  for (const k of Object.keys(sections)) {
    sections[k].sort((a, b) => (a.def.position - b.def.position) || String(a.def.created_at).localeCompare(String(b.def.created_at)));
  }
  return sections;
}

// Lookup sets from the /week payload, for O(1) cell reads.
export function completionSet(completions) {
  const s = new Set();
  for (const c of completions || []) s.add(`${c.definition_id}|${c.slot || ''}|${c.member_id}|${c.date}`);
  return s;
}
export function skipSet(skips) {
  const s = new Set();
  for (const sk of skips || []) s.add(`${sk.definition_id}|${sk.date}`);
  return s;
}
