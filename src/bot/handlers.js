/**
 * Channel-agnostic message handlers.
 *
 * These functions process incoming messages (text, voice, photos) and return
 * response strings. They don't depend on any specific messaging
 * platform — the WhatsApp webhook calls them.
 */

const db = require('../db/queries');
const { classify, scanReceipt, matchReceiptToList, scanImage } = require('../services/ai');
const { transcribeVoice } = require('../services/transcribe');
const { getWeatherReport, getCoordsFromTimezone, extractLocationFromMessage, geocodeLocation } = require('../services/weather');
const { callWithFailover } = require('../services/ai-client');
const push = require('../services/push');
const broadcast = require('../services/broadcast');
const calendarSync = require('../services/calendarSync');

// ─── Trivial-message short-circuit (no AI call) ───────────────────────────────
//
// Saves the 1–2 second AI round-trip + token cost on messages that don't
// actually need classification (greetings, thanks, emoji-only). Only covers
// patterns that can't plausibly be answering a bot question — "yes"/"no"/"ok"
// are deliberately NOT matched here because they might be disambiguation
// replies, dupe-confirm answers, etc.
function matchTrivialMessage(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const lower = t.toLowerCase().replace(/[!.?]+$/, '').trim();

  // Greetings
  if (/^(hi|hey|hello|howdy|hiya|yo|morning|afternoon|evening|good (morning|afternoon|evening)|greetings)$/i.test(lower)) {
    return { response: '👋 Hi! What can I help with?' };
  }
  // Thanks
  if (/^(thanks|thank you|thankyou|ty|thx|cheers|ta|appreciate it|much appreciated|thanks so much|thanks a lot)$/i.test(lower)) {
    return { response: 'Anytime! 😊' };
  }
  // Emoji-only up to a short length — reply in kind. Strip whitespace +
  // simple punctuation, require the remainder to be entirely pictographs.
  // Does NOT match complex ZWJ sequences (e.g. 👨‍👩‍👧) — they fall through
  // to the AI path, which is fine; the short-circuit is an optimisation,
  // not a correctness requirement.
  const stripped = t.replace(/[\s!?.]/g, '');
  if (stripped.length > 0 && stripped.length <= 12 && /^\p{Extended_Pictographic}+$/u.test(stripped)) {
    return { response: '👍' };
  }
  return null;
}

// ─── Undo store (in-memory, per user, 2-minute TTL) ───────────────────────────
//
// Tracks the last add so the user can reverse it with 'undo' / 'scrap that'
// within a short window. In-memory is fine for v1: Railway rarely restarts,
// and if it does, the undo window expires within minutes anyway. Only ADDs
// are tracked — deletes/updates get their own undo story later (need to
// store the prior state to revert).
const recentAdds = new Map(); // userId → { kind, ids: uuid[], label: string, timestamp }
const UNDO_WINDOW_MS = 2 * 60 * 1000;

function rememberAdd(userId, kind, ids, label) {
  if (!userId || !ids?.length) return;
  recentAdds.set(userId, { kind, ids: Array.isArray(ids) ? ids : [ids], label, timestamp: Date.now() });
}

function popRecentAdd(userId) {
  const entry = recentAdds.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > UNDO_WINDOW_MS) {
    recentAdds.delete(userId);
    return null;
  }
  recentAdds.delete(userId);
  return entry;
}

function isUndoRequest(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[!.?]+$/, '').trim();
  return /^(undo|revert|scrap that|scrap it|nevermind|never mind|forget it|cancel that|oops|nope scrap that|wait no|undo that|take that back)$/i.test(t);
}

// ─── Pending disambiguation store (in-memory, per user, 5-minute TTL) ─────────
//
// When handleModifyIntent finds multiple candidates it sends a "which one?"
// prompt. We stash the candidate list + the original intent here so the
// user's follow-up ("1", "the second one", or a candidate title) can be
// resolved without going through the LLM — which has no concept of "this
// is option N from the list I just showed".
//
// In-memory matches the recentAdds precedent above. 5-minute TTL is well
// inside any plausible reply window; if the user doesn't answer in 5 mins
// they'll just need to restate the change.
const pendingDisambiguations = new Map(); // userId → { intent, candidates, updates, householdId, timestamp }
const DISAMBIGUATION_WINDOW_MS = 5 * 60 * 1000;

function rememberDisambiguation(userId, entry) {
  if (!userId || !entry?.candidates?.length) return;
  pendingDisambiguations.set(userId, { ...entry, timestamp: Date.now() });
}

function popPendingDisambiguation(userId) {
  const entry = pendingDisambiguations.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > DISAMBIGUATION_WINDOW_MS) {
    pendingDisambiguations.delete(userId);
    return null;
  }
  pendingDisambiguations.delete(userId);
  return entry;
}

/**
 * Given a user message and a pending disambiguation entry, resolve which
 * candidate the user picked. Returns the candidate object, or null if the
 * message can't be confidently mapped.
 *
 * Accepts: "1" / "1." / "#1" / "the first" / "first one" / a substring of
 * a candidate's distinguishing detail (e.g. "april" or "21 jul").
 */
