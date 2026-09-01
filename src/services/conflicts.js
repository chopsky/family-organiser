/**
 * Scheduling-conflict detection - "the same person, double-booked".
 *
 * A conflict is two TIMED items whose windows overlap and whose assignee
 * sets share at least one current household member. That one rule catches
 * what parents actually care about ("Leo is at football AND on the party
 * invite", "Dad's synced work meeting overlaps the pickup assigned to
 * Dad") without the noise a bare any-overlap check would produce - two
 * adults at two different events at the same time is Tuesday, not a
 * conflict.
 *
 * Deliberately excluded (v1):
 * - All-day items (birthday + party is fine), public holidays, birthdays.
 * - Unassigned/household-wide items: treating "everyone" as an assignee
 *   would make every busy Saturday scream.
 * - Travel-time adjacency, resolution UI, dedicated push category. The
 *   brief and the save-moment reply are the quiet channels.
 *
 * Detection is pure interval maths - no AI call, so it never touches the
 * free-tier assistant meter.
 */

const db = require('../db/queries');
const { expandActivityOccurrences } = require('./activity-occurrences');

const EXCLUDED_CATEGORIES = new Set(['public_holiday', 'birthday']);
const DEFAULT_DURATION_MS = 60 * 60 * 1000; // events saved without an end

/**
 * Resolve an item's assignees to a Set of CURRENT member ids, from every
 * shape the estate uses: event_assignees-derived `assignees` rows,
 * assigned_to_ids, and assigned_to_names mapped onto current members -
 * the same identity-first sources the web calendar's filter uses.
 * Synced external-feed events carry assigned_to_ids/names from their
 * feed's owner attribution, so they participate like native rows.
 */
function resolveMemberIdSet(item, members) {
  const ids = new Set();
  const current = new Set(members.map((m) => m.id));
  const byName = new Map(members.map((m) => [String(m.name || '').toLowerCase(), m.id]));
  if (Array.isArray(item.assignees)) {
    for (const a of item.assignees) {
      if (a?.member_id && current.has(a.member_id)) ids.add(a.member_id);
    }
  }
  if (Array.isArray(item.assigned_to_ids)) {
    for (const id of item.assigned_to_ids) if (current.has(id)) ids.add(id);
  }
  if (Array.isArray(item.assigned_to_names)) {
    for (const n of item.assigned_to_names) {
      const id = byName.get(String(n || '').toLowerCase());
      if (id) ids.add(id);
    }
  }
  return ids;
}

/** Timed window in ms, or null when the item can't conflict. */
function itemWindow(item) {
  if (item.all_day) return null;
  if (EXCLUDED_CATEGORIES.has(item.category)) return null;
  if (!item.start_time) return null;
  const startMs = new Date(item.start_time).getTime();
  if (Number.isNaN(startMs)) return null;
  let endMs = item.end_time ? new Date(item.end_time).getTime() : NaN;
  if (Number.isNaN(endMs) || endMs <= startMs) endMs = startMs + DEFAULT_DURATION_MS;
  return { startMs, endMs };
}

/**
 * Find member-scoped overlapping pairs in a list of expanded items
 * (calendar events + activity occurrences, one day or a few).
 *
 * Returns [{ a, b, memberIds, memberNames, overlapStartMs }] sorted by
 * overlap start. Items that resolve to no current member are skipped, and
 * title+start twins (a native row and its synced copy) are deduped first
 * so an event can never "conflict" with its own mirror.
 */
