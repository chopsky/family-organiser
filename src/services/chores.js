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
 *  - daily   -> always;
 *  - once    -> exactly ONE day, see below.
 * Archived definitions never apply.
 *
 * ── One-offs land on exactly one day ──────────────────────────────────────
 * A one-off is a single thing, so it occupies a single square:
 *
 *   done      -> the day it was ticked, so the record and the star survive
 *   undone    -> its due date, or TODAY once that date has passed
 *
 * The first version of this carried a one-off across every day from its due
 * date onward, which broke three ways: it ran into future days (a task isn't
 * overdue on a day that hasn't happened); ticking it made it vanish from the
 * day it was ticked; and because star credit is keyed by (definition, member,
 * DATE), the same task could be ticked on its due date AND on a carried day
 * for double stars. One day, one instance, one tick closes all three.
 *
 * Routines are exempt from the carry: a routine is a habit, not a debt, so a
 * missed one resets rather than following you around. (Routines shouldn't be
 * one-off at all - the form no longer offers it - but existing rows exist.)
 *
 * @param opts.today  the household's today ('YYYY-MM-DD')
 * @param opts.doneOn Map of definition id -> the date it was completed
 * Omit `today` and a one-off shows only on its own due date: without knowing
 * the present we can't say where an overdue one belongs, so we don't guess.
 */
function appliesOn(def, dateStr, opts = {}) {
  const { today, doneOn } = opts;
  if (!def || def.archived_at) return false;
  if (def.start_date && dateStr < def.start_date) return false;
  if (def.repeat === 'weekly') return (def.days || []).includes(weekdayAbbrev(dateStr));
  if (def.repeat === 'once') return dateStr === oneOffDay(def, today, doneOn);
  return true; // daily (or unset)
}

/**
 * The single day a one-off occupies, or null if it has none (no due date, so
 * nothing to anchor it to - such rows were a bug and are backfilled).
 */
function oneOffDay(def, today, doneOn) {
  if (!def.due_date) return null;
  const completedOn = doneOn && doneOn.get(def.id);
  if (completedOn) return completedOn;
  if (!today) return def.due_date;             // caller can't place an overdue one
  if (def.type === 'routine') return def.due_date; // habits don't accrue
  return def.due_date > today ? def.due_date : today;
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
function buildDayView(defs, completions, dateStr, opts = {}) {
  const doneByDefSlot = new Map(); // `${definition_id}|${slot}` -> Set(member_id)
  for (const c of completions || []) {
    const k = `${c.definition_id}|${c.slot || ''}`;
    if (!doneByDefSlot.has(k)) doneByDefSlot.set(k, new Set());
    doneByDefSlot.get(k).add(c.member_id);
  }
  const out = [];
  for (const d of (defs || [])) {
    if (!appliesOn(d, dateStr, opts)) continue;
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
      const carried = d.repeat === 'once' && d.due_date && dateStr > d.due_date;
      out.push({ ...d, slot, occurrence_key: slot ? `${d.id}|${slot}` : d.id, done, carried_from: carried ? d.due_date : null });
    }
  }
  return out.sort((a, b) => (a.position - b.position) || String(a.created_at).localeCompare(String(b.created_at)));
}

module.exports = { weekdayAbbrev, appliesOn, oneOffDay, buildDayView };