function resolveDisambiguationChoice(text, entry) {
  const t = String(text || '').trim().toLowerCase().replace(/[!.?]+$/, '').trim();
  if (!t) return null;

  // Numeric: "1", "1.", "#1", "option 1"
  const numMatch = t.match(/^(?:#|option\s+|number\s+)?(\d+)\.?$/);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (n >= 1 && n <= entry.candidates.length) return entry.candidates[n - 1];
    return null;
  }

  // Ordinal words for the first 5 (matches the disambiguation prompt's slice(0,5))
  const ordinals = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
  const ordinalMatch = t.match(/^(?:the\s+)?(first|second|third|fourth|fifth)(?:\s+one)?$/);
  if (ordinalMatch) {
    const n = ordinals[ordinalMatch[1]];
    if (n <= entry.candidates.length) return entry.candidates[n - 1];
    return null;
  }

  // Substring match against the formatted candidate line (title + date/qty/etc).
  // Only match if exactly one candidate's formatted string contains the text —
  // ambiguous substrings fall through and re-trigger the disambiguation prompt.
  const matches = entry.candidates.filter((c) => {
    const formatted = formatCandidate(entry.kind, c).toLowerCase();
    return formatted.includes(t);
  });
  if (matches.length === 1) return matches[0];
  return null;
}

async function runUndo(user, household) {
  const actions = { shoppingAdded: [], shoppingCompleted: [], tasksAdded: [], tasksCompleted: [] };
  const entry = popRecentAdd(user.id);
  if (!entry) {
    return { response: "Nothing to undo — either I haven't added anything recently, or the 2-minute window passed. You can still remove it from the app.", actions };
  }
  try {
    if (entry.kind === 'event') {
      for (const id of entry.ids) await db.softDeleteCalendarEvent(id, household.id);
    } else if (entry.kind === 'task') {
      for (const id of entry.ids) await db.deleteTask(id, household.id);
    } else if (entry.kind === 'shopping') {
      for (const id of entry.ids) await db.deleteShoppingItem(id, household.id);
    }
    return { response: `↩️ Undone — removed ${entry.label}.`, actions };
  } catch (err) {
    console.error('[handlers] undo failed:', err.message);
    return { response: "⚠️ I couldn't undo that — please remove it from the app.", actions };
  }
}

// ─── Timezone helper ──────────────────────────────────────────────────────────

/**
 * Convert a local date+time string to a UTC ISO timestamp using the user's timezone.
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
    const utcMs = localMs - offsetMs;
    return new Date(utcMs).toISOString().replace('.000Z', 'Z');
  } catch {
    return `${date}T${time || '00:00'}:00Z`;
  }
}

// ─── Format helpers ───────────────────────────────────────────────────────────

const CATEGORY_EMOJI = {
  groceries: '🛒',
  clothing:  '👕',
  household: '🏠',
  school:    '🎒',
  pets:      '🐾',
  party:     '🎉',
  gifts:     '🎁',
  other:     '📦',
};

function capitalise(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatShoppingList(items) {
  if (!items.length) return '✅ Shopping list is empty!';

  const grouped = {};
  for (const item of items) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  }

  const lines = [];
  for (const [cat, catItems] of Object.entries(grouped)) {
    const emoji = CATEGORY_EMOJI[cat] || '📦';
    lines.push(`\n${emoji} *${capitalise(cat)}*`);
    for (const i of catItems) {
      const qty = i.quantity ? ` (${i.quantity})` : '';
      lines.push(`  • ${i.item}${qty}`);
    }
  }
  return lines.join('\n').trim();
}

function formatTaskList(tasks, heading = 'Tasks') {
  if (!tasks.length) return `✅ No ${heading.toLowerCase()}!`;

  const today = new Date().toISOString().split('T')[0];
  const lines = [`*${heading}*`];

  for (const t of tasks) {
    const overdue = t.due_date < today;
    const dueToday = t.due_date === today;
    const statusIcon = overdue ? '🔴' : dueToday ? '🟡' : '⚪';
    const who = t.assigned_to_name ? ` — ${t.assigned_to_name}` : ' — Everyone';
    const rec = t.recurrence ? ` _(${t.recurrence})_` : '';
    const dateLabel = overdue
      ? ` _(overdue: ${t.due_date})_`
      : dueToday ? ' _(today)_' : ` _(${t.due_date})_`;
    lines.push(`${statusIcon} ${t.title}${who}${rec}${dateLabel}`);
  }
  return lines.join('\n');
}

// ─── Core handlers ────────────────────────────────────────────────────────────

/**
 * Handle a natural language text message.
 * Classifies with AI and performs shopping/task operations.
 *
 * @param {string} text       - The message text
 * @param {object} user       - User row from DB
 * @param {object} household  - { id, members }
 * @returns {Promise<{response: string, actions: object}>} Response message and action details
 */

// ─── Update / Delete intent handler (events, tasks, shopping items) ───────────

/**
 * Format a candidate into a short human-readable line for the "which one?"
 * disambiguation message.
 */
function formatCandidate(kind, row) {
  if (kind === 'event') {
    const date = row.start_time
      ? new Date(row.start_time).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
      : '';
    const time = row.all_day ? 'all day' : (row.start_time ? new Date(row.start_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
    return `${row.title}${date ? ` (${date}${time ? ` ${time}` : ''})` : ''}`;
  }
  if (kind === 'task') {
    const due = row.due_date ? ` (due ${row.due_date})` : '';
    const who = row.assigned_to_name ? ` — ${row.assigned_to_name}` : '';
    return `${row.title}${due}${who}`;
  }
  // shopping
  const qty = row.quantity ? ` (${row.quantity})` : '';
  return `${row.item}${qty}`;
}

/**
 * Handle update_* and delete_* intents.
 *
 * Contract: the classifier has provided `result.target` (title + optional
 * context + optional assignee) and, for updates, `result.updates` with only
 * the fields to change. This function does the fuzzy lookup + disambiguation.
 */
async function handleModifyIntent(result, user, household) {
  const actions = {
    shoppingAdded: [], shoppingCompleted: [], tasksAdded: [], tasksCompleted: [],
  };
  const target = result.target || {};
  const updates = result.updates || {};
  const title = (target.title || '').trim();
  if (!title) {
    return { response: "I couldn't work out which item you meant — try again with a title.", actions };
  }

  const isEvent   = result.intent === 'update_event' || result.intent === 'delete_event';
  const isTask    = result.intent === 'update_task'  || result.intent === 'delete_task';
  const isDelete  = result.intent.startsWith('delete_');

  // 1. Fuzzy find candidates
  let candidates = [];
  let kind;
  try {
    if (isEvent) {
      kind = 'event';
      candidates = await db.findEventsByFuzzyTitle(household.id, title, { dateHint: extractDateFromContext(target.context, household) });
    } else if (isTask) {
      kind = 'task';
      candidates = await db.findTasksByFuzzyTitle(household.id, title, { assignedToName: target.assigned_to_name });
    } else {
      kind = 'shopping';
      candidates = await db.findShoppingItemsByFuzzyName(household.id, title);
    }
  } catch (err) {
    console.error(`[handlers] fuzzy find failed for ${result.intent}:`, err.message);
    return { response: "I had trouble looking that up. Try again in a moment.", actions };
  }

  // 2. No matches
  if (candidates.length === 0) {
    return {
      response: `I couldn't find ${kind === 'shopping' ? 'a shopping item' : `a ${kind}`} matching "${title}"${target.context ? ` (${target.context})` : ''}. Check the name and try again.`,
      actions,
    };
  }

  // 3. Multiple matches — disambiguate. Stash the candidates + intent so the
  // user's number reply can be resolved without going back through the LLM.
  if (candidates.length > 1) {
    const lines = candidates.slice(0, 5).map((c, i) => `${i + 1}. ${formatCandidate(kind, c)}`);
    const more = candidates.length > 5 ? `\n  … and ${candidates.length - 5} more` : '';
    const verb = isDelete ? (kind === 'shopping' ? 'remove' : 'cancel') : 'change';
    rememberDisambiguation(user.id, {
      intent: result.intent,
      kind,
      candidates: candidates.slice(0, 5),
      updates,
      householdId: household.id,
    });
    return {
      response: `I found a few matches — which one do you want to ${verb}?\n\n${lines.join('\n')}${more}\n\nReply with the number or a more specific detail.`,
      actions,
    };
  }

  // 4. One match — act
  return await executeModifyAction({
    intent: result.intent,
    kind,
    hit: candidates[0],
    updates,
    user,
    household,
    actions,
  });
}

/**
 * Execute the chosen modify action against a single candidate row.
 * Used by both the single-match path in handleModifyIntent and the
 * disambiguation-reply path in handleTextMessage.
 */
async function executeModifyAction({ intent, kind, hit, updates, user, household, actions }) {
  const isDelete = intent.startsWith('delete_');
  const isEvent = kind === 'event';
  const isTask = kind === 'task';

  try {
    if (isEvent) {
      if (isDelete) {
        await db.softDeleteCalendarEvent(hit.id, household.id);
        broadcast.toHousehold(user.id, household.members, `📅 ${user.name} cancelled: ${hit.title}`);
        return { response: `🗑️ Cancelled "${hit.title}".${hit.recurrence ? ` (Just this instance — reply "cancel all ${hit.title}" to stop the series.)` : ''}`, actions };
      }
      const eventUpdates = buildEventUpdates(updates, hit, household, user);
      if (Object.keys(eventUpdates).length === 0) {
        return { response: "Got it, but I didn't see any field to change. Tell me what to update (time, date, location…).", actions };
      }
      const updated = await db.updateCalendarEvent(hit.id, household.id, eventUpdates);
      broadcast.toHousehold(user.id, household.members, `📅 ${user.name} updated: ${updated.title}`);
      push.sendToHousehold(household.id, user.id, {
        title: 'Event updated',
        body: `${user.name} updated "${updated.title}"`,
        category: 'calendar_reminders',
      }).catch((err) => console.error('[handlers] update_event push failed:', err.message));
      return { response: `✏️ Updated "${updated.title}".`, actions };
    }

    if (isTask) {
      if (isDelete) {
        await db.deleteTask(hit.id, household.id);
        broadcast.toHousehold(user.id, household.members, `📋 ${user.name} cancelled task: ${hit.title}`);
        return { response: `🗑️ Cancelled task "${hit.title}".`, actions };
      }
      const taskUpdates = buildTaskUpdates(updates, hit, household);
      if (Object.keys(taskUpdates).length === 0) {
        return { response: "Got it, but I didn't see any field to change. Tell me what to update (due date, assignee, priority…).", actions };
      }
      const updated = await db.updateTask(hit.id, household.id, taskUpdates);
      broadcast.toHousehold(user.id, household.members, `📋 ${user.name} updated task: ${updated.title}`);
      return { response: `✏️ Updated "${updated.title}".`, actions };
    }

    // shopping
    if (isDelete) {
      await db.deleteShoppingItem(hit.id, household.id);
      broadcast.toHousehold(user.id, household.members, `🛒 ${user.name} removed: ${hit.item}`);
      return { response: `🗑️ Removed "${hit.item}" from the shopping list.`, actions };
    }
    const shopUpdates = buildShoppingUpdates(updates);
    if (Object.keys(shopUpdates).length === 0) {
      return { response: "Got it, but I didn't see any field to change.", actions };
    }
    const updated = await db.updateShoppingItem(hit.id, household.id, shopUpdates);
    broadcast.toHousehold(user.id, household.members, `🛒 ${user.name} updated: ${updated.item}`);
    return { response: `✏️ Updated "${updated.item}".`, actions };
  } catch (err) {
    console.error(`[handlers] ${intent} failed:`, err.message);
    return { response: `⚠️ I found it but couldn't save the change: ${err.message}`, actions };
  }
}

/** Extract a YYYY-MM-DD hint from target.context if one's obvious. */
function extractDateFromContext(context /*, household */) {
  if (!context) return null;
  const m = String(context).match(/\b(\d{4}-\d{2}-\d{2})\b/);
  return m ? m[1] : null;
}

/** Translate the AI's `updates` object into a calendar_events row patch. */
function buildEventUpdates(updates, existing, household, user) {
  const patch = {};
  if (updates.title) patch.title = updates.title;
  if (updates.location !== undefined && updates.location !== null) patch.location = updates.location;
  if (updates.description !== undefined && updates.description !== null) patch.description = updates.description;
  if (updates.all_day !== undefined && updates.all_day !== null) patch.all_day = !!updates.all_day;

  // Reassign via names → ids
  if (Array.isArray(updates.assigned_to_names) && updates.assigned_to_names.length > 0) {
    const first = household.members.find(m => m.name.toLowerCase() === String(updates.assigned_to_names[0]).toLowerCase());
    if (first) {
      patch.assigned_to = first.id;
      patch.assigned_to_name = first.name;
    }
  }

  // Date/time changes: we rebuild start_time/end_time from the existing ones,
  // overriding only the parts the user mentioned.
  const tz = user?.timezone || household?.timezone || 'Europe/London';
  const hasDate = !!updates.date;
  const hasStart = !!updates.start_time;
  const hasEnd   = !!updates.end_time;

  if (hasDate || hasStart || hasEnd) {
    const existingStart = new Date(existing.start_time);
    const existingEnd   = existing.end_time ? new Date(existing.end_time) : null;
    const existingDate  = isNaN(existingStart.getTime()) ? null : existingStart.toISOString().slice(0, 10);
    const existingStartHHMM = isNaN(existingStart.getTime())
      ? '09:00'
      : existingStart.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });
    const existingEndHHMM = existingEnd && !isNaN(existingEnd.getTime())
      ? existingEnd.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz })
      : existingStartHHMM;

    const nextDate = updates.date || existingDate;
    const nextStart = updates.start_time || existingStartHHMM;
    const nextEnd   = updates.end_time   || existingEndHHMM;

    if (existing.all_day) {
      patch.start_time = `${nextDate}T00:00:00Z`;
      patch.end_time   = `${nextDate}T23:59:59Z`;
    } else {
      patch.start_time = localToUTC(nextDate, nextStart, tz);
      patch.end_time   = localToUTC(nextDate, nextEnd, tz);
    }
  }

  return patch;
}

