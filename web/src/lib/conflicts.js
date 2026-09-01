// Same-person double-booking detection for the UI chips - the client twin
// of src/services/conflicts.js (same rule, same exclusions). A conflict is
// two TIMED items whose windows overlap and whose assignee sets share a
// current member. All-day items, holidays, birthdays and unassigned
// (household-wide) items never conflict.

const EXCLUDED = new Set(['public_holiday', 'birthday']);
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

function memberIdSet(item, members) {
  const ids = new Set();
  const current = new Set(members.map((m) => m.id));
  const byName = new Map(members.map((m) => [String(m.name || '').toLowerCase(), m.id]));
  if (Array.isArray(item.assignees)) {
    for (const a of item.assignees) if (a?.member_id && current.has(a.member_id)) ids.add(a.member_id);
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

function windowOf(item) {
  if (item.all_day || EXCLUDED.has(item.category) || !item.start_time) return null;
  const start = new Date(item.start_time).getTime();
  if (Number.isNaN(start)) return null;
  let end = item.end_time ? new Date(item.end_time).getTime() : NaN;
  if (Number.isNaN(end) || end <= start) end = start + DEFAULT_DURATION_MS;
  return { start, end };
}

export function itemKey(item) {
  return item.occurrence_key || item.id;
}

/**
 * Keys (occurrence_key || id) of every item in the list that is part of a
 * same-person overlap. Pass ONE day's events (the shapes the calendar and
 * dashboard already hold - expanded, deduped).
 */
export function conflictedKeys(items, members) {
  const out = new Set();
  if (!Array.isArray(items) || !Array.isArray(members) || members.length === 0) return out;
  const entries = [];
  for (const item of items) {
    const win = windowOf(item);
    if (!win) continue;
    const ids = memberIdSet(item, members);
    if (ids.size === 0) continue;
    entries.push({ item, win, ids });
  }
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const A = entries[i]; const B = entries[j];
      if (A.item.id && A.item.id === B.item.id) continue;
      if (!(A.win.start < B.win.end && B.win.start < A.win.end)) continue;
      let shared = false;
      for (const id of A.ids) if (B.ids.has(id)) { shared = true; break; }
      if (!shared) continue;
      out.add(itemKey(A.item));
      out.add(itemKey(B.item));
    }
  }
  return out;
}
