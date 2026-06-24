// Chores domain logic - pure, DB-free helpers for the redesigned Tasks page.
//
// Tasks are RECURRING DEFINITIONS that generate each day's view; completion is
// tracked per person AND per day. These helpers turn a set of definitions +
// the completion rows for one date into the day's view, and decide which
// definitions apply on a given date. Kept pure so the recurrence rules (the
// easy thing to get subtly wrong) are unit-tested without a database.

const WD_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/**
 * The weekday abbreviation ('MON'..'SUN') for a 'YYYY-MM-DD' date string.
 * Parsed as a local calendar date (not UTC) so it never drifts across a
 * timezone boundary - the date string already encodes the household's day.
 */
function weekdayAbbrev(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return WD_ABBR[new Date(y, (m || 1) - 1, d || 1).getDay()];
}

/**
 * Does a chore definition apply on `dateStr` ('YYYY-MM-DD')?
 *  - hidden before its start_date;
 *  - weekly  -> the date's weekday is in `days`;
 *  - once    -> due_date matches exactly;
 *  - daily   -> always.
 * Archived definitions never apply.
 */
function appliesOn(def, dateStr) {
  if (!def || def.archived_at) return false;
  if (def.start_date && dateStr < def.start_date) return false;
  if (def.repeat === 'weekly') return (def.days || []).includes(weekdayAbbrev(dateStr));
  if (def.repeat === 'once') return def.due_date === dateStr;
  return true; // daily (or unset)
}

/**
 * Build the day's view: the definitions that apply on `dateStr`, each annotated
 * with a per-member `done` map keyed by member id (from that date's completion
 * rows). Mirrors the demo's `done: { memberId: bool }`, but real + per-day.
 *
 * A routine assigned to several time-of-day slots (e.g. Morning + Evening)
 * expands into one INDEPENDENT instance per slot, each carrying its own `slot`
 * + `occurrence_key` and its own per-member `done`. Chores and "Anyone" chores
 * are slotless (one instance, `slot: ''`). Completions are keyed by
 * (definition, slot) so ticking Morning never marks Evening done.
 *
 * @param {Array} defs        chore_definitions rows
 * @param {Array} completions chore_completions rows for THIS date only
 *                            (each: { definition_id, member_id, slot })
 * @param {string} dateStr    'YYYY-MM-DD'
 * @returns instances (sorted by position, then created_at) with `done`, `slot`
 *          and `occurrence_key` added.
 */
function buildDayView(defs, completions, dateStr) {
  const doneByDefSlot = new Map(); // `${definition_id}|${slot}` -> Set(member_id)
  for (const c of completions || []) {
    const k = `${c.definition_id}|${c.slot || ''}`;
    if (!doneByDefSlot.has(k)) doneByDefSlot.set(k, new Set());
    doneByDefSlot.get(k).add(c.member_id);
  }
  const out = [];
  for (const d of (defs || [])) {
    if (!appliesOn(d, dateStr)) continue;
    // "Anyone" chores have no per-assignee state: a single shared completion
    // (the attributed completer) marks the whole chore done for the day.
    if (d.anyone) {
      const who = doneByDefSlot.get(`${d.id}|`);
      const completedBy = who && who.size ? [...who][0] : null;
      out.push({ ...d, slot: '', occurrence_key: d.id, done: {}, completed: !!completedBy, completed_by: completedBy });
      continue;
    }
    // Multi-slot routines render once per slot; everything else is one slotless
    // instance. A routine with no whens still gets a single '' instance.
    const slots = (d.type === 'routine' && (d.whens || []).length) ? d.whens : [''];
    for (const slot of slots) {
      const doneSet = doneByDefSlot.get(`${d.id}|${slot}`) || new Set();
      const done = {};
      for (const mid of d.assignee_ids || []) done[mid] = doneSet.has(mid);
      out.push({ ...d, slot, occurrence_key: slot ? `${d.id}|${slot}` : d.id, done });
    }
  }
  return out.sort((a, b) => (a.position - b.position) || String(a.created_at).localeCompare(String(b.created_at)));
}

module.exports = { weekdayAbbrev, appliesOn, buildDayView };