/** Translate updates → tasks row patch. */
function buildTaskUpdates(updates, existing, household) {
  const patch = {};
  if (updates.title) patch.title = updates.title;
  if (updates.due_date !== undefined && updates.due_date !== null) patch.due_date = updates.due_date;
  if (updates.priority) patch.priority = updates.priority;
  if (updates.recurrence !== undefined) patch.recurrence = updates.recurrence;

  if (Array.isArray(updates.assigned_to_names) && updates.assigned_to_names.length > 0) {
    const first = household.members.find(m => m.name.toLowerCase() === String(updates.assigned_to_names[0]).toLowerCase());
    if (first) {
      patch.assigned_to = first.id;
      patch.assigned_to_name = first.name;
    }
  }
  return patch;
}

/** Translate updates → shopping_items row patch. */
function buildShoppingUpdates(updates) {
  const patch = {};
  if (updates.item)     patch.item = updates.item;
  if (updates.quantity !== undefined && updates.quantity !== null) patch.quantity = updates.quantity;
  return patch;
}

/**
 * Create a calendar event from a classify() result.calendar_event payload.
 *
 * Factored out so two call sites can share it:
 *   1. The primary `intent === 'create_event'` branch, where the user is
 *      explicitly asking to add an event and we surface a dupe prompt so
 *      they can confirm a duplicate with a follow-up "yes".
 *   2. The fall-through path, where the classifier has emitted a
 *      calendar_event alongside a task completion (e.g. "Booked car service
 *      for Wednesday morning" → complete task + create event in one turn).
 *      In that path, duplicates are skipped silently so the task-completion
 *      confirmation still gets through.
 *
 * Returns one of:
 *   { kind: 'created', created }           — event saved, actions updated
 *   { kind: 'duplicate', existing }        — similar event found, nothing saved
 *   { kind: 'error', message }             — DB/network error, nothing saved
 */