function detectConflicts(items, members) {
  const nameById = new Map(members.map((m) => [m.id, m.name]));

  // Dedup native-vs-synced twins (server reads don't dedupe like the web
  // does): same title + same start is one real-world event.
  const seen = new Set();
  const deduped = [];
  for (const item of items || []) {
    const key = `${String(item.title || '').trim().toLowerCase()}|${item.start_time || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  const entries = [];
  for (const item of deduped) {
    const win = itemWindow(item);
    if (!win) continue;
    const memberIds = resolveMemberIdSet(item, members);
    if (memberIds.size === 0) continue; // household-wide: excluded by design
    entries.push({ item, win, memberIds });
  }

  const pairs = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const A = entries[i]; const B = entries[j];
      if (A.item.id && A.item.id === B.item.id) continue; // same series twice
      if (!(A.win.startMs < B.win.endMs && B.win.startMs < A.win.endMs)) continue;
      const shared = [...A.memberIds].filter((id) => B.memberIds.has(id));
      if (shared.length === 0) continue;
      pairs.push({
        a: A.item,
        b: B.item,
        memberIds: shared,
        memberNames: shared.map((id) => nameById.get(id)).filter(Boolean),
        overlapStartMs: Math.max(A.win.startMs, B.win.startMs),
      });
    }
  }
  pairs.sort((x, y) => x.overlapStartMs - y.overlapStartMs);
  return pairs;
}

/** "15:04" in the household's timezone. */
function fmtTime(iso, tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz || 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

/**
 * Gather one day's conflict-relevant items (expanded calendar events +
 * activity occurrences) and detect. Best-effort by design: any failure
 * returns an empty result - a conflict warning is garnish, never worth
 * failing a save or a brief over.
 */
async function findConflictsForDate(householdId, dateYmd, { members: knownMembers, timezone } = {}) {
  try {
    const members = knownMembers || await db.getHouseholdMembers(householdId);
    const household = timezone ? null : await db.getHouseholdById(householdId).catch(() => null);
    const tz = timezone || household?.timezone || 'Europe/London';

    const events = await db.getCalendarEvents(
      householdId, `${dateYmd}T00:00:00`, `${dateYmd}T23:59:59`,
    ).catch(() => []);

    let activityRows = [];
    try {
      const dependents = (members || []).filter((m) => m.member_type === 'dependent');
      const lists = await Promise.all(dependents.map((c) => db.getChildActivities(c.id).catch(() => [])));
      activityRows = lists.flat();
    } catch { activityRows = []; }
    const activityOccurrences = expandActivityOccurrences(activityRows, members, dateYmd, dateYmd, tz);

    const pairs = detectConflicts([...(events || []), ...activityOccurrences], members || []);
    return { pairs, tz, members };
  } catch (err) {
    console.warn('[conflicts] check skipped:', err?.message || err);
    return { pairs: [], tz: timezone || 'Europe/London', members: knownMembers || [] };
  }
}

/**
 * Save-moment helper: conflicts a just-created/updated event is part of,
 * as a single reply-ready line, or null. `eventId` scopes the pairs;
 * recurring events are checked on the saved occurrence's own day only.
 */
async function conflictLineForEvent(householdId, event, { members, timezone } = {}) {
  if (!event?.start_time || event.all_day) return null;
  const dateYmd = String(event.start_time).split('T')[0];
  const { pairs, tz } = await findConflictsForDate(householdId, dateYmd, { members, timezone });
  const mine = pairs.filter((p) => (p.a.id && p.a.id === event.id) || (p.b.id && p.b.id === event.id));
  if (mine.length === 0) return null;
  const first = mine[0];
  const other = (first.a.id === event.id) ? first.b : first.a;
  const range = other.end_time
    ? `${fmtTime(other.start_time, tz)}–${fmtTime(other.end_time, tz)}`
    : fmtTime(other.start_time, tz);
  const who = first.memberNames[0] ? `${first.memberNames[0]} is` : 'this is';
  const extra = mine.length > 1 ? ` (and ${mine.length - 1} more clash${mine.length > 2 ? 'es' : ''})` : '';
  return `⚠️ Heads up: ${who} also down for "${other.title}" ${range}${extra}.`;
}

/**
 * Brief helper: at most two "double-booked" lines for a day, or [].
 * Grouped per pair; the brief stays calm ("+N more" past two).
 */
function briefConflictLines(pairs, tz) {
  if (!pairs || pairs.length === 0) return [];
  const lines = pairs.slice(0, 2).map((p) => {
    const who = p.memberNames.length ? p.memberNames.join(' & ') : 'Someone';
    return `⚠️ ${who} double-booked: "${p.a.title}" and "${p.b.title}" overlap at ${fmtTime(new Date(p.overlapStartMs).toISOString(), tz)}`;
  });
  if (pairs.length > 2) lines.push(`⚠️ +${pairs.length - 2} more clashes today`);
  return lines;
}

module.exports = {
  detectConflicts,
  findConflictsForDate,
  conflictLineForEvent,
  briefConflictLines,
  resolveMemberIdSet,
  itemWindow,
};
