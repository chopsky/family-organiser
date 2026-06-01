/**
 * Bulk extraction → calendar/tasks, shared by two WhatsApp paths:
 *
 *   1. Pasted text  — a parent pastes a fixture list / school letter
 *      straight into the chat (the U11 cricket team sheet in the
 *      2026-06-01 churn transcript). The conversational classifier
 *      treated it as chat and just said "Thanks for the details" without
 *      extracting anything. looksLikeBulkPaste() detects this shape so
 *      handleTextMessage can route it here instead.
 *
 *   2. Documents    — a .pdf/.docx attachment, text-extracted upstream
 *      by services/document-extract.js, then run through the same path.
 *
 * Both reuse ai.extractFromEmail (the proven email→events/tasks
 * extractor) and create rows exactly the way routes/inbound-email.js
 * does, so behaviour is consistent across email, paste, and document.
 */

// db + ai are lazy-required inside the functions that use them so the
// pure detector (looksLikeBulkPaste) can be imported - and unit-tested -
// without booting the Supabase client / dotenv chain.

// ── Detection ──────────────────────────────────────────────────────
// Conservative gate: only treat a message as a bulk paste when it's
// genuinely document-shaped. A false negative just means it flows to the
// normal classifier (no harm); a false positive costs one extra LLM call
// and still falls through to classify if nothing is extracted. We bias
// toward catching real schedules without hijacking ordinary chat.
const DATE_RE = /\b(\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?)\b|\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;
const TIME_RE = /\b\d{1,2}:\d{2}\b|\b\d{1,2}\s?(?:am|pm)\b/i;
const KEYWORD_RE = /\b(fixture|fixtures|match|kick.?off|venue|squad|team\s?sheet|practice|training|rehearsal|parents?.?evening|inset|half.?term|sports\s?day|nativity|concert|assembly|deadline|due|term\s?dates?|trip|swimming|cricket|football|rugby|netball|hockey|tournament)\b/i;

/**
 * Does this message look like a pasted schedule / letter the user wants
 * us to extract from (rather than conversational text)?
 */
function looksLikeBulkPaste(text) {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  if (t.length < 60) return false; // too short to be a letter/fixture list

  const lines = t.split(/\r?\n/).filter(l => l.trim().length > 0);
  const lineCount = lines.length;
  const isLongish = t.length >= 180 || lineCount >= 4;
  if (!isLongish) return false;

  const hasDate = DATE_RE.test(t);
  const hasTime = TIME_RE.test(t);
  const hasKeyword = KEYWORD_RE.test(t);

  // A long block with a date or schedule keyword is almost certainly
  // extractable. Time alone is weak (chat says "meet at 3pm"), so we
  // only honour time when the block is also multi-line.
  return hasDate || hasKeyword || (hasTime && lineCount >= 4);
}

// ── Apply ──────────────────────────────────────────────────────────
// Mirrors routes/inbound-email.js event/task creation so paste +
// document behave identically to a forwarded email.
async function applyExtraction(extraction, user, household) {
  const db = require('../db/queries');
  const members = household.members || [];
  const actions = {
    shoppingAdded: [], shoppingCompleted: [], tasksAdded: [], tasksCompleted: [], eventsAdded: [],
  };

  // Events
  if (Array.isArray(extraction?.events)) {
    for (const ev of extraction.events) {
      if (!ev?.title || !ev?.date) continue;
      try {
        const rawNames = ev.assigned_to_names || (ev.assigned_to_name ? [ev.assigned_to_name] : []);
        const { ids: assigneeIds, names: assigneeNames } = db.resolveAssignees(rawNames, members);
        const firstAssignee = assigneeIds.length > 0 ? members.find(m => m.id === assigneeIds[0]) : null;
        // AI emits local times - store without Z so the app reads them in
        // the household timezone (same as manually-created events).
        const startTime = ev.all_day ? `${ev.date}T00:00:00` : `${ev.date}T${ev.start_time || '09:00'}:00`;
        const endTime = ev.all_day ? `${ev.date}T23:59:59` : `${ev.date}T${ev.end_time || ev.start_time || '10:00'}:00`;
        const created = await db.createCalendarEvent(household.id, {
          title: ev.title,
          start_time: startTime,
          end_time: endTime,
          all_day: !!ev.all_day,
          assigned_to_ids: assigneeIds,
          assigned_to_names: assigneeNames,
          color: firstAssignee?.color_theme || 'sage',
          location: ev.location || null,
          description: ev.description || null,
        }, user.id);
        if (created && assigneeNames.length > 0) {
          await db.saveEventAssignees(created.id, household.id, assigneeNames, members);
        }
        if (created) actions.eventsAdded.push(created);
      } catch (err) {
        console.warn('[bulk-extract] event create failed:', err.message);
      }
    }
  }

  // Tasks
  if (Array.isArray(extraction?.tasks) && extraction.tasks.length > 0) {
    try {
      const inserted = await db.addTasks(
        household.id,
        extraction.tasks.filter(t => t?.title).map(t => ({ ...t, action: 'add' })),
        user.id,
        members,
      );
      for (const t of inserted || []) {
        actions.tasksAdded.push({
          title: t.title,
          assigned_to_names: Array.isArray(t.assigned_to_names) ? t.assigned_to_names : [],
        });
      }
    } catch (err) {
      console.warn('[bulk-extract] task create failed:', err.message);
    }
  }

  return actions;
}

/**
 * Build a concise WhatsApp confirmation of what was created.
 */
function summarise(actions, household) {
  const tz = household.timezone || 'Europe/London';
  const lines = [];
  if (actions.eventsAdded.length) {
    const { formatEventWhen } = require('../utils/event-when');
    lines.push(`📅 Added ${actions.eventsAdded.length} event${actions.eventsAdded.length !== 1 ? 's' : ''} to your calendar:`);
    for (const e of actions.eventsAdded.slice(0, 8)) {
      const when = formatEventWhen(e, tz);
      lines.push(`• ${e.title}${when ? ` — ${when}` : ''}`);
    }
  }
  if (actions.tasksAdded.length) {
    if (lines.length) lines.push('');
    lines.push(`📋 Added ${actions.tasksAdded.length} task${actions.tasksAdded.length !== 1 ? 's' : ''}:`);
    for (const t of actions.tasksAdded.slice(0, 8)) {
      lines.push(`• ${t.title}`);
    }
  }
  return lines.join('\n');
}

/**
 * Full pipeline: extract from a block of text, create the items, return
 * a bot-handler-shaped { response, actions, count }. count===0 means
 * nothing extractable was found - the caller should fall through to the
 * normal conversational classifier rather than show an empty success.
 *
 * @param {string} text     - the pasted text or document body
 * @param {string} subject  - optional subject/filename for context
 * @param {object} user
 * @param {object} household - must carry .members
 */
async function extractAndApply(text, subject, user, household) {
  const { extractFromEmail } = require('../services/ai');
  const members = household.members || [];
  const memberNames = members.map(m => m.name);
  let extraction = null;
  try {
    extraction = await extractFromEmail(text, subject || null, memberNames, {}, {
      householdId: household.id,
      userId: user.id,
    });
  } catch (err) {
    console.warn('[bulk-extract] extraction failed:', err.message);
    return { response: null, actions: null, count: 0 };
  }

  const actions = await applyExtraction(extraction, user, household);
  const count = actions.eventsAdded.length + actions.tasksAdded.length;
  if (count === 0) {
    return { response: null, actions: null, count: 0 };
  }
  return { response: summarise(actions, household), actions, count };
}

module.exports = { looksLikeBulkPaste, applyExtraction, extractAndApply, summarise };