async function createCalendarEventFromResult(ev, user, household, actions) {
  try {
    // Support both assigned_to_names (array) and legacy assigned_to_name (string)
    const assigneeNames = ev.assigned_to_names || (ev.assigned_to_name ? [ev.assigned_to_name] : []);
    const firstAssignee = assigneeNames.length > 0
      ? household.members.find(m => m.name.toLowerCase() === assigneeNames[0].toLowerCase())
      : null;

    const userTz = user.timezone || household.timezone || 'Europe/London';
    const startTime = ev.all_day
      ? `${ev.date}T00:00:00Z`
      : localToUTC(ev.date, ev.start_time || '09:00', userTz);
    const endTime = ev.all_day
      ? `${ev.date}T23:59:59Z`
      : localToUTC(ev.date, ev.end_time || ev.start_time || '10:00', userTz);

    // Dupe detection — skipped when classifier set force:true (user
    // affirmatively confirmed a duplicate in a prior turn).
    if (!ev.force) {
      const existing = await db.findSimilarEvent(household.id, ev.title, startTime);
      if (existing) return { kind: 'duplicate', existing };
    }

    const created = await db.createCalendarEvent(household.id, {
      title: ev.title,
      start_time: startTime,
      end_time: endTime,
      all_day: !!ev.all_day,
      assigned_to: firstAssignee?.id || null,
      assigned_to_name: firstAssignee?.name || assigneeNames[0] || null,
      color: firstAssignee?.color_theme || 'lavender',
      location: ev.location || null,
      description: ev.description || null,
    }, user.id);

    if (created && assigneeNames.length > 0) {
      await db.saveEventAssignees(created.id, household.id, assigneeNames, household.members);
    }

    // Mirror to any connected external calendars (Apple/Google/Microsoft).
    // Fire-and-forget — if a provider push fails, it's logged inside
    // pushEventToConnections but doesn't block the user's confirmation
    // message. Matches the existing HTTP-route behaviour in
    // src/routes/calendar.js so events added via the WhatsApp bot / AI
    // chat / inbound email end up in the same external calendars as
    // events added via the app form.
    if (created) {
      calendarSync.pushEventToConnections(household.id, created, 'create').catch(() => {});
    }

    // Update actions so the caller's confirmation/broadcast picks up the event.
    actions.eventsAdded = actions.eventsAdded || [];
    actions.eventsAdded.push(ev.title);
    rememberAdd(user.id, 'event', [created.id], `"${ev.title}"`);

    // iOS push for household members living in the native app.
    push.sendToHousehold(household.id, user.id, {
      title: 'New event',
      body: `${user.name} added "${ev.title}"`,
      category: 'calendar_reminders',
    }).catch((err) => console.error('[handlers] calendar push failed:', err.message));

    return { kind: 'created', created };
  } catch (err) {
    console.error('[handlers] Calendar event creation failed:', err.message);
    return { kind: 'error', message: err.message };
  }
}

