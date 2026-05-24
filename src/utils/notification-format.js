/**
 * Shared helpers for the human-readable bits of cross-household
 * notifications - WhatsApp broadcasts and iOS push bodies.
 *
 * Two areas covered:
 *   • "for X" / "for X and Y" brackets to attach assignee context to
 *     "added task" / "added event" notifications, so the receiver can
 *     tell at a glance who's expected to action it (the original
 *     "Lynn added task: Fix outside light" notification was opaque
 *     about whose plate it landed on).
 *   • Update-diff one-liners ("moved to tomorrow, reassigned to Grant")
 *     for update_task / update_event notifications, so a vague
 *     "Lynn updated task: X" isn't the whole message.
 *
 * Pure functions, no DB / network. Easy to unit-test in isolation if
 * we want to later.
 */

/**
 * Join a list of names with British-English conjunction punctuation:
 *   ['Grant']                 → 'Grant'
 *   ['Grant', 'Lynn']         → 'Grant and Lynn'
 *   ['Grant', 'Lynn', 'Mason']→ 'Grant, Lynn and Mason'
 */
function joinNames(names) {
  const clean = (names || []).filter(Boolean);
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`;
}

/**
 * Inline "(for X)" bracket suffix - or '' if the task/event is
 * unassigned ("everyone"). Used at the end of "added task: Title"
 * style strings.
 */
function assigneeBracket(names) {
  const joined = joinNames(names);
  return joined ? ` (for ${joined})` : '';
}

/**
 * Format the date side of a task update diff. Tries to be relative
 * ("today" / "tomorrow") when the new date is imminent, otherwise
 * weekday + day + short month. Returns just the formatted date - the
 * verb ('moved to', 'now due') is the caller's choice.
 */
function formatDateLabel(yyyymmdd, tz = 'Europe/London') {
  if (!yyyymmdd) return '';
  try {
    // YYYY-MM-DD - parse as local in the household tz so 'today' /
    // 'tomorrow' comparisons stay correct across midnight.
    const target = new Date(`${yyyymmdd}T12:00:00`);
    const todayStr = new Date().toLocaleDateString('en-GB', { timeZone: tz });
    const tomorrow = new Date(Date.now() + 86400000);
    const targetStr = target.toLocaleDateString('en-GB', { timeZone: tz });
    if (targetStr === todayStr) return 'today';
    if (targetStr === tomorrow.toLocaleDateString('en-GB', { timeZone: tz })) return 'tomorrow';
    return target.toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: tz,
    });
  } catch {
    return yyyymmdd;
  }
}

/**
 * Format an ISO timestamp as HH:mm in the household tz.
 */
function formatHHMM(iso, tz = 'Europe/London') {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz,
    });
  } catch {
    return '';
  }
}

/**
 * Build a one-liner describing what changed on a task update.
 *
 * @param {object} prev - the task row BEFORE the update.
 * @param {object} updates - the fields being applied (subset of task row shape).
 * @param {string} tz - household IANA timezone.
 * @returns {string} e.g. 'moved to tomorrow, reassigned to Grant' - or
 *   '' if no material change to surface.
 */
function summariseTaskChanges(prev, updates, tz = 'Europe/London') {
  if (!prev || !updates) return '';
  const parts = [];

  if (updates.title !== undefined && updates.title !== prev.title) {
    parts.push(`renamed to "${updates.title}"`);
  }
  if (updates.due_date !== undefined && updates.due_date !== prev.due_date) {
    parts.push(updates.due_date
      ? `moved to ${formatDateLabel(updates.due_date, tz)}`
      : 'due date cleared');
  }
  if (updates.due_time !== undefined && updates.due_time !== prev.due_time) {
    parts.push(updates.due_time
      ? `due at ${String(updates.due_time).slice(0, 5)}`
      : 'time cleared');
  }
  if (updates.assigned_to_names !== undefined) {
    const oldNames = Array.isArray(prev.assigned_to_names) ? prev.assigned_to_names : [];
    const newNames = updates.assigned_to_names || [];
    if (JSON.stringify(oldNames) !== JSON.stringify(newNames)) {
      parts.push(newNames.length === 0
        ? 'reassigned to everyone'
        : `reassigned to ${joinNames(newNames)}`);
    }
  }
  if (updates.priority !== undefined && updates.priority !== prev.priority) {
    parts.push(`priority ${updates.priority}`);
  }
  if (updates.recurrence !== undefined && updates.recurrence !== prev.recurrence) {
    parts.push(updates.recurrence ? `now repeats ${updates.recurrence}` : 'no longer recurring');
  }
  return parts.join(', ');
}

/**
 * Build a one-liner describing what changed on a calendar-event
 * update. Same shape as summariseTaskChanges but for event fields.
 */
function summariseEventChanges(prev, updates, tz = 'Europe/London') {
  if (!prev || !updates) return '';
  const parts = [];

  if (updates.title !== undefined && updates.title !== prev.title) {
    parts.push(`renamed to "${updates.title}"`);
  }
  // start_time is an ISO timestamp - compare date parts vs time parts
  // separately so 'moved to Tuesday' and 'moved to 14:00' read
  // naturally rather than one merged 'moved to 2026-05-26T14:00' blob.
  if (updates.start_time !== undefined && updates.start_time !== prev.start_time) {
    const prevDate = prev.start_time ? String(prev.start_time).slice(0, 10) : null;
    const nextDate = String(updates.start_time).slice(0, 10);
    const prevHHMM = formatHHMM(prev.start_time, tz);
    const nextHHMM = formatHHMM(updates.start_time, tz);
    if (prevDate !== nextDate) {
      parts.push(`moved to ${formatDateLabel(nextDate, tz)}${nextHHMM ? ` at ${nextHHMM}` : ''}`);
    } else if (prevHHMM !== nextHHMM) {
      parts.push(`now ${nextHHMM}`);
    }
  }
  if (updates.location !== undefined && updates.location !== prev.location) {
    parts.push(updates.location ? `now at ${updates.location}` : 'location cleared');
  }
  if (updates.assigned_to_names !== undefined) {
    const oldNames = Array.isArray(prev.assigned_to_names) ? prev.assigned_to_names : [];
    const newNames = updates.assigned_to_names || [];
    if (JSON.stringify(oldNames) !== JSON.stringify(newNames)) {
      parts.push(newNames.length === 0
        ? 'reassigned to everyone'
        : `reassigned to ${joinNames(newNames)}`);
    }
  }
  if (updates.all_day !== undefined && updates.all_day !== prev.all_day) {
    parts.push(updates.all_day ? 'now all-day' : 'no longer all-day');
  }
  return parts.join(', ');
}

module.exports = {
  joinNames,
  assigneeBracket,
  summariseTaskChanges,
  summariseEventChanges,
};