async function handleTextMessage(text, user, household) {
  const memberNames = household.members.map((m) => m.name);

  // ── Cheap regex pre-classifiers (no AI call) ──

  // Undo recent add — must come before the trivial check because "scrap that"
  // and similar phrases wouldn't match a greeting/thanks/emoji pattern anyway.
  if (isUndoRequest(text)) {
    console.log('[handlers] Pre-classified as undo for:', text.slice(0, 50));
    return await runUndo(user, household);
  }

  // Pending disambiguation reply — if we just asked "which one?", a number /
  // ordinal / specific-detail answer should be resolved deterministically
  // here, NOT sent through the LLM (which has no concept of "this is option N
  // from the list I just showed" and would re-trigger the same disambiguation).
  const pendingDisamb = popPendingDisambiguation(user.id);
  if (pendingDisamb) {
    if (pendingDisamb.householdId !== household.id) {
      // Stale entry from a household switch — drop and fall through.
      console.log('[handlers] Dropping disambiguation entry (household mismatch)');
    } else {
      const chosen = resolveDisambiguationChoice(text, pendingDisamb);
      if (chosen) {
        console.log(`[handlers] Resolved disambiguation: "${text.slice(0, 30)}" → ${pendingDisamb.kind} ${chosen.id}`);
        return await executeModifyAction({
          intent: pendingDisamb.intent,
          kind: pendingDisamb.kind,
          hit: chosen,
          updates: pendingDisamb.updates,
          user,
          household,
          actions: { shoppingAdded: [], shoppingCompleted: [], tasksAdded: [], tasksCompleted: [] },
        });
      }
      // Couldn't map to a candidate — drop the entry (we've already popped
      // it) and let the message classify normally. Better to lose the
      // disambiguation context than have a stale "1" trigger an old action
      // minutes later when the user's intent has moved on.
    }
  }

  // Trivial messages — greetings, thanks, emoji-only — get canned replies.
  const trivial = matchTrivialMessage(text);
  if (trivial) {
    console.log('[handlers] Short-circuit trivial reply for:', text.slice(0, 50));
    return {
      response: trivial.response,
      actions: { shoppingAdded: [], shoppingCompleted: [], tasksAdded: [], tasksCompleted: [] },
    };
  }

  // Fetch recent WhatsApp conversation turns (last ~30 min) so the AI can
  // resolve short follow-ups like "no, in sea point" or "what about tomorrow?".
  const history = await db.getRecentWhatsAppTurns(user.id, { limit: 10, windowMinutes: 30 }).catch(() => []);

  // Pre-classify: detect weather intent before AI call to avoid misclassification
  const weatherPattern = /\b(weather|temperature|rain|umbrella|jacket|coat|forecast|sunny|cloudy|cold|hot|warm|chilly)\b/i;
  if (weatherPattern.test(text)) {
    console.log('[handlers] Pre-classified as weather for:', text.slice(0, 50));
    const result = { intent: 'weather', response_message: '' };
    const actions = { shoppingAdded: [], shoppingCompleted: [], tasksAdded: [], tasksCompleted: [] };
    try {
      let lat, lon, tz, locationLabel;

      // Check if the user asked about a specific location (e.g. "weather in Cape Town")
      const locationName = extractLocationFromMessage(text);
      if (locationName) {
        const geo = await geocodeLocation(locationName);
        if (geo) {
          lat = geo.lat;
          lon = geo.lon;
          tz = geo.timezone || 'auto';
          locationLabel = `${geo.name}, ${geo.country}`;
        }
      }

      // Fallback to user's profile location
      if (!lat || !lon) {
        const fullUser = household.members.find(m => m.id === user.id);
        lat = fullUser?.latitude;
        lon = fullUser?.longitude;
        tz = fullUser?.timezone || household.timezone || 'Europe/London';
        if (!lat || !lon) {
          const tzCoords = getCoordsFromTimezone(tz);
          if (tzCoords) [lat, lon] = tzCoords;
        }
      }

      if (!lat || !lon) {
        return { response: "I couldn't determine your location. Try asking 'weather in Cape Town' or open the Housemait app to sync your timezone. 📍", actions };
      }
      const report = await getWeatherReport(lat, lon, tz, { userMessage: text });
      const prefix = locationLabel ? `📍 *${locationLabel}*\n\n` : '';
      return { response: prefix + report, actions };
    } catch (err) {
      console.error('[handlers] Weather fetch failed:', err.message);
      return { response: "Sorry, I couldn't fetch the weather right now. Please try again in a moment. 🌤️", actions };
    }
  }

  // Fetch saved notes and upcoming calendar events for context
  const notes = await db.getHouseholdNotes(household.id);
  const now = new Date();
  const futureDate = new Date(now);
  futureDate.setDate(futureDate.getDate() + 365);
  const calendarEvents = await db.getCalendarEvents(
    household.id,
    now.toISOString(),
    futureDate.toISOString(),
    { userId: user.id }
  ).catch(() => []);
  // Open tasks give the classifier the context to turn "Elementor paid" into
  // a completion of the existing "Pay Elementor" task instead of a new one.
  const openTasks = await db.getAllIncompleteTasks(household.id).catch(() => []);
  const fullUserForTz = household.members.find(m => m.id === user.id);
  const userTz = fullUserForTz?.timezone || household.timezone || 'Europe/London';

  console.log(`[handlers] Classifying "${text.slice(0, 60)}" with ${calendarEvents.length} events, ${openTasks.length} open tasks, ${notes.length} notes, ${history.length} history turns`);
  const result = await classify(text, memberNames, notes, { householdId: household.id, userId: user.id, sender: user.name, calendarEvents, tasks: openTasks, timezone: userTz, history });

  console.log('[handlers] Classified intent:', result.intent, 'for message:', text.slice(0, 50));

  const actions = {
    shoppingAdded: [],
    shoppingCompleted: [],
    tasksAdded: [],
    tasksCompleted: [],
  };

  // Handle specific query intents
  if (result.intent === 'query_list') {
    const listResponse = await handleList(user, household);
    return { response: listResponse, actions };
  }
  if (result.intent === 'query_tasks') {
    // "Show me my tasks" / "what are my tasks" → scope to the asker
    // plus anything assigned to Everyone (null assigned_to). A plain
    // "show tasks" stays household-wide. The classifier doesn't emit a
    // separate intent for this, so we check the raw text — word-bounded
    // so "family's tasks" / "mason's tasks" don't false-match.
    const asksForMine = /\bmy\s+(tasks?|to[- ]?dos?|list)\b/i.test(text);
    const taskResponse = asksForMine
      ? await handleMyTasks(user, household)
      : await handleTasks(user, household);
    return { response: taskResponse, actions };
  }

  // Handle calendar queries — AI already has calendar context and answered in response_message
  if (result.intent === 'query_calendar') {
    return { response: result.response_message || "I couldn't find that event. Try checking the calendar in the app.", actions };
  }

  // Handle weather request
  if (result.intent === 'weather') {
    try {
      let lat, lon, tz, locationLabel;

      // Check if the user asked about a specific location
      const locationName = extractLocationFromMessage(text);
      if (locationName) {
        const geo = await geocodeLocation(locationName);
        if (geo) {
          lat = geo.lat;
          lon = geo.lon;
          tz = geo.timezone || 'auto';
          locationLabel = `${geo.name}, ${geo.country}`;
        }
      }

      // Fallback to user's profile location
      if (!lat || !lon) {
        const fullUser = household.members.find(m => m.id === user.id);
        lat = fullUser?.latitude;
        lon = fullUser?.longitude;
        tz = fullUser?.timezone || household.timezone || 'Europe/London';
        if (!lat || !lon) {
          const tzCoords = getCoordsFromTimezone(tz);
          if (tzCoords) [lat, lon] = tzCoords;
        }
      }

      if (!lat || !lon) {
        return { response: "I couldn't determine your location. Try asking 'weather in Cape Town' or open the Housemait app to sync your timezone. 📍", actions };
      }
      const report = await getWeatherReport(lat, lon, tz, { userMessage: text });
      const prefix = locationLabel ? `📍 *${locationLabel}*\n\n` : '';
      return { response: prefix + report, actions };
    } catch (err) {
      console.error('[handlers] Weather fetch failed (post-classify):', err.message);
      return { response: "Sorry, I couldn't fetch the weather right now. Please try again in a moment. 🌤️", actions };
    }
  }

  // Handle note save/delete
  if (result.intent === 'note_save' && result.note) {
    if (result.note.action === 'delete') {
      await db.deleteHouseholdNote(household.id, result.note.key);
    } else if (result.note.value) {
      await db.upsertHouseholdNote(household.id, result.note.key, result.note.value, user.id);
    }
    return { response: result.response_message || 'Noted! ✅', actions };
  }

  // Handle note recall — AI already included the answer in response_message
  if (result.intent === 'note_recall') {
    return { response: result.response_message || "I couldn't find that in my notes.", actions };
  }

  // Handle calendar event creation (primary path — intent explicitly create_event)
  if (result.intent === 'create_event' && result.calendar_event) {
    const outcome = await createCalendarEventFromResult(result.calendar_event, user, household, actions);
    if (outcome.kind === 'duplicate') {
      // Surface the dupe prompt so the user can confirm with a follow-up "yes"
      // (FORCE-ADD path) — this behaviour is specific to the create_event
      // intent where adding the event is the user's primary goal.
      const existing = outcome.existing;
      const existingCreator = existing.created_by
        ? household.members.find(m => m.id === existing.created_by)
        : null;
      const who = existingCreator?.name || 'someone';
      const dateLabel = new Date(existing.start_time).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
      return {
        response: `📅 ${who} already added "${existing.title}" for ${dateLabel} — I haven't added a duplicate. Let me know if you'd like me to add a second one anyway.`,
        actions,
      };
    }
    if (outcome.kind === 'error') {
      return { response: `⚠️ I understood the event but couldn't save it: ${outcome.message}`, actions };
    }
    return { response: result.response_message || '📅 Event added! ✅', actions };
  }

  // ── Update / Delete intents (events, tasks, shopping items) ──
  //
  // All six share the same shape:
  //   1. Fuzzy-find candidates by target.title (+ context filters)
  //   2. 0 candidates → "I couldn't find that"
  //   3. 1 candidate  → apply the change/deletion and confirm
  //   4. 2+ candidates → list them and ask which
  //
  // Broadcasts fire on success so other household members see the change.
  if (['update_event', 'delete_event', 'update_task', 'delete_task', 'update_shopping_item', 'delete_shopping_item'].includes(result.intent)) {
    return await handleModifyIntent(result, user, household);
  }

  // Handle school activity add/remove
  if (result.intent === 'school_activity' && result.school_activity) {
    try {
      const sa = result.school_activity;
      const child = household.members.find(m =>
        m.name.toLowerCase() === sa.child_name?.toLowerCase() && m.member_type === 'dependent'
      );
      if (!child) {
        return { response: `I couldn't find a child called "${sa.child_name}" in your family. Check the name and try again!`, actions };
      }
      if (sa.action === 'remove') {
        // Find and remove the activity
        const activities = await db.getChildActivities(child.id);
        const match = activities.find(a =>
          a.activity.toLowerCase() === sa.activity.toLowerCase() &&
          (sa.day_of_week === undefined || a.day_of_week === sa.day_of_week)
        );
        if (match) {
          await db.deleteChildActivity(match.id);
        }
      } else {
        await db.addChildActivity({
          child_id: child.id,
          day_of_week: sa.day_of_week,
          activity: sa.activity,
          time_end: sa.time_end || null,
        });
      }
    } catch (err) {
      console.error('School activity update failed:', err.message);
      return { response: `⚠️ I understood the activity but couldn't save it: ${err.message}`, actions };
    }
    return { response: result.response_message || '🏫 Activity updated! ✅', actions };
  }

  // Handle school event (one-off trip, INSET day, etc.) — create as calendar event
  if (result.intent === 'school_event' && result.calendar_event) {
    try {
      const ev = result.calendar_event;
      const assigneeNames = ev.assigned_to_names || (ev.assigned_to_name ? [ev.assigned_to_name] : []);
      const firstAssignee = assigneeNames.length > 0
        ? household.members.find(m => m.name.toLowerCase() === assigneeNames[0].toLowerCase())
        : null;

      const userTz = user.timezone || household.timezone || 'Europe/London';
      const startTime = ev.all_day ? `${ev.date}T00:00:00Z` : localToUTC(ev.date, ev.start_time || '09:00', userTz);
      const endTime = ev.all_day ? `${ev.date}T23:59:59Z` : localToUTC(ev.date, ev.end_time || ev.start_time || '10:00', userTz);

      const created = await db.createCalendarEvent(household.id, {
        title: ev.title,
        start_time: startTime,
        end_time: endTime,
        all_day: !!ev.all_day,
        assigned_to: firstAssignee?.id || null,
        assigned_to_name: firstAssignee?.name || assigneeNames[0] || null,
        color: firstAssignee?.color_theme || 'sky',
        location: ev.location || null,
        description: ev.description || null,
        category: 'school',
      }, user.id);

      if (created && assigneeNames.length > 0) {
        await db.saveEventAssignees(created.id, household.id, assigneeNames, household.members);
      }
      // Mirror to connected external calendars (see main handler for notes).
      if (created) {
        calendarSync.pushEventToConnections(household.id, created, 'create').catch(() => {});
      }
    } catch (err) {
      console.error('School event creation failed:', err.message);
      return { response: `⚠️ I understood the event but couldn't save it: ${err.message}`, actions };
    }
    return { response: result.response_message || '🏫 School event added! ✅', actions };
  }

  // Handle recipe request — generate, save to Recipe Box, format nicely
  if (result.intent === 'recipe') {
    try {
      // Extract description from recipe_request or infer from the original message
      const description = result.recipe_request?.description || text;
      const dietary = result.recipe_request?.dietary || null;
      const servings = result.recipe_request?.servings || null;
      console.log('[handlers] Generating recipe for:', description);
      const recipe = await generateAndSaveRecipe(household.id, description, dietary, servings);
      const response = formatRecipeResponse(recipe);
      return { response, actions };
    } catch (err) {
      console.error('Recipe generation failed:', err.message);
      return { response: "Sorry, I couldn't create that recipe right now. Try again in a moment! 🍳", actions };
    }
  }

  // Handle recipe follow-up — add ingredients to shopping list
  if (result.intent === 'recipe_followup') {
    try {
      // Get the most recently created recipe for this household
      const recipe = await db.getLatestRecipe(household.id);
      if (!recipe) {
        return { response: "I'm not sure which recipe you're referring to. Ask me for a recipe first, then I can add the ingredients to your list!", actions };
      }
      if (!recipe?.ingredients?.length) {
        return { response: "That recipe doesn't have any ingredients listed. Try asking me for a new recipe!", actions };
      }
      // Add ingredients to shopping list. Needs list_id (NOT NULL) + the
      // DB column is aisle_category (not category) — same enrichment
      // pattern as the main shopping-add branch above.
      const defaultList = await db.getDefaultShoppingList(household.id);
      const ingredientItems = recipe.ingredients
        .filter(ing => ing.name && !ing.optional)
        .map(ing => ({
          item: ing.quantity && ing.unit
            ? `${ing.quantity}${ing.unit} ${ing.name}`
            : ing.quantity
              ? `${ing.quantity} ${ing.name}`
              : ing.name,
          list_id: defaultList.id,
          aisle_category: 'Other',
          quantity: null,
        }));
      if (ingredientItems.length) {
        await db.addShoppingItems(household.id, ingredientItems, user.id);
        actions.shoppingAdded = ingredientItems.map(i => i.item);
      }
      return {
        response: `✅ Added ${ingredientItems.length} ingredients for *${recipe.name}* to your shopping list!`,
        actions,
      };
    } catch (err) {
      console.error('Recipe follow-up failed:', err.message);
      return { response: "Sorry, I couldn't add those ingredients. Try again!", actions };
    }
  }

  // Handle general chat — just return the AI's conversational response
  if (result.intent === 'chat') {
    return { response: result.response_message || "I'm not sure how to help with that. Try asking me about shopping, tasks, or anything around the house!", actions };
  }

  // Handle shopping items
  if (result.shopping_items?.length) {
    const toAdd = result.shopping_items.filter((i) => i.action === 'add');
    const toRemove = result.shopping_items.filter((i) => i.action === 'remove');
    if (toAdd.length) {
      // Every shopping_items row needs a list_id — the column has a NOT
      // NULL constraint added with multi-list support. The in-app classify
      // route enriches items with the default list before save; the
      // WhatsApp bot path previously didn't, so classifier-produced items
      // landed without list_id and Postgres rejected the insert. Match the
      // /api/classify behaviour: look up (or lazy-create) the default list
      // and attach list_id + aisle_category to each row.
      const defaultList = await db.getDefaultShoppingList(household.id);
      const enriched = toAdd.map((i) => ({
        ...i,
        list_id: defaultList.id,
        aisle_category: i.category || 'Other',
      }));
      const saved = await db.addShoppingItems(household.id, enriched, user.id);
      actions.shoppingAdded = toAdd.map((i) => i.item);
      const savedIds = Array.isArray(saved) ? saved.map((s) => s?.id).filter(Boolean) : [];
      if (savedIds.length) {
        const names = toAdd.map((i) => i.item).join(', ');
        rememberAdd(user.id, 'shopping', savedIds, names);
      }
    }
    if (toRemove.length) {
      await db.completeShoppingItemsByName(household.id, toRemove.map((i) => i.item));
      actions.shoppingCompleted = toRemove.map((i) => i.item);
    }
  }

  // Handle tasks
  if (result.tasks?.length) {
    const toAdd = result.tasks.filter((t) => t.action === 'add');
    const toComplete = result.tasks.filter((t) => t.action === 'complete');
    if (toAdd.length) {
      const saved = await db.addTasks(household.id, toAdd, user.id, household.members);
      actions.tasksAdded = toAdd.map((t) => t.title);
      const savedIds = Array.isArray(saved) ? saved.map((s) => s?.id).filter(Boolean) : [];
      if (savedIds.length) {
        const titles = toAdd.map((t) => t.title).join(', ');
        rememberAdd(user.id, 'task', savedIds, titles);
      }
    }
    const unmatchedCompletions = [];
    for (const t of toComplete) {
      const done = await db.completeTasksByName(household.id, [t.title], t.assigned_to_name);
      if (done.length === 0) {
        // Nothing actually got ticked. Track the requested title so we
        // can correct the AI's (overconfident) response message below.
        unmatchedCompletions.push(t.title);
        continue;
      }
      // Push the ACTUAL matched titles so actions mirror reality —
      // important for the broadcast notification other members see.
      actions.tasksCompleted.push(...done.map((d) => d.title));
      for (const completedTask of done) {
        if (completedTask.recurrence) await db.generateNextRecurrence(completedTask);
      }
    }
    actions.tasksUnmatched = unmatchedCompletions;
  }

  // Fall-through calendar event: covers "Booked car service for Wednesday
  // morning"-style messages where the classifier detected a completion AND a
  // scheduling detail in one turn. The primary intent handled the completion
  // above; now also persist the event so the user doesn't have to ask twice.
  // Skip the duplicate-prompt path from the create_event branch — it's a
  // secondary action, not the user's main request, so a silent dupe skip is
  // better UX than hijacking the confirmation flow.
  if (result.calendar_event && result.intent !== 'create_event') {
    const outcome = await createCalendarEventFromResult(result.calendar_event, user, household, actions);
    if (outcome.kind === 'duplicate') {
      console.log('[handlers] Skipped fall-through event create — duplicate:', outcome.existing.title);
    }
  }

  // Override the AI's confident "Great, I've ticked off X" when nothing
  // actually matched. The AI generates its response BEFORE the DB write,
  // so a no-op completion otherwise gets a false-positive confirmation
  // (observed live: user said "CREO website done", got "ticked off!"
  // reply, task still showed as open in the next query).
  let response = result.response_message || 'Done! ✅';
  const unmatched = actions.tasksUnmatched || [];
  if (unmatched.length > 0 && actions.tasksCompleted.length === 0) {
    // Every attempted completion missed — be honest.
    const list = unmatched.map((t) => `"${t}"`).join(', ');
    response = unmatched.length === 1
      ? `I couldn't find a task matching ${list} in your open tasks. Try checking the exact name with "show my tasks".`
      : `I couldn't find tasks matching ${list}. Try checking names with "show my tasks".`;
  } else if (unmatched.length > 0) {
    // Partial success — at least one matched, at least one didn't.
    const list = unmatched.map((t) => `"${t}"`).join(', ');
    response += `\n\n(I couldn't find ${list} in your open tasks.)`;
  }

  return {
    response,
    actions,
  };
}

/**
 * Build a short broadcast notification message for other household members.
 * Returns null if no meaningful actions were taken.
 *
 * @param {string} userName - Name of the person who made the change
 * @param {object} actions  - { shoppingAdded, shoppingCompleted, tasksAdded, tasksCompleted }
 * @returns {string|null}
 */
function buildBroadcastMessage(userName, actions) {
  const lines = [];

  if (actions.shoppingAdded.length) {
    lines.push(`🛒 ${userName} added: ${actions.shoppingAdded.join(', ')}`);
  }
  if (actions.shoppingCompleted.length) {
    lines.push(`✅ ${userName} checked off: ${actions.shoppingCompleted.join(', ')}`);
  }
  if (actions.tasksAdded.length) {
    lines.push(`📋 ${userName} added task: ${actions.tasksAdded.join(', ')}`);
  }
  if (actions.tasksCompleted.length) {
    lines.push(`✅ ${userName} completed: ${actions.tasksCompleted.join(', ')}`);
  }
  if (actions.eventsAdded?.length) {
    lines.push(`📅 ${userName} added event: ${actions.eventsAdded.join(', ')}`);
  }

  return lines.length ? lines.join('\n') : null;
}

/**
 * Handle a voice note (audio buffer).
 * Transcribes with Whisper, then feeds to AI classification.
 *
 * @param {Buffer} audioBuffer - Audio file buffer
 * @param {string} filename    - e.g. "voice.ogg" or "audio.ogg"
 * @param {object} user
 * @param {object} household
 * @returns {Promise<{transcription: string, response: string}>}
 */
async function handleVoiceNote(audioBuffer, filename, user, household) {
  const transcribedText = await transcribeVoice(audioBuffer, filename);

  if (!transcribedText) {
    return { transcription: null, response: "🎙️ Couldn't hear anything in that voice note. Please try again." };
  }

  const result = await handleTextMessage(transcribedText, user, household);
  return {
    transcription: transcribedText,
    response: `🎙️ _"${transcribedText}"_\n\n${result.response}`,
    actions: result.actions,
  };
}

/**
 * Handle a photo — smart image scanning.
 * First classifies the image (receipt vs event/invitation vs unknown),
 * then routes to the appropriate handler.
 *
 * @param {Buffer} imageBuffer
 * @param {string} mimeType - e.g. "image/jpeg"
 * @param {object} user
 * @param {object} household
 * @returns {Promise<{response: string, actions: object}>}
 */
async function handlePhoto(imageBuffer, mimeType, user, household) {
  const noActions = { shoppingAdded: [], shoppingCompleted: [], tasksAdded: [], tasksCompleted: [] };
  const members = await db.getHouseholdMembers(household.id);
  const memberNames = members.map(m => m.name);

  // Smart classify: receipt, event, or unknown
  const ctx = { householdId: household.id, userId: user.id };
  const scan = await scanImage(imageBuffer, mimeType, memberNames, ctx);

  // ── Receipt handling ──
  if (scan.type === 'receipt') {
    const extracted = await scanReceipt(imageBuffer, mimeType, ctx);

    if (!extracted.items?.length) {
      return {
        response: "🧾 I couldn't find any items on that receipt. Is this a grocery receipt? Try sending a clearer photo.",
        actions: noActions,
      };
    }

    const shoppingList = await db.getShoppingList(household.id);
    const matchResult = await matchReceiptToList(extracted.items, shoppingList, ctx);

    const checkedOff = [];
    for (const match of matchResult.matches || []) {
      if (match.confidence >= 0.7) {
        await db.completeShoppingItemById(match.list_item_id);
        checkedOff.push(match.list_item_name);
      }
    }

    const store = extracted.store_name ? ` from *${extracted.store_name}*` : '';
    const lines = [`🧾 Receipt scanned${store}`];

    if (checkedOff.length) {
      lines.push(`\n✅ *Checked off:* ${checkedOff.join(', ')}`);
    } else {
      lines.push('\n✅ No shopping list items matched this receipt.');
    }

    if (matchResult.unmatched_receipt_items?.length) {
      lines.push(`\n❓ *Not on your list:* ${matchResult.unmatched_receipt_items.join(', ')}`);
    }

    return {
      response: lines.join('\n'),
      actions: { ...noActions, shoppingCompleted: checkedOff },
    };
  }

  // ── Event/invitation handling ──
  if (scan.type === 'event' && scan.events?.length) {
    const userTz = user.timezone || household.timezone || 'Europe/London';
    const created = [];
    for (const ev of scan.events) {
      try {
        const assigneeNames = ev.assigned_to_names || (ev.assigned_to_name ? [ev.assigned_to_name] : []);
        const firstAssignee = assigneeNames.length > 0
          ? members.find(m => m.name.toLowerCase() === assigneeNames[0].toLowerCase())
          : null;

        const startTime = ev.all_day
          ? `${ev.date}T00:00:00Z`
          : localToUTC(ev.date, ev.start_time || '09:00', userTz);
        const endTime = ev.all_day
          ? `${ev.date}T23:59:59Z`
          : localToUTC(ev.date, ev.end_time || ev.start_time || '10:00', userTz);

        const createdEvent = await db.createCalendarEvent(household.id, {
          title: ev.title,
          start_time: startTime,
          end_time: endTime,
          all_day: !!ev.all_day,
          assigned_to: firstAssignee?.id || null,
          assigned_to_name: firstAssignee?.name || assigneeNames[0] || null,
          color: firstAssignee?.color_theme || 'lavender',
          location: ev.location || null,
          description: ev.description || null,
        }, user.id);

        if (createdEvent && assigneeNames.length > 0) {
          await db.saveEventAssignees(createdEvent.id, household.id, assigneeNames, members);
        }
        // Mirror to connected external calendars (see main handler for notes).
        if (createdEvent) {
          calendarSync.pushEventToConnections(household.id, createdEvent, 'create').catch(() => {});
        }

        created.push(ev.title);
      } catch (err) {
        console.error(`Failed to create event "${ev.title}" from image:`, err.message);
      }
    }

    if (created.length) {
      const lines = [`📅 *${created.length} event${created.length > 1 ? 's' : ''} added to calendar:*`];
      created.forEach(t => lines.push(`• ${t}`));
      if (scan.summary) lines.push(`\n${scan.summary}`);
      return { response: lines.join('\n'), actions: noActions };
    }

    return {
      response: `📅 I found event information but couldn't create the events. ${scan.summary || ''}`,
      actions: noActions,
    };
  }

  // ── Unknown / fallback ──
  return {
    response: `🤔 I wasn't sure what to do with that image. ${scan.summary || 'Try sending a receipt to check off shopping items, or an invitation/confirmation to add events to your calendar.'}`,
    actions: noActions,
  };
}

/**
 * Handle a "list" command — show shopping list.
 */
async function handleList(user, household) {
  const items = await db.getShoppingList(household.id);
  return formatShoppingList(items);
}

/**
 * Handle a "tasks" command.
 * @param {boolean} showAll - Show all pending tasks (not just today/overdue)
 */
async function handleTasks(user, household, showAll = false) {
  const tasks = showAll
    ? await db.getAllIncompleteTasks(household.id)
    : await db.getTasks(household.id);
  const heading = showAll ? 'All Pending Tasks' : 'Tasks Due Today & Overdue';
  return formatTaskList(tasks, heading);
}

/**
 * Handle a "my tasks" command.
 */
async function handleMyTasks(user, household) {
  const tasks = await db.getTasks(household.id, { assignedToId: user.id });
  const heading = `${user.name}'s Tasks`;
  return formatTaskList(tasks, heading);
}

// ─── Recipe helpers ──────────────────────────────────────────────────────────

/**
 * Generate a recipe via AI and save it to the Recipe Box.
 */
async function generateAndSaveRecipe(householdId, description, dietary, servings) {
  const prompt = `Create a simple, family-friendly recipe based on: ${description}
${dietary ? `Dietary requirements: ${dietary}` : ''}
${servings ? `Servings: ${servings}` : 'Servings: 4'}

Keep it simple — families are busy. Use common British supermarket ingredients.

Return ONLY valid JSON:
{
  "name": "recipe name",
  "category": "breakfast|lunch|dinner|dessert|snack",
  "ingredients": [{"name": "ingredient", "quantity": "amount", "unit": "g|ml|tsp|etc", "optional": false}],
  "method": ["Step 1...", "Step 2..."],
  "prep_time_mins": 15,
  "cook_time_mins": 30,
  "servings": 4,
  "dietary_tags": ["vegetarian"]
}

Rules:
- Maximum 3-5 method steps, each one short sentence
- Use metric measurements
- Keep ingredient list practical (under 12 items)
- Infer dietary tags from ingredients`;

  const { text } = await callWithFailover({
    system: 'You are a family recipe creator for busy UK households. Create simple, practical recipes. Return ONLY valid JSON.',
    messages: [{ role: 'user', content: prompt }],
    useThinking: false,
    maxTokens: 2048,
    timeoutMs: 30000,
    feature: 'recipe_generate',
    householdId,
  });

  const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
  const parsed = JSON.parse(cleaned);

  const recipe = await db.createRecipe(householdId, {
    name: parsed.name,
    category: (parsed.category || 'dinner').toLowerCase(),
    ingredients: parsed.ingredients || [],
    method: parsed.method || [],
    prep_time_mins: parsed.prep_time_mins || null,
    cook_time_mins: parsed.cook_time_mins || null,
    servings: parsed.servings || 4,
    dietary_tags: parsed.dietary_tags || [],
    source_type: 'ai_generated',
  });

  // Attach parsed data for formatting (DB may store method as string)
  recipe._parsed = parsed;
  return recipe;
}

/**
 * Format a recipe for WhatsApp — concise, family-friendly, actionable.
 */
function formatRecipeResponse(recipe) {
  const parsed = recipe._parsed || {};
  const name = recipe.name || parsed.name;
  const servings = recipe.servings || parsed.servings || 4;
  const prepMins = recipe.prep_time_mins || parsed.prep_time_mins;
  const cookMins = recipe.cook_time_mins || parsed.cook_time_mins;
  const totalMins = (prepMins || 0) + (cookMins || 0);
  const ingredients = recipe.ingredients || parsed.ingredients || [];
  const method = parsed.method || (typeof recipe.method === 'string' ? recipe.method.split('\n') : recipe.method) || [];

  const lines = [];

  // Confirmation
  lines.push(`✅ *${name}* saved to your recipes!`);
  lines.push(`🍽 Serves ${servings}${totalMins ? ` · ⏱ ${totalMins} mins` : ''}`);
  lines.push('');

  // Key ingredients (top 5-6)
  if (ingredients.length > 0) {
    lines.push('*Key ingredients:*');
    const mainIngredients = ingredients.filter(i => !i.optional).slice(0, 6);
    for (const ing of mainIngredients) {
      const qty = ing.quantity && ing.unit ? `${ing.quantity}${ing.unit} ` : ing.quantity ? `${ing.quantity} ` : '';
      lines.push(`• ${qty}${ing.name}`);
    }
    if (ingredients.length > 6) {
      lines.push(`_+${ingredients.length - 6} more in your recipe box_`);
    }
    lines.push('');
  }

  // Quick steps (max 4)
  if (method.length > 0) {
    lines.push('*Quick steps:*');
    const steps = method.slice(0, 4);
    steps.forEach((step, i) => {
      // Clean up step text — remove "Step X:" prefix if present
      const clean = step.replace(/^step\s*\d+[:.]\s*/i, '').trim();
      lines.push(`${i + 1}. ${clean}`);
    });
    if (method.length > 4) {
      lines.push(`_Full method in your recipe box_`);
    }
    lines.push('');
  }

  // Call to action
  lines.push('Would you like me to add the ingredients to your shopping list?');

  return lines.join('\n');
}

module.exports = {
  handleTextMessage,
  handleVoiceNote,
  handlePhoto,
  handleList,
  handleTasks,
  handleMyTasks,
  buildBroadcastMessage,
  formatShoppingList,
  formatTaskList,
  generateAndSaveRecipe,
  formatRecipeResponse,
  CATEGORY_EMOJI,
  capitalise,
};
