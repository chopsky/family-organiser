const { Router } = require('express');
const multer = require('multer');
const db = require('../db/queries');
const { requireAuth, requireHousehold } = require('../middleware/auth');
const { CHAT_ASSISTANT_SYSTEM, CHAT_ASSISTANT_CONTEXT } = require('../services/prompts');
const { formatPreferenceLines } = require('../services/preferences-format');
const { scanImage, scanReceipt, matchReceiptToList, classify } = require('../services/ai');
const { callWithFailover } = require('../services/ai-client');
const { getWeatherReport, composeWeatherAnswer, getCityFromTimezone, extractLocationFromMessage, geocodeLocation, reverseGeocode } = require('../services/weather');
const { messageMentionsLocation } = require('../utils/location-relevance');
const { summariseSchoolTermDates } = require('../utils/school-term-summary');
const { findExtractionDuplicates, skippedLine } = require('../services/event-dedupe');
const { parseRemindersFromMessage, messageMentionsReminder, snapToTaskNotification } = require('../utils/reminder-parser');
const { transcribeVoice } = require('../services/transcribe');
const assistantMeter = require('../services/assistant-meter');
const cache = require('../services/cache');

// ── In-app assistant budget ───────────────────────────────────────────────
// Deliberately set here, not inherited from ai-client's defaults (12s/2048),
// which are sized for short classify calls rather than a full assistant reply.
// See the call site in POST / for the live-traffic evidence behind each value.
const CHAT_TIMEOUT_MS = 30000;   // Claude's observed p95 is ~10.4s
const CHAT_MAX_TOKENS = 4096;    // 2048 truncated a real reply mid-answer
const CHAT_HISTORY_TURNS = 12;   // caps prompt growth (and thus latency drift)

// Multer config for chat attachments. Accepts both images (receipts,
// event invitations, screenshots) and PDFs (school newsletters, party
// invites that came as attachments). 10 MB is enough for either: a
// typical scanned receipt photo is 1-3 MB and a long-form school PDF is
// usually 2-5 MB.
const chatAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf';
    if (!ok) return cb(new Error('Only image and PDF files are accepted'));
    cb(null, true);
  },
});

// Voice input from the in-app composer mic. The browser records audio
// (webm on desktop, mp4 in the iOS WKWebView) and we transcribe it with
// Whisper. 15 MB covers a generous spoken note.
const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) return cb(null, true);
    return cb(new Error('Only audio files are accepted'));
  },
});

const router = Router();

/**
 * POST /api/chat/transcribe
 * Multipart: field `audio` = recorded clip. Returns { text }.
 * Powers the composer mic - the Web Speech API doesn't work in the iOS
 * WKWebView, so we record + transcribe server-side instead.
 */
router.post('/transcribe', requireAuth, requireHousehold, voiceUpload.single('audio'), async (req, res) => {
  try {
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'No audio received.' });
    }
    const name = req.file.originalname || 'voice.mp4';
    const text = await transcribeVoice(req.file.buffer, name);
    return res.json({ text: (text || '').trim() });
  } catch (err) {
    console.error('POST /api/chat/transcribe error:', err.message);
    return res.status(500).json({ error: 'Could not transcribe that audio. Please try again.' });
  }
});

/**
 * Convert a local date+time string to a UTC ISO timestamp using the user's timezone.
 * e.g. localToUTC('2026-03-19', '10:00', 'Africa/Johannesburg') → '2026-03-19T08:00:00Z'
 */
function localToUTC(date, time, timezone) {
  if (!timezone) return `${date}T${time || '00:00'}:00Z`;
  try {
    // Create a date in the target timezone
    const localStr = `${date}T${time || '00:00'}:00`;
    // Use Intl to get the UTC offset for this timezone at this date/time
    const dt = new Date(localStr + 'Z'); // treat as UTC first
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    // Get what the UTC time looks like in the target timezone
    const parts = formatter.formatToParts(dt);
    const get = (type) => parts.find(p => p.type === type)?.value || '00';
    const tzDate = `${get('year')}-${get('month')}-${get('day')}`;
    const tzTime = `${get('hour')}:${get('minute')}:${get('second')}`;

    // The difference between localStr and tzDate/tzTime is the offset
    const localMs = new Date(localStr + 'Z').getTime();
    const inTzMs = new Date(`${tzDate}T${tzTime}Z`).getTime();
    const offsetMs = inTzMs - localMs; // how much the timezone is ahead of UTC

    // To get UTC from local time: subtract the offset
    const utcMs = localMs - offsetMs;
    return new Date(utcMs).toISOString().replace('.000Z', 'Z');
  } catch {
    return `${date}T${time || '00:00'}:00Z`;
  }
}

// Wall-clock components of a stored UTC instant, as seen in a timezone.
// en-CA date format is YYYY-MM-DD; hourCycle h23 keeps midnight as "00".
function ymdInTz(d, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function hhmmInTz(d, tz) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}

/**
 * Translate an update_event action's new_* fields into a calendar_events
 * column patch. Only fields the model actually set land in the patch;
 * date and time sides rebuild independently from the existing values so
 * "move it to Tuesday" keeps the time and "make it 12pm" keeps the day.
 * When only a new start is given the event keeps its LENGTH (the bot's
 * keep-the-old-end behaviour could invert start/end - "move the 10-11
 * meeting to 12" must not end at 11).
 */
function buildChatEventPatch(act, existing, tz, members) {
  const patch = {};
  if (act.new_title) patch.title = act.new_title;
  if (act.new_location !== undefined && act.new_location !== null) patch.location = act.new_location;
  // Recurrence edits ("make the birthdays yearly") - explicit null clears
  // the repeat ("stop it repeating"), absent leaves it alone.
  if (act.new_recurrence !== undefined) patch.recurrence = act.new_recurrence;
  if (Array.isArray(act.assigned_to_names)) {
    const { ids, names } = db.resolveAssignees(act.assigned_to_names, members);
    patch.assigned_to_ids = ids;
    patch.assigned_to_names = names;
  }

  const hasNewDate = !!act.new_date;
  const hasNewStart = !!act.new_start_time;
  const hasNewEnd = !!act.new_end_time;
  if (!hasNewDate && !hasNewStart && !hasNewEnd) return patch;

  if (existing.all_day && !hasNewStart && !hasNewEnd) {
    // Pure date move of an all-day event keeps the naive convention.
    patch.start_time = `${act.new_date}T00:00:00Z`;
    patch.end_time = `${act.new_date}T23:59:59Z`;
    return patch;
  }

  const startD = new Date(existing.start_time);
  const endD = existing.end_time ? new Date(existing.end_time) : null;
  const dateStr = act.new_date
    || (existing.all_day ? String(existing.start_time).slice(0, 10) : ymdInTz(startD, tz));
  const startHHMM = act.new_start_time
    || (existing.all_day || isNaN(startD.getTime()) ? '09:00' : hhmmInTz(startD, tz));
  patch.start_time = localToUTC(dateStr, startHHMM, tz);
  if (hasNewEnd) {
    patch.end_time = localToUTC(dateStr, act.new_end_time, tz);
  } else {
    const durMs = !existing.all_day && endD && !isNaN(endD.getTime()) && endD > startD
      ? endD.getTime() - startD.getTime()
      : 60 * 60 * 1000;
    patch.end_time = new Date(Date.parse(patch.start_time) + durMs).toISOString().replace('.000Z', 'Z');
  }
  // Giving a timed slot to an all-day event makes it a timed event.
  if (existing.all_day && (hasNewStart || hasNewEnd)) patch.all_day = false;
  return patch;
}

/**
 * Build the system prompt with family context injected.
 */
async function buildSystemPrompt(householdId, householdName, userId, currentMessage = '', deviceCoords = null) {
  // Fetch window anchored a day EARLY: server-UTC "today" can be the
  // household's yesterday (NZ mornings) or tomorrow (US evenings), and the
  // prompt's date below is computed in the household timezone - the window
  // must contain it either way.
  const today = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const twoWeeks = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];

  const [members, notes, shopping, tasks, events, household, schools, recipes, rawPreferences, activities, mealPlan] = await Promise.all([
    db.getHouseholdMembers(householdId),
    db.getHouseholdNotes(householdId),
    db.getShoppingList(householdId),
    db.getAllIncompleteTasks(householdId),
    db.getCalendarEvents(householdId, today, twoWeeks),
    db.getHouseholdById(householdId),
    db.getHouseholdSchools(householdId),
    db.getRecipes(householdId).catch(() => []),
    db.getHouseholdPreferences(householdId).catch(() => []),
    db.getHouseholdActivities(householdId).catch(() => []),
    db.getMealPlanForWeek(householdId, today, twoWeeks).catch(() => []),
  ]);

  // Fetch term dates for the household's schools so the AI can answer
  // "when does the current term end?" / "when's the next break?" from
  // real data instead of hallucinating from training-set patterns.
  // Without this the bot defaulted to UK May half-term even for SA
  // households on Herzlia's calendar.
  const schoolIds = schools.map((s) => s.id);
  const termDates = schoolIds.length > 0
    ? await db.getTermDatesBySchoolIds(schoolIds).catch(() => [])
    : [];
  const termDatesSummary = summariseSchoolTermDates(schools, termDates);

  const currentUser = members.find(m => m.id === userId);
  const userTz = currentUser?.timezone || household?.timezone || 'Europe/London';
  // Location prompt: gated entirely on whether the current message
  // looks location-relevant. If it does and we have a home address,
  // send the full address. If it does but we only have a timezone,
  // send the coarse city. If it doesn't, send NOTHING - the AI
  // doesn't need to know where the household is to mark milk as
  // bought. See utils/location-relevance.js for the matcher.
  const homeAddress = household?.address?.trim();
  const userCity = getCityFromTimezone(userTz);
  const wantsLocation = messageMentionsLocation(currentMessage);
  // Device GPS (from the iOS app) is the PRIMARY location source - where the
  // user actually is right now beats the saved home address (they might be
  // out and about). Reverse-geocode to a city label only when the message is
  // location-relevant, to avoid a network round-trip on every chat turn.
  let deviceCity = null;
  if (wantsLocation && deviceCoords
      && Number.isFinite(deviceCoords.lat) && Number.isFinite(deviceCoords.lon)) {
    try {
      const rev = await reverseGeocode(deviceCoords.lat, deviceCoords.lon);
      if (rev?.name && rev.name !== 'your location') deviceCity = rev.name;
    } catch { /* fall back to address/timezone */ }
  }
  let locationStr = '';
  if (wantsLocation && deviceCity) {
    locationStr = `The user is currently in **${deviceCity}** (from their live device location). Use this for proximity-aware recommendations - suggest specific restaurants, GPs, dentists, parks, shops, services nearby. Mention neighbourhoods or rough distance ("about a 10-minute walk", "in Camden") rather than coordinates.`;
  } else if (wantsLocation && homeAddress) {
    locationStr = `The family's home address is **${homeAddress}**. Use this for proximity-aware recommendations - suggest specific restaurants, GPs, dentists, parks, shops, services nearby. Mention neighbourhoods or rough distance ("about a 10-minute walk", "in Camden") rather than echoing the full street address back to the user. Treat the exact address as confidential.`;
  } else if (wantsLocation && userCity) {
    locationStr = `The family is based in **${userCity}**. Use this for local recommendations - suggest specific places, neighbourhoods, and services in this area.`;
  }

  const membersStr = members.map(m => `${m.name}${m.family_role ? ` (${m.family_role})` : ''}`).join(', ') || 'none';
  const householdAllergies = (() => { try { return JSON.parse(household?.allergies || '[]'); } catch { return []; } })();
  const allergiesStr = householdAllergies.length > 0 ? householdAllergies.join(', ') : null;
  const notesStr = notes.length > 0
    ? notes.map(n => `- ${n.key}: ${n.value}`).join('\n')
    : '(none saved yet)';
  const shoppingStr = shopping.filter(i => !i.completed).length > 0
    ? shopping.filter(i => !i.completed).map(i => `- ${i.item}${i.category ? ` [${i.category}]` : ''}`).join('\n')
    : '(empty)';
  // Render the assignee list for a task/event row. Multi-assignee rows
  // (the new model) come through as assigned_to_names[]; we display
  // "Lynn", "Lynn & Grant" etc. Empty array shows no bracket.
  const formatWho = (row) => {
    const names = Array.isArray(row.assigned_to_names) ? row.assigned_to_names.filter(Boolean) : [];
    if (names.length === 0) return '';
    if (names.length === 1) return ` (${names[0]})`;
    return ` (${names.slice(0, -1).join(', ')} & ${names[names.length - 1]})`;
  };
  const tasksStr = tasks.length > 0
    ? tasks.map(t => `- ${t.title}${formatWho(t)}${t.due_date ? ` due ${t.due_date}` : ''}`).join('\n')
    : '(none)';
  const eventsStr = events.length > 0
    ? events.map(e => `- ${e.title} on ${e.start_time?.split('T')[0] || 'TBD'}${formatWho(e)}`).join('\n')
    : '(none)';

  // Build school context
  let schoolsStr = '(none)';
  if (schools.length > 0) {
    const schoolLines = [];
    for (const school of schools) {
      const children = members.filter(m => m.school_id === school.id);
      if (children.length > 0) {
        const childNames = children.map(c => c.name).join(', ');
        schoolLines.push(`${school.school_name}: ${childNames}`);
      }
    }
    if (schoolLines.length > 0) schoolsStr = schoolLines.join('\n');
  }
  // Append real term-date data (current term, future term boundaries,
  // upcoming closures) so questions like "when does the current term
  // end?" resolve from household data, not the model's training set.
  if (termDatesSummary) {
    schoolsStr = `${schoolsStr === '(none)' ? '' : `${schoolsStr}\n\n`}TERM DATES & CLOSURES (use these for any question about school term, break, or holiday timing - do NOT guess from general knowledge):\n${termDatesSummary}`;
  }

  // Surface the recipe box (id + name + dietary tags) so the AI can
  // (a) avoid creating duplicates and (b) target a specific recipe by
  // id for delete_recipe. Without this the model used to hallucinate
  // deletes for recipes it had no way to identify.
  const recipesStr = recipes.length > 0
    ? recipes.map(r => {
        const tags = Array.isArray(r.dietary_tags) && r.dietary_tags.length > 0
          ? ` [${r.dietary_tags.join(', ')}]`
          : '';
        return `- ${r.name}${tags} (id: ${r.id})`;
      }).join('\n')
    : '(empty)';

  // Weekly extracurriculars with ids so the model can target skip_activity /
  // update_activity / delete_activity precisely (same ID-grounding pattern
  // as the recipe box). Upcoming skips are shown so "is swimming on this
  // week?" answers correctly and unskip requests can name a real date.
  const DAY_NAMES = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
  const activitiesStr = activities.length > 0
    ? activities.map((a) => {
        const child = members.find((m) => m.id === a.child_id);
        const time = a.time_start
          ? ` ${String(a.time_start).slice(0, 5)}${a.time_end ? `-${String(a.time_end).slice(0, 5)}` : ''}`
          : '';
        const pickup = a.pickup_member_id
          ? `, pickup: ${members.find((m) => m.id === a.pickup_member_id)?.name || 'unknown'}`
          : '';
        const term = a.start_date || a.end_date
          ? `, runs ${a.start_date || '…'} to ${a.end_date || '…'}${a.term_label ? ` (${a.term_label})` : ''}`
          : '';
        const hidden = a.show_on_calendar === false ? ', hidden from adult calendar' : '';
        const upcomingSkips = (a.skips || []).filter((d) => d >= today);
        const skips = upcomingSkips.length > 0 ? `, skipped: ${upcomingSkips.join(', ')}` : '';
        // Upcoming one-off changes so "is swimming still at 3 on Thursday?"
        // answers correctly and "back to normal" can name a real date.
        const upcomingOverrides = Object.entries(a.overrides || {}).filter(([d]) => d >= today);
        const changed = upcomingOverrides.length > 0
          ? `, changed: ${upcomingOverrides.map(([d, o]) => `${d}${o.time_start ? ` at ${String(o.time_start).slice(0, 5)}` : ''}`).join(', ')}`
          : '';
        return `- ${child?.name || 'Unknown child'} - ${a.activity}: ${DAY_NAMES[a.day_of_week] || '?'}${time}${pickup}${term}${hidden}${skips}${changed} (id: ${a.id})`;
      }).join('\n')
    : '(none)';

  // The next fortnight's meal plan, day-labelled, so "add these to my meal
  // plan" can spread meals over genuinely free days and "what's for dinner
  // Thursday?" answers from real data. Days absent from the list are free -
  // the prompt says so, so an empty plan needs no special copy.
  const weekday = (dateStr) => {
    try {
      return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long' });
    } catch { return ''; }
  };
  const mealPlanStr = (mealPlan || []).length > 0
    ? mealPlan.map((mp) => {
        const name = mp.meal_name || mp.recipes?.name || 'meal';
        return `- ${mp.date} (${weekday(mp.date)}) ${mp.category || 'dinner'}: ${name}`;
      }).join('\n')
    : '(nothing planned yet - every day is free)';

  // Learned family preferences - the same block the WhatsApp classifier sees,
  // so the web/app assistant honours allergies, dietary rules, dislikes and
  // schedule anchors instead of only the legacy household.allergies field.
  // Resolve member_id -> name up front (the formatter reads member_name).
  const preferencesStr = formatPreferenceLines(
    (rawPreferences || []).map((p) => ({
      ...p,
      member_name: p.member_id ? (members.find((m) => m.id === p.member_id)?.name || null) : null,
    })),
  );

  // Two-block system prompt (same shape as classify): CHAT_ASSISTANT_SYSTEM
  // is placeholder-free static rules served from the provider prompt cache;
  // only this FAMILY DATA block varies per household/message.
  let context = CHAT_ASSISTANT_CONTEXT
    .replace(/{{HOUSEHOLD_NAME}}/g, householdName || 'your')
    .replace(/{{DATE}}/g, ymdInTz(new Date(), userTz))
    .replace(/{{SENDER}}/g, currentUser?.name || 'the user')
    .replace(/{{TIMEZONE}}/g, userTz)
    .replace(/{{LOCATION}}/g, locationStr)
    .replace(/{{MEMBERS}}/g, membersStr)
    .replace(/{{SHOPPING_LIST}}/g, shoppingStr)
    .replace(/{{TASKS}}/g, tasksStr)
    .replace(/{{EVENTS}}/g, eventsStr)
    .replace(/{{SCHOOLS}}/g, schoolsStr)
    .replace(/{{NOTES}}/g, notesStr)
    .replace(/{{PREFERENCES}}/g, preferencesStr)
    .replace(/{{RECIPES}}/g, recipesStr)
    .replace(/{{ACTIVITIES}}/g, activitiesStr)
    .replace(/{{MEAL_PLAN}}/g, mealPlanStr);

  if (allergiesStr) {
    context += `\n\nHOUSEHOLD ALLERGIES & DIETARY REQUIREMENTS: ${allergiesStr}\nALWAYS avoid these allergens/restrictions when suggesting recipes, meals, or food-related advice.`;
  }

  return [
    { text: CHAT_ASSISTANT_SYSTEM, cache: true },
    { text: context },
  ];
}

/**
 * Extract all action JSON blocks from assistant response.
 * Returns { cleanContent, actions[] } where actions may be empty.
 */
// Return the balanced {...} JSON substring starting at `start` (string-aware
// so braces inside quoted values don't miscount), or null if unbalanced.
function balancedJson(text, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

function extractActions(content) {
  const actions = [];
  let cleanContent = content;

  const take = (parsed) => {
    if (parsed.action) {
      actions.push(parsed);
      return true;
    }
    if (parsed.note_action === 'save') { actions.push({ action: 'save_note', key: parsed.key, value: parsed.value }); return true; }
    if (parsed.note_action === 'delete') { actions.push({ action: 'delete_note', key: parsed.key }); return true; }
    return false;
  };

  // 1. Fenced blocks. Tolerant of the fence tag (```json / ```JSON / bare
  // ```) and of nested objects/arrays inside the payload - the old
  // lazy-to-first-} regex silently dropped any block with nesting, and the
  // lowercase-only tag dropped ```JSON. A dropped block = an action the
  // model emitted but we never executed, while the prose claims success.
  //
  // A fence may hold SEVERAL objects, one per line ("add 5 easy dinners"
  // produced five create_recipe objects in one ```json fence; parsing only
  // the first saved 1 of 5 recipes while the prose claimed all five). Walk
  // the fence body object-by-object until the closing backticks.
  const fenceOpen = /```[a-zA-Z]*\s*\n?\s*(?=\{)/g;
  let m;
  while ((m = fenceOpen.exec(content)) !== null) {
    let cursor = m.index + m[0].length;
    const fenceEnd = content.indexOf('```', cursor);
    const limit = fenceEnd >= 0 ? fenceEnd : content.length;
    let took = false;
    while (cursor < limit) {
      const nextBrace = content.indexOf('{', cursor);
      if (nextBrace < 0 || nextBrace >= limit) break;
      const jsonText = balancedJson(content, nextBrace);
      if (!jsonText) break;
      try {
        if (take(JSON.parse(jsonText))) took = true;
      } catch { /* skip malformed JSON */ }
      cursor = nextBrace + jsonText.length;
    }
    if (took) {
      // Strip the whole fence (opening tag + JSON + closing backticks if present).
      const fullBlock = content.slice(m.index, fenceEnd >= 0 ? fenceEnd + 3 : cursor);
      cleanContent = cleanContent.replace(fullBlock, '');
    }
  }

  // 2. Bare inline {"action": ...} objects (not in fences) - brace-balanced
  // for the same nesting reason.
  const bareOpen = /\{"action"\s*:/g;
  while ((m = bareOpen.exec(cleanContent)) !== null) {
    const jsonText = balancedJson(cleanContent, m.index);
    if (!jsonText) continue;
    try {
      const parsed = JSON.parse(jsonText);
      if (parsed.action) {
        actions.push(parsed);
        cleanContent = cleanContent.replace(jsonText, '');
        bareOpen.lastIndex = 0; // indices shifted after the splice
      }
    } catch { /* skip malformed JSON */ }
  }

  return { cleanContent: cleanContent.trim(), actions };
}

// List conversations
router.get('/conversations', requireAuth, requireHousehold, async (req, res) => {
  try {
    const conversations = await db.getConversations(req.user.id);
    // Get last message preview for each conversation. Assistant messages
    // are stored RAW (action blocks included) so the model can see its own
    // past blocks; strip them for the human-facing preview.
    const withPreviews = await Promise.all(conversations.map(async (conv) => {
      const msgs = await db.getChatHistory(conv.id, 1, req.householdId);
      const raw = msgs[0]?.content || null;
      const preview = raw ? extractActions(raw).cleanContent.trim() : null;
      return { ...conv, lastMessage: preview ? preview.substring(0, 80) : null };
    }));
    return res.json({ conversations: withPreviews });
  } catch (err) {
    console.error('GET /api/chat/conversations error:', err);
    return res.status(500).json({ error: 'Failed to load conversations.' });
  }
});

// Create new conversation
router.post('/conversations', requireAuth, requireHousehold, async (req, res) => {
  try {
    const { title } = req.body;
    const conversation = await db.createConversation(req.householdId, req.user.id, title);
    return res.status(201).json({ conversation });
  } catch (err) {
    console.error('POST /api/chat/conversations error:', err);
    return res.status(500).json({ error: 'Failed to create conversation.' });
  }
});

// Delete conversation
router.delete('/conversations/:id', requireAuth, requireHousehold, async (req, res) => {
  try {
    await db.deleteConversation(req.params.id, req.user.id);
    return res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/chat/conversations error:', err);
    return res.status(500).json({ error: 'Failed to delete conversation.' });
  }
});

/**
 * GET /api/chat/history
 * Returns recent chat messages for a conversation.
 */
router.get('/history', requireAuth, requireHousehold, async (req, res) => {
  try {
    const { conversation_id } = req.query;
    if (conversation_id) {
      const messages = await db.getChatHistory(conversation_id, 50, req.householdId);
      // Assistant rows are stored RAW (with their action blocks) so the
      // LLM's replayed history matches what it actually wrote. Strip the
      // blocks here - clients only ever render clean prose.
      const display = messages.map((m) => (
        m.role === 'assistant'
          ? { ...m, content: extractActions(m.content || '').cleanContent.trim() }
          : m
      ));
      return res.json({ messages: display });
    }
    return res.json({ messages: [] });
  } catch (err) {
    console.error('GET /api/chat/history error:', err);
    return res.status(500).json({ error: 'Failed to load chat history.' });
  }
});

/**
 * DELETE /api/chat/history
 * Clear all chat messages for a conversation.
 */
router.delete('/history', requireAuth, requireHousehold, async (req, res) => {
  try {
    const { conversation_id } = req.body;
    await db.clearChatHistory(conversation_id, req.householdId);
    return res.json({ message: 'Chat history cleared.' });
  } catch (err) {
    console.error('DELETE /api/chat/history error:', err);
    return res.status(500).json({ error: 'Failed to clear chat history.' });
  }
});

/**
 * POST /api/chat
 * Send a message to the AI assistant and get a response.
 */
router.post('/', requireAuth, requireHousehold, async (req, res) => {
  const { message, conversation_id, coords } = req.body;

  if (!message?.trim()) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  // Device GPS from the iOS app (primary location source). Validate defensively
  // - bad/absent coords just fall back to the saved household address.
  const deviceCoords = coords
    && Number.isFinite(Number(coords.lat)) && Number.isFinite(Number(coords.lon))
    ? { lat: Number(coords.lat), lon: Number(coords.lon) }
    : null;

  try {
    // Resolve or create conversation
    let conversationId = conversation_id;
    if (!conversationId) {
      const conv = await db.createConversation(req.householdId, req.user.id, message.substring(0, 50));
      conversationId = conv.id;
    }

    // Build context-rich system prompt. The current user message is
    // passed in so the prompt builder can gate the precise home
    // address: it's only added to the prompt when this specific
    // message asks about somewhere local. See location-relevance.js.
    const household = await db.getHouseholdById(req.householdId);

    // ── Assistant meter (free-app mode) ──
    // Quota meta-questions are free, exact, and never touch a model.
    if (assistantMeter.enabled() && household && assistantMeter.isQuotaQuestion(message)) {
      const status = await assistantMeter.meterStatus(household);
      const answer = assistantMeter.quotaAnswer(status);
      await db.saveChatMessage(req.householdId, req.user.id, 'user', message.trim(), conversationId);
      await db.saveChatMessage(req.householdId, req.user.id, 'assistant', answer, conversationId);
      return res.json({ message: answer, conversation_id: conversationId });
    }
    // Over-limit gate BEFORE the model call, so exhausted traffic costs no
    // tokens. In-app we always answer - the user is looking at the thread
    // - full version daily, short after that (stamp shared with the
    // WhatsApp throttle).
    if (assistantMeter.isMeteredHousehold(household)) {
      const status = await assistantMeter.meterStatus(household);
      if (status.metered && status.exhausted) {
        const lastNotice = household.meter_limit_notice_at
          ? new Date(household.meter_limit_notice_at).getTime() : 0;
        const reply = Date.now() - lastNotice > 24 * 60 * 60 * 1000
          ? assistantMeter.limitReplyFull(status.resetLabel, process.env.WEB_URL)
          : assistantMeter.limitReplyShort(status.resetLabel, process.env.WEB_URL);
        db.markMeterLimitNotice(req.householdId).catch(() => {});
        await db.saveChatMessage(req.householdId, req.user.id, 'user', message.trim(), conversationId);
        await db.saveChatMessage(req.householdId, req.user.id, 'assistant', reply, conversationId);
        return res.json({ message: reply, conversation_id: conversationId });
      }
    }

    const systemPrompt = await buildSystemPrompt(req.householdId, household?.name, req.user.id, message, deviceCoords);

    // Get recent conversation history for context. Capped at 12 turns (was
    // 30): the prompt grows with the conversation, and latency grows with it
    // - live traffic showed input tokens climbing 7.2k → 8.6k across a single
    // chat while Claude's response time climbed 3.4s → 10.4s, until turns
    // tipped over the abort ceiling. 12 turns keeps plenty of context for a
    // family assistant while stopping long chats from getting progressively
    // slower. (getChatHistory returns the most recent N, oldest-first.)
    const history = await db.getChatHistory(conversationId, CHAT_HISTORY_TURNS, req.householdId);

    // Build messages array
    const messages = [
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message.trim() },
    ];

    // Claude-primary, same as the WhatsApp classifier: the in-app assistant
    // executes actions parsed from the reply, and Gemini Flash was the source
    // of prose-claims-without-action-blocks ("I've added X" with no JSON, so
    // nothing saved). Gemini stays as the failover.
    const { text: aiText, provider } = await callWithFailover({
      system: systemPrompt,
      messages,
      preferClaude: true,
      feature: 'chat',
      householdId: req.householdId,
      userId: req.user.id,
      // Explicit budget - do NOT inherit ai-client's 12s/2048 defaults, which
      // are sized for short classify calls. Live traffic showed Claude aborted
      // at exactly 12.00s on three real chats, each then failing over to
      // Gemini: the user still got an answer, but after ~20s of waiting, and
      // via the provider this route deliberately demoted (see the note above -
      // Gemini is the one that claims "I've added X" without an action block).
      // 30s comfortably covers Claude's observed p95 (~10.4s) with headroom,
      // so failover becomes a genuine emergency path rather than routine.
      timeoutMs: CHAT_TIMEOUT_MS,
      // 2048 truncated a real reply mid-answer (a failover response landed on
      // exactly 2048 output tokens); 4096 leaves room for a full reply plus
      // its trailing action JSON.
      maxTokens: CHAT_MAX_TOKENS,
    });
    if (provider !== 'claude') {
      console.log(`[chat] Response served by ${provider}`);
    }

    // Extract and process all actions
    let { cleanContent, actions } = extractActions(aiText);
    // Everything appended to cleanContent from here on (truth-guard notice,
    // executor warnings, weather reports) is an "appendix" the user must
    // see AND the model must remember. Snapshot the stripped base so the
    // save below can reconstruct raw-reply + appendices for history.
    const strippedBase = cleanContent;

    // Truth guard (real failure: "Okay, I've added Mason's tennis lesson…"
    // with NO action block, so nothing was saved and the user only found out
    // days later). If the prose claims a save/add/create but zero action
    // blocks parsed, correct the reply instead of letting the claim stand.
    // Three phrasings caught: "I've added…", "I added…", and confirmations
    // that lead with the bare past-tense verb ("Removed Padel on Sunday…",
    // "Done, both entries deleted") - the last one slipped through and let
    // a no-op deletion read as success.
    const claimsAction = /\bI(?:'|’)?ve (?:added|created|scheduled|saved|set up|updated|removed|deleted|skipped|changed|moved)\b|\bI (?:added|created|scheduled|saved|removed|deleted|skipped|changed|moved)\b|(?:^|\n)\s*(?:Removed|Deleted|Added|Created|Updated|Rescheduled|Cancelled|Skipped|Changed|Moved)\b|(?:^|\n)\s*(?:Done|All set|Sorted)[,.!]/im;
    if (actions.length === 0 && claimsAction.test(cleanContent)) {
      console.warn('[chat] reply claimed an action but no action block parsed - correcting. Raw length:', aiText.length);
      cleanContent += '\n\n⚠️ Actually - I wasn\'t able to save that just now. Please ask me again.';
    }

    const members = await db.getHouseholdMembers(req.householdId);
    const currentUser = members.find(m => m.id === req.user.id);
    const userTz = currentUser?.timezone || household?.timezone || 'Europe/London';
    const executedActions = [];

    for (const act of actions) {
      try {
        if (act.action === 'save_note' && act.key && act.value) {
          await db.upsertHouseholdNote(req.householdId, act.key, act.value, req.user.id);
          executedActions.push({ type: 'save_note', key: act.key });

        } else if (act.action === 'delete_note' && act.key) {
          await db.deleteHouseholdNote(req.householdId, act.key);
          executedActions.push({ type: 'delete_note', key: act.key });

        } else if (act.action === 'create_event') {
          // The chat-assistant prompt still emits act.assigned_to as a
          // single name string; treat it as a one-element array for the
          // new multi-assignee schema and resolve via the shared helper.
          const rawNames = Array.isArray(act.assigned_to_names)
            ? act.assigned_to_names
            : (act.assigned_to ? [act.assigned_to] : []);
          const { ids: assigneeIds, names: assigneeNames } = db.resolveAssignees(rawNames, members);
          const firstAssignee = assigneeIds.length > 0
            ? members.find(m => m.id === assigneeIds[0])
            : null;
          const startTime = act.all_day
            ? `${act.date}T00:00:00Z`
            : localToUTC(act.date, act.start_time || '09:00', userTz);
          const endTime = act.all_day
            ? `${act.date}T23:59:59Z`
            : localToUTC(act.date, act.end_time || act.start_time || '10:00', userTz);

          const createdActEvent = await db.createCalendarEvent(req.householdId, {
            title: act.title,
            start_time: startTime,
            end_time: endTime,
            all_day: !!act.all_day,
            assigned_to_ids: assigneeIds,
            assigned_to_names: assigneeNames,
            color: firstAssignee?.color_theme || 'lavender',
            location: act.location || null,
            description: act.description || null,
            recurrence: act.recurrence || null,
          }, req.user.id);
          // Persist assignees to event_assignees, same as every bot-handler
          // creation path. Without this, chat-created events had names on the
          // row but no assignee rows - so anything filtering by assignees
          // (the kids' My Days calendar, member colour-coding) missed them.
          if (createdActEvent && assigneeNames.length > 0) {
            await db.saveEventAssignees(createdActEvent.id, req.householdId, assigneeNames, members);
          }
          // Rich card payload: the frontend renders a confirmation card
          // from this. Names + colours are resolved client-side from the
          // household roster so we only ship the canonical fields.
          executedActions.push({
            type: 'event_created',
            event: {
              id: createdActEvent?.id || null,
              title: act.title,
              start_time: startTime,
              end_time: endTime,
              all_day: !!act.all_day,
              location: act.location || null,
              recurrence: act.recurrence || null,
              assigned_to_names: assigneeNames,
            },
          });

        } else if (act.action === 'delete_event' && act.title) {
          // Chat can delete household events too (the assistant used to
          // claim it couldn't, stranding users with duplicates it created).
          // Fuzzy title match with an optional date narrower; events synced
          // from an external feed stay read-only. keep_recurring lets the
          // model clean up duplicate one-off copies without killing the
          // recurring series that shares their title.
          let candidates = (await db.findEventsByFuzzyTitle(req.householdId, act.title, {
            dateHint: act.date || null,
            limit: 25,
          })).filter((e) => !e.external_feed_id);
          if (act.keep_recurring) candidates = candidates.filter((e) => !e.recurrence);

          if (candidates.length === 0) {
            cleanContent += `\n\n⚠️ I couldn't find "${act.title}" on the calendar, so nothing was removed.`;
          } else if (candidates.length === 1 || act.all_matching) {
            for (const e of candidates) {
              await db.softDeleteCalendarEvent(e.id, req.householdId);
            }
            executedActions.push({
              type: 'events_deleted',
              count: candidates.length,
              titles: candidates.map((e) => e.title),
            });
          } else {
            cleanContent += `\n\n⚠️ I found ${candidates.length} events matching "${act.title}" - tell me which date to remove, or say "remove all of them".`;
          }

        } else if (act.action === 'update_event' && act.title) {
          // Chat can CHANGE events too. Without this action the model
          // improvised delete_event for "change the time to 12pm" (real
          // 2026-08-12 transcript) - the user watched their event vanish
          // instead of move. Same fuzzy targeting as delete_event; synced
          // copies stay read-only.
          const matches = await db.findEventsByFuzzyTitle(req.householdId, act.title, {
            dateHint: act.date || null,
            limit: 25,
          });
          const editable = matches.filter((e) => !e.external_feed_id);

          if (editable.length === 0) {
            cleanContent += matches.length > 0
              ? `\n\n⚠️ "${act.title}" syncs from another calendar, so I can't change it here - edit it in the source calendar and it'll update in Housemait automatically.`
              : `\n\n⚠️ I couldn't find "${act.title}" on the calendar, so nothing was changed.`;
          } else if (editable.length > 1 && !act.all_matching) {
            cleanContent += `\n\n⚠️ I found ${editable.length} events matching "${act.title}" - tell me which date you mean, or say "all of them".`;
          } else {
            // all_matching applies the same change to every match ("make
            // all the birthdays yearly", "move all the fixtures to 2pm") -
            // each event's patch is built against ITS OWN existing values
            // so a time change keeps each event's day.
            const eventTargets = act.all_matching ? editable : [editable[0]];
            const firstPatch = buildChatEventPatch(act, eventTargets[0], userTz, members);
            if (Object.keys(firstPatch).length === 0) {
              cleanContent += `\n\n⚠️ I couldn't work out what to change about "${eventTargets[0].title}" - tell me the new time, date, or details.`;
            } else {
              const updatedEvents = [];
              for (const hit of eventTargets) {
                const patch = buildChatEventPatch(act, hit, userTz, members);
                const updatedEvent = await db.updateCalendarEvent(hit.id, req.householdId, patch);
                // Assignee rows live in event_assignees (replacement
                // semantics) - keep them in step with the columns, same as
                // the create path.
                if (Array.isArray(patch.assigned_to_names)) {
                  await db.saveEventAssignees(hit.id, req.householdId, patch.assigned_to_names, members);
                }
                updatedEvents.push({
                  id: hit.id,
                  title: patch.title || hit.title,
                  start_time: updatedEvent?.start_time ?? patch.start_time ?? hit.start_time,
                  end_time: updatedEvent?.end_time ?? patch.end_time ?? hit.end_time,
                  all_day: patch.all_day ?? hit.all_day ?? false,
                  location: patch.location ?? hit.location ?? null,
                  recurrence: patch.recurrence !== undefined ? patch.recurrence : (hit.recurrence || null),
                  assigned_to_names: patch.assigned_to_names || hit.assigned_to_names || [],
                });
              }
              if (updatedEvents.length === 1) {
                executedActions.push({ type: 'event_updated', event: updatedEvents[0] });
              } else {
                executedActions.push({ type: 'events_updated', count: updatedEvents.length, titles: updatedEvents.map((e) => e.title) });
              }
            }
          }

        } else if (['skip_activity', 'override_activity', 'update_activity', 'delete_activity'].includes(act.action)) {
          // Weekly extracurriculars (child_weekly_schedule) - the prompt
          // lists them with ids, so the model targets by id. Household
          // scoping mirrors the /schools routes: the activity's child must
          // be a member of THIS household.
          const activity = act.activity_id ? await db.getChildActivityById(act.activity_id).catch(() => null) : null;
          const owned = activity && members.some((m) => m.id === activity.child_id);
          if (!owned) {
            cleanContent += `\n\n⚠️ I couldn't find that activity in your family's weekly schedule, so nothing was changed.`;
          } else if (act.action === 'skip_activity') {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(act.date || '')) {
              cleanContent += `\n\n⚠️ I couldn't work out which date to ${act.unskip ? 'restore' : 'skip'} - tell me the exact day.`;
            } else if (act.unskip) {
              await db.removeActivitySkip(act.activity_id, act.date);
              executedActions.push({ type: 'activity_unskipped', activity: activity.activity, date: act.date });
            } else {
              await db.addActivitySkip(act.activity_id, req.householdId, act.date, req.user.id);
              executedActions.push({ type: 'activity_skipped', activity: activity.activity, date: act.date });
            }
          } else if (act.action === 'override_activity') {
            // One-off change ("piano is at 4pm today"): the model only sets
            // the fields the user changed, so default the rest from the
            // series - an override row REPLACES all three fields for that
            // date (same contract as the calendar sheet's prefilled form).
            if (!/^\d{4}-\d{2}-\d{2}$/.test(act.date || '')) {
              cleanContent += `\n\n⚠️ I couldn't work out which date to change - tell me the exact day.`;
            } else {
              const timeOk = (t) => !t || /^\d{2}:\d{2}$/.test(t);
              if (!timeOk(act.time_start) || !timeOk(act.time_end)) {
                cleanContent += `\n\n⚠️ I couldn't parse that time - use HH:MM (e.g. 16:00).`;
              } else {
                let start = act.time_start || (activity.time_start ? String(activity.time_start).slice(0, 5) : null);
                let end = act.time_end || null;
                // Start moved but no end given: keep the series duration
                // rather than pinning the old end (17:30-18:00 moved to
                // 16:00 should become 16:00-16:30, not 16:00-18:00).
                if (act.time_start && !act.time_end && activity.time_start && activity.time_end) {
                  const mins = (t) => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5));
                  const dur = mins(activity.time_end) - mins(activity.time_start);
                  const endM = Math.min(23 * 60 + 59, mins(act.time_start) + Math.max(0, dur));
                  end = `${String(Math.floor(endM / 60)).padStart(2, '0')}:${String(endM % 60).padStart(2, '0')}`;
                } else if (!act.time_end && !act.time_start) {
                  end = activity.time_end ? String(activity.time_end).slice(0, 5) : null;
                }
                let pickupId = activity.pickup_member_id || null;
                if (act.pickup_name) {
                  const pick = members.find((m) => m.name.toLowerCase() === String(act.pickup_name).toLowerCase());
                  if (pick) pickupId = pick.id;
                }
                await db.addActivitySkip(act.activity_id, req.householdId, act.date, req.user.id, {
                  time_start: start,
                  time_end: end,
                  pickup_member_id: pickupId,
                });
                executedActions.push({ type: 'activity_overridden', activity: activity.activity, date: act.date });
              }
            }
          } else if (act.action === 'update_activity') {
            const fields = {};
            if (act.day_of_week !== null && act.day_of_week !== undefined) fields.day_of_week = act.day_of_week;
            if (act.activity) fields.activity = act.activity;
            if (act.time_start !== null && act.time_start !== undefined) fields.time_start = act.time_start;
            if (act.time_end !== null && act.time_end !== undefined) fields.time_end = act.time_end;
            if (act.show_on_calendar !== null && act.show_on_calendar !== undefined) fields.show_on_calendar = act.show_on_calendar;
            if (act.pickup_name !== null && act.pickup_name !== undefined) {
              // Resolve the pickup person by name; unknown names clear it
              // rather than guessing (empty string clears, per the query).
              const pick = members.find((m) => m.name.toLowerCase() === String(act.pickup_name).toLowerCase());
              fields.pickup_member_id = pick ? pick.id : null;
            }
            if (Object.keys(fields).length === 0) {
              cleanContent += `\n\n⚠️ I couldn't tell what to change about "${activity.activity}" - nothing was updated.`;
            } else {
              await db.updateChildActivity(act.activity_id, fields);
              executedActions.push({ type: 'activity_updated', activity: activity.activity });
            }
          } else {
            await db.deleteChildActivity(act.activity_id);
            executedActions.push({ type: 'activity_deleted', activity: activity.activity });
          }
          if (executedActions.some((e) => e.type?.startsWith('activity_'))) {
            cache.invalidate(`schools:${req.householdId}`);
          }

        } else if (act.action === 'create_list' && act.name) {
          // Named list on the Lists screen ("create a holiday list and add
          // baggage") - app-chat parity with the WhatsApp create_list
          // intent. Find-or-create, then put any items straight on it.
          const wanted = String(act.name).trim();
          const list = (await db.findShoppingListByName(req.householdId, wanted))
            || (await db.createShoppingList(req.householdId, wanted));
          if (act.items?.length) {
            const enriched = act.items.map(({ list_name: _stripped, ...i }) => ({
              ...i,
              list_id: list.id,
              aisle_category: i.aisle_category || i.category || 'Other',
            }));
            await db.addShoppingItemsWithDedupe(req.householdId, enriched, req.user.id, {});
          }
          executedActions.push({ type: 'create_list', name: list.name, count: act.items?.length || 0 });

        } else if (act.action === 'add_shopping' && act.items?.length) {
          // shopping_items.list_id is NOT NULL since multi-list support
          // landed - attach the target list + aisle_category before
          // insert, matching the classify.js / shopping.js pattern.
          // Items carrying list_name go to that named list (found or
          // created); everything else keeps the default list.
          const defaultList = await db.getDefaultShoppingList(req.householdId);
          const listCache = new Map();
          const listFor = async (rawName) => {
            const name = String(rawName || '').trim();
            if (!name) return defaultList;
            const key = name.toLowerCase();
            if (!listCache.has(key)) {
              listCache.set(key,
                (await db.findShoppingListByName(req.householdId, name))
                || (await db.createShoppingList(req.householdId, name)));
            }
            return listCache.get(key);
          };
          const enriched = [];
          for (const i of act.items) {
            const target = await listFor(i.list_name);
            const { list_name: _stripped, ...rest } = i;
            enriched.push({
              ...rest,
              list_id: target.id,
              aisle_category: i.aisle_category || i.category || 'Other',
            });
          }
          const { detectOverrideHint } = require('../utils/shoppingDedupe');
          const overrideHint = detectOverrideHint(message || '');
          await db.addShoppingItemsWithDedupe(req.householdId, enriched, req.user.id, { overrideHint });
          executedActions.push({ type: 'add_shopping', count: act.items.length });

        } else if (['complete_shopping_item', 'delete_shopping_item'].includes(act.action) && act.item) {
          // Shopping list management from chat - three households asked to
          // clear or tick off items and were told adding was all chat could
          // do (2026-07/08 transcripts). Fuzzy match like the bot does;
          // all_matching handles "remove all the juice".
          const itemMatches = await db.findShoppingItemsByFuzzyName(req.householdId, act.item, { limit: 25 });
          const itemVerb = act.action === 'complete_shopping_item' ? 'tick off' : 'remove';
          if (itemMatches.length === 0) {
            cleanContent += `\n\n⚠️ I couldn't find "${act.item}" on the shopping list, so nothing was changed.`;
          } else if (itemMatches.length > 1 && !act.all_matching) {
            const lines = itemMatches.slice(0, 5).map((i) => `• ${i.item}${i.quantity ? ` (x${i.quantity})` : ''}`);
            cleanContent += `\n\n⚠️ I found ${itemMatches.length} items matching "${act.item}" - tell me which to ${itemVerb}, or say "all of them":\n${lines.join('\n')}`;
          } else {
            const targets = act.all_matching ? itemMatches : [itemMatches[0]];
            if (act.action === 'complete_shopping_item') {
              for (const i of targets) await db.completeShoppingItemById(i.id);
              executedActions.push({ type: 'shopping_completed', count: targets.length, items: targets.map((i) => i.item) });
            } else {
              for (const i of targets) await db.deleteShoppingItem(i.id, req.householdId);
              executedActions.push({ type: 'shopping_deleted', count: targets.length, items: targets.map((i) => i.item) });
            }
          }

        } else if (act.action === 'clear_shopping') {
          // mode 'completed' (default) clears ticked-off items; 'all' wipes
          // the list. The model is prompted to use 'all' only when the user
          // unambiguously asks for the whole list to go.
          const mode = act.mode === 'all' ? 'all' : 'completed';
          const { removed } = await db.clearShoppingItems(req.householdId, { mode });
          executedActions.push({ type: 'shopping_cleared', mode, count: removed });

        } else if (act.action === 'fetch_weather') {
          // Location precedence for weather:
          //   1. An explicit place in the message ("weather in Brighton").
          //   2. The device's live GPS location (iOS app) - where they are
          //      right now beats a saved address.
          //   3. The household address under Family → Household settings.
          // Last resort is the "I don't know where you are" hint.
          const locationName = extractLocationFromMessage(message);
          const householdAddress = household?.address?.trim();
          // If the user named a place, geocode that. Else if we have device
          // coords, use them directly (reverse-geocoded for the label).
          // Else geocode the saved address.
          let geo = null;
          if (locationName) {
            geo = await geocodeLocation(locationName);
          } else if (deviceCoords) {
            const rev = await reverseGeocode(deviceCoords.lat, deviceCoords.lon);
            geo = {
              lat: deviceCoords.lat,
              lon: deviceCoords.lon,
              name: rev?.name || 'your location',
              country: rev?.country || '',
              timezone: 'auto',
            };
          } else if (householdAddress) {
            geo = await geocodeLocation(householdAddress);
          }
          const lookup = locationName || deviceCoords || householdAddress;
          if (!lookup) {
            cleanContent += "\n\n📍 I don't know where you live yet. Add your home address under Family → Household, or ask with a city like _\"weather in Brighton tomorrow\"_.";
          } else {
            if (!geo) {
              const fallbackHint = locationName
                ? `I couldn't find _"${locationName}"_ on the map. Try the full city + country, e.g. _"weather in Cape Town, South Africa"_.`
                : `I couldn't geocode your saved home address. Check it under Family → Household, or ask with a city like _"weather in Brighton tomorrow"_.`;
              cleanContent += `\n\n🗺️ ${fallbackHint}`;
            } else {
              const report = await getWeatherReport(geo.lat, geo.lon, geo.timezone || 'auto', { userMessage: message });
              const place = geo.country ? `${geo.name}, ${geo.country}` : geo.name;
              // Compose a direct answer to the user's question from the
              // facts (with conversation context for follow-ups); the raw
              // report remains the fallback if composition fails.
              const composed = await composeWeatherAnswer({ question: message, place, report, history });
              cleanContent += `\n\n📍 **${place}**\n\n` + (composed || report);
              executedActions.push({ type: 'fetch_weather' });
            }
          }

        } else if (act.action === 'create_task') {
          const rawNames = Array.isArray(act.assigned_to_names)
            ? act.assigned_to_names
            : (act.assigned_to ? [act.assigned_to] : []);
          // Notification snap: if the user's chat message mentioned a
          // reminder (e.g. "20 minutes before"), parse and snap to the
          // tasks.notification enum. Mirrors bot/handlers.js.
          let notification = act.notification || null;
          if (!notification && messageMentionsReminder(message)) {
            const parsed = parseRemindersFromMessage(message);
            if (parsed.length > 0) {
              const snap = snapToTaskNotification(parsed[0]);
              if (snap && snap.value) {
                notification = snap.value;
                if (snap.snapped) {
                  console.log('[chat] Task notification snapped:', snap.requestedLabel, '->', snap.chosenLabel);
                }
              }
            }
          }
          const saved = await db.addTasks(req.householdId, [{
            title: act.title,
            assigned_to_names: rawNames,
            due_date: act.due_date || null,
            due_time: act.due_time || null,
            recurrence: act.recurrence || null,
            notification,
          }], req.user.id, members);
          const savedRow = Array.isArray(saved) && saved[0] ? saved[0] : null;
          // Rich card payload for the frontend. Same shape pattern as
          // event_created above so the renderer can switch on .type.
          executedActions.push({
            type: 'task_created',
            task: {
              id: savedRow?.id || null,
              title: act.title,
              due_date: savedRow?.due_date || act.due_date || null,
              due_time: savedRow?.due_time || act.due_time || null,
              recurrence: savedRow?.recurrence || act.recurrence || null,
              assigned_to_names: savedRow?.assigned_to_names || [],
            },
          });

        } else if (['complete_task', 'update_task', 'delete_task'].includes(act.action) && act.title) {
          // Task management from chat. Before these actions existed the
          // model could only apologise - a real household asked FIVE times
          // to remove 13 stuck to-dos (2026-08-06 transcript) and got "I
          // genuinely don't have a delete action for tasks" every time.
          // all_matching covers the bulk case ("delete all of them",
          // "move them all to Saturday").
          const taskMatches = await db.findTasksByFuzzyTitle(req.householdId, act.title, {
            assignedToName: act.assigned_to_name || null,
            limit: 25,
          });
          const verb = act.action === 'complete_task' ? 'tick off' : act.action === 'delete_task' ? 'remove' : 'change';
          if (taskMatches.length === 0) {
            cleanContent += `\n\n⚠️ I couldn't find a task matching "${act.title}", so nothing was changed.`;
          } else if (taskMatches.length > 1 && !act.all_matching) {
            const lines = taskMatches.slice(0, 5).map((t) => `• ${t.title}${t.due_date ? ` (due ${t.due_date})` : ''}`);
            cleanContent += `\n\n⚠️ I found ${taskMatches.length} tasks matching "${act.title}" - tell me which one to ${verb}, or say "all of them":\n${lines.join('\n')}`;
          } else {
            const targets = act.all_matching ? taskMatches : [taskMatches[0]];
            if (act.action === 'complete_task') {
              for (const t of targets) await db.completeTask(t.id);
              executedActions.push({ type: 'tasks_completed', count: targets.length, titles: targets.map((t) => t.title) });
            } else if (act.action === 'delete_task') {
              for (const t of targets) await db.deleteTask(t.id, req.householdId);
              executedActions.push({ type: 'tasks_deleted', count: targets.length, titles: targets.map((t) => t.title) });
            } else {
              // update_task: new_* fields carry only what changes. due_time
              // is a wall-clock TIME column (no timezone conversion - same
              // as the create path).
              const patch = {};
              if (act.new_title) patch.title = act.new_title;
              if (act.new_due_date !== undefined && act.new_due_date !== null) patch.due_date = act.new_due_date;
              if (act.new_due_time !== undefined && act.new_due_time !== null) patch.due_time = act.new_due_time;
              if (act.new_recurrence !== undefined) patch.recurrence = act.new_recurrence;
              if (Array.isArray(act.assigned_to_names)) {
                const { ids, names } = db.resolveAssignees(act.assigned_to_names, members);
                patch.assigned_to_ids = ids;
                patch.assigned_to_names = names;
              }
              if (Object.keys(patch).length === 0) {
                cleanContent += `\n\n⚠️ I couldn't work out what to change about "${targets[0].title}" - tell me the new date, time, or details.`;
              } else {
                const updatedTasks = [];
                for (const t of targets) updatedTasks.push(await db.updateTask(t.id, req.householdId, patch));
                executedActions.push({
                  type: 'tasks_updated',
                  count: targets.length,
                  tasks: updatedTasks.map((t, i) => ({
                    id: t?.id || targets[i].id,
                    title: t?.title || targets[i].title,
                    due_date: t?.due_date ?? null,
                    due_time: t?.due_time ?? null,
                    recurrence: t?.recurrence ?? null,
                    assigned_to_names: t?.assigned_to_names || [],
                  })),
                });
              }
            }
          }

        } else if (act.action === 'create_recipe') {
          // Generate and save recipe to Recipe Box
          const { generateAndSaveRecipe } = require('../bot/handlers');
          const recipe = await generateAndSaveRecipe(
            req.householdId,
            act.description,
            act.dietary || null,
            act.servings || 4
          );
          executedActions.push({ type: 'create_recipe', name: recipe.name, id: recipe.id });

        } else if (act.action === 'delete_recipe') {
          // Delete a recipe by id. The AI gets the id list via the
          // {{RECIPES}} system-prompt section, so it should always have
          // a valid id when emitting this action. We still guard
          // against bad ids by letting deleteRecipe's WHERE clause
          // scope to the calling household - a stale or wrong id just
          // results in a no-op delete, not a cross-tenant leak.
          if (!act.recipe_id) {
            console.warn('[chat] delete_recipe action missing recipe_id - dropping');
          } else {
            const target = await db.getRecipeById(act.recipe_id, req.householdId).catch(() => null);
            if (!target) {
              console.warn(`[chat] delete_recipe: recipe ${act.recipe_id} not found for household ${req.householdId}`);
            } else {
              await db.deleteRecipe(act.recipe_id, req.householdId);
              executedActions.push({ type: 'delete_recipe', name: target.name, id: act.recipe_id });
            }
          }

        } else if (act.action === 'add_meal_plan' && Array.isArray(act.meals) && act.meals.length > 0) {
          // Plan meals onto real days. Each entry needs a proper date and a
          // name; a recipe_id is linked only after verifying it belongs to
          // this household (a hallucinated or foreign id degrades to a
          // name-only entry rather than failing the meal or leaking).
          const VALID_CATEGORIES = new Set(['breakfast', 'lunch', 'snack', 'dinner']);
          const planned = [];
          for (const meal of act.meals.slice(0, 21)) {
            const date = typeof meal?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(meal.date) ? meal.date : null;
            const name = typeof meal?.meal_name === 'string' ? meal.meal_name.trim() : '';
            if (!date || !name) {
              console.warn('[chat] add_meal_plan entry missing date or meal_name - skipping', meal?.date, meal?.meal_name);
              continue;
            }
            let recipeId = null;
            if (meal.recipe_id) {
              const recipe = await db.getRecipeById(meal.recipe_id, req.householdId).catch(() => null);
              recipeId = recipe ? meal.recipe_id : null;
            }
            const category = VALID_CATEGORIES.has(String(meal.category || '').toLowerCase())
              ? String(meal.category).toLowerCase()
              : 'dinner';
            const entry = await db.createMealPlanEntry(req.householdId, {
              date, category, recipe_id: recipeId, meal_name: name,
            }, req.user.id);
            planned.push({ date, name, category, id: entry.id });
          }
          if (planned.length > 0) {
            executedActions.push({ type: 'add_meal_plan', meals: planned });
          }

        } else if (act.action === 'remove_meal_plan' && Array.isArray(act.meals) && act.meals.length > 0) {
          // Take meals off the plan ("take spag bol off Tuesday", "clear
          // Friday's meals"). Each target matches on whatever is given:
          // name fuzzily, date and category exactly. At least one of
          // name/date per target.
          const removedMeals = [];
          for (const t of act.meals.slice(0, 10)) {
            const date = typeof t?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : null;
            const name = typeof t?.meal_name === 'string' ? t.meal_name.trim() : '';
            if (!date && !name) continue;
            const entries = await db.findMealPlanEntries(req.householdId, {
              date, mealName: name || null,
              category: ['breakfast', 'lunch', 'snack', 'dinner'].includes(String(t.category || '').toLowerCase())
                ? String(t.category).toLowerCase() : null,
            });
            for (const e of entries) {
              await db.deleteMealPlanEntry(e.id, req.householdId);
              removedMeals.push({ date: e.date, name: e.meal_name, category: e.category });
            }
          }
          if (removedMeals.length === 0) {
            cleanContent += `\n\n⚠️ I couldn't find that on the meal plan, so nothing was removed.`;
          } else {
            executedActions.push({ type: 'meal_plan_removed', count: removedMeals.length, meals: removedMeals });
          }
        }
      } catch (actionErr) {
        console.error(`Action ${act.action} failed (non-fatal):`, actionErr.message);
      }
    }

    // Save both messages to DB
    await db.saveChatMessage(req.householdId, req.user.id, 'user', message.trim(), conversationId);
    // Persist the RAW reply (action blocks included) plus any appendices,
    // NOT the stripped cleanContent. History is replayed to the model on
    // every turn - storing stripped confirmations taught it that "I've
    // added X" needs no action block (it mimicked its own history), so the
    // first attempt in a long conversation claimed success without saving
    // and the truth guard had to bounce it. The /history and /conversations
    // read endpoints strip blocks for display instead.
    const historyAppendix = cleanContent.slice(strippedBase.length);
    await db.saveChatMessage(req.householdId, req.user.id, 'assistant', aiText + historyAppendix, conversationId);
    await db.touchConversation(conversationId);

    // Chat actions mutate digest data (events, tasks, shopping, meals) -
    // bust the 5-min digest cache so the dashboard reflects them on its
    // next fetch instead of serving the pre-action snapshot.
    if (executedActions.length > 0) cache.invalidate(`digest:${req.householdId}`);

    // Meter charge + decoration on the RESPONSE only - the counter lines
    // never enter saved history (they'd confuse the model on replay and
    // duplicate on every turn). App chat has no deterministic chain
    // intents - every user message is one use.
    let outboundMessage = cleanContent;
    if (assistantMeter.isMeteredHousehold(household)) {
      try {
        const charge = await assistantMeter.chargeUse(household, {
          userId: req.user.id, channel: 'chat',
        });
        if (!household.free_deal_announced_at) {
          outboundMessage = `${assistantMeter.dealAnnouncement(charge.resetLabel)}\n\n${outboundMessage}`;
          db.markFreeDealAnnounced(req.householdId).catch(() => {});
        } else if (charge.charged) {
          if (charge.used >= assistantMeter.FREE_MONTHLY_ACTIONS) {
            outboundMessage = `${outboundMessage}\n\n${assistantMeter.limitAnnouncement(charge.resetLabel, process.env.WEB_URL)}`;
            db.markMeterLimitNotice(req.householdId).catch(() => {});
          } else {
            const line = assistantMeter.counterLine(charge.used, charge.resetLabel);
            if (line) outboundMessage = `${outboundMessage}\n\n${line}`;
          }
        }
      } catch (err) {
        console.warn('[chat] meter decoration failed, sending undecorated:', err.message);
      }
    }

    return res.json({
      message: outboundMessage,
      conversation_id: conversationId,
      actions: executedActions.length > 0 ? executedActions : undefined,
    });
  } catch (err) {
    console.error('POST /api/chat error:', err);
    return res.status(500).json({ error: 'Failed to get AI response. Please try again.' });
  }
});

/**
 * POST /api/chat/image
 *
 * Upload an image or PDF for the AI to scan. Images go through the
 * vision-based extractor (scanImage); PDFs are text-extracted via
 * pdf-parse and then run through the classifier, which already knows
 * how to pull events, tasks, and shopping items out of free-form text.
 *
 * Endpoint kept under /image for backwards compatibility with the
 * existing frontend caller (and the field name is still "image" in the
 * multipart form so old clients keep working). The multer config now
 * accepts application/pdf in addition to image/*.
 */
router.post('/image', requireAuth, requireHousehold, chatAttachmentUpload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  try {
    // Resolve or create conversation
    let conversationId = req.body.conversation_id;
    if (!conversationId) {
      const conv = await db.createConversation(req.householdId, req.user.id, 'Attachment');
      conversationId = conv.id;
    }

    // ── Assistant meter (free-app mode) ──
    // A photo/PDF scan is the costliest single request, and this endpoint
    // has a dozen return paths - so the meter gates AND charges up front:
    // an exhausted household gets the limit reply, an allowed scan is
    // charged at acceptance (the burst window still merges it with the
    // conversation around it).
    if (assistantMeter.enabled()) {
      const meterHousehold = await db.getHouseholdById(req.householdId).catch(() => null);
      if (assistantMeter.isMeteredHousehold(meterHousehold)) {
        const status = await assistantMeter.meterStatus(meterHousehold);
        if (status.metered && status.exhausted) {
          const reply = assistantMeter.limitReplyFull(status.resetLabel, process.env.WEB_URL);
          db.markMeterLimitNotice(req.householdId).catch(() => {});
          return res.json({ message: reply, conversation_id: conversationId });
        }
        await assistantMeter.chargeUse(meterHousehold, { userId: req.user.id, channel: 'chat-image' });
      }
    }

    const members = await db.getHouseholdMembers(req.householdId);
    const memberNames = members.map(m => m.name);
    const aiCtx = { householdId: req.householdId, userId: req.user.id };

    // ── PDF branch ─────────────────────────────────────────────────────────
    // Extract text, then hand it to the classifier. We treat the PDF
    // content as if it were a long user message asking us to extract
    // events / tasks / shopping items. The classifier returns the same
    // shape the text-chat endpoint above already knows how to act on.
    if (req.file.mimetype === 'application/pdf') {
      // Shared document extractor: text-layer PDFs parse directly, and
      // SCANNED PDFs fall back to vision transcription instead of the old
      // "send a screenshot instead" dead end (real support complaint,
      // 2026-08-14 - a photographed school letter saved as PDF).
      let pdfText = '';
      try {
        const { extractTextFromDocument } = require('../services/document-extract');
        const extracted = await extractTextFromDocument(req.file.buffer, 'application/pdf');
        pdfText = extracted.text;
      } catch (err) {
        console.error('[chat/image] PDF extraction failed:', err.message);
        const errorMsg = `📄 ${err.message || "I couldn't read that PDF - try sending it as a photo instead."}`;
        await db.saveChatMessage(req.householdId, req.user.id, 'user', '📄 [Sent a PDF]', conversationId);
        await db.saveChatMessage(req.householdId, req.user.id, 'assistant', errorMsg, conversationId);
        await db.touchConversation(conversationId);
        return res.json({ message: errorMsg, conversation_id: conversationId });
      }

      const currentUser = members.find(m => m.id === req.user.id);
      const household = await db.getHouseholdById(req.householdId);
      const userTz = currentUser?.timezone || household?.timezone || 'Europe/London';
      const prompt = `I'm attaching the text content of a PDF document. Please extract any calendar events, tasks, or shopping items you can find in it and add them. If it's a newsletter or invitation, focus on dates and times. Here is the PDF content:\n\n${pdfText}`;

      const result = await classify(prompt, memberNames, [], {
        ...aiCtx,
        sender: currentUser?.name,
        timezone: userTz,
      });

      // Persist anything actionable + build a short summary for the chat.
      // executedActions must reach the response: the app only refreshes
      // open pages (and renders confirmation cards) when `actions` is
      // non-empty - without it a PDF upload created events the calendar
      // didn't show until a manual reload, which read as a failed save
      // (real 2026-08-14 incident: the assistant then "re-added" them,
      // making duplicates).
      const summaryLines = [];
      const executedActions = [];
      if (Array.isArray(result.tasks) && result.tasks.length > 0) {
        const toAdd = result.tasks.filter(t => t.action !== 'complete');
        if (toAdd.length > 0) {
          await db.addTasks(req.householdId, toAdd, req.user.id, members);
          summaryLines.push(`📋 Added ${toAdd.length} task${toAdd.length === 1 ? '' : 's'}: ${toAdd.map(t => t.title).join(', ')}`);
          executedActions.push({ type: 'tasks_added', count: toAdd.length });
        }
      }
      // A PDF (school letter) often carries several events — classify v2 puts
      // multiples in calendar_events; a single one stays in calendar_event.
      const pdfEvents = [
        ...(result.calendar_event ? [result.calendar_event] : []),
        ...(Array.isArray(result.calendar_events) ? result.calendar_events.filter(Boolean) : []),
      ];
      // Same dedupe as the image path: skip what synced term dates or
      // existing rows already cover (school PDFs repeat both).
      const pdfDupVerdicts = await findExtractionDuplicates(
        req.householdId,
        pdfEvents.map((e) => ({ title: e.title, date: e.date })),
      );
      const pdfSkipped = pdfDupVerdicts.filter(Boolean);
      for (const [evIndex, ev] of pdfEvents.entries()) {
        if (pdfDupVerdicts[evIndex]) continue;
        try {
          const rawNames = Array.isArray(ev.assigned_to_names) ? ev.assigned_to_names : (ev.assigned_to_name ? [ev.assigned_to_name] : []);
          const { ids: assigneeIds, names: assigneeNames } = db.resolveAssignees(rawNames, members);
          const firstAssignee = assigneeIds.length > 0 ? members.find(m => m.id === assigneeIds[0]) : null;
          const startTime = ev.all_day
            ? `${ev.date}T00:00:00Z`
            : localToUTC(ev.date, ev.start_time || '09:00', userTz);
          const endTime = ev.all_day
            ? `${ev.date}T23:59:59Z`
            : localToUTC(ev.date, ev.end_time || ev.start_time || '10:00', userTz);
          const createdPdfEvent = await db.createCalendarEvent(req.householdId, {
            title: ev.title,
            start_time: startTime,
            end_time: endTime,
            all_day: !!ev.all_day,
            assigned_to_ids: assigneeIds,
            assigned_to_names: assigneeNames,
            color: firstAssignee?.color_theme || 'lavender',
            location: ev.location || null,
            description: ev.description || null,
            recurrence: ev.recurrence || null,
          }, req.user.id);
          if (createdPdfEvent && assigneeNames.length > 0) {
            await db.saveEventAssignees(createdPdfEvent.id, req.householdId, assigneeNames, members);
          }
          summaryLines.push(`📅 Added event: ${ev.title}${ev.date ? ` on ${ev.date}` : ''}`);
          executedActions.push({
            type: 'event_created',
            event: {
              id: createdPdfEvent?.id || null,
              title: ev.title,
              start_time: startTime,
              end_time: endTime,
              all_day: !!ev.all_day,
              location: ev.location || null,
              recurrence: ev.recurrence || null,
              assigned_to_names: assigneeNames,
            },
          });
        } catch (err) {
          console.error('[chat/image] PDF event create failed:', err.message);
        }
      }

      const pdfSkipLine = skippedLine(pdfSkipped.length, pdfSkipped.includes('term_dates'));
      if (pdfSkipLine) summaryLines.push(pdfSkipLine);
      if (executedActions.length > 0) cache.invalidate(`digest:${req.householdId}`);
      const msg = summaryLines.length > 0
        ? `📄 Read your PDF.\n\n${summaryLines.join('\n')}`
        : (result.response_message || "📄 I read the PDF but didn't find anything actionable to add (no clear events, tasks, or items).");

      await db.saveChatMessage(req.householdId, req.user.id, 'user', '📄 [Sent a PDF]', conversationId);
      await db.saveChatMessage(req.householdId, req.user.id, 'assistant', msg, conversationId);
      await db.touchConversation(conversationId);
      return res.json({
        message: msg,
        conversation_id: conversationId,
        actions: executedActions.length > 0 ? executedActions : undefined,
      });
    }

    // ── Image branch (existing flow) ───────────────────────────────────────
    const scan = await scanImage(req.file.buffer, req.file.mimetype, memberNames, aiCtx);

    const currentUser = members.find(m => m.id === req.user.id);
    const household = await db.getHouseholdById(req.householdId);
    const userTz = currentUser?.timezone || household?.timezone || 'Europe/London';
    const executedActions = [];

    // ── Receipt handling ──
    if (scan.type === 'receipt') {
      const extracted = await scanReceipt(req.file.buffer, req.file.mimetype, aiCtx);

      if (extracted.items?.length) {
        const shoppingList = await db.getShoppingList(req.householdId);
        const matchResult = await matchReceiptToList(extracted.items, shoppingList, aiCtx);

        const checkedOff = [];
        for (const match of matchResult.matches || []) {
          if (match.confidence >= 0.7) {
            await db.completeShoppingItemById(match.list_item_id);
            checkedOff.push(match.list_item_name);
          }
        }

        const store = extracted.store_name ? ` from **${extracted.store_name}**` : '';
        let msg = `🧾 Receipt scanned${store}.\n\n`;
        if (checkedOff.length) {
          msg += `✅ **Checked off:** ${checkedOff.join(', ')}`;
        } else {
          msg += '✅ No shopping list items matched this receipt.';
        }
        if (matchResult.unmatched_receipt_items?.length) {
          msg += `\n\n❓ **Not on your list:** ${matchResult.unmatched_receipt_items.join(', ')}`;
        }

        executedActions.push({ type: 'receipt_scan', checked_off: checkedOff.length });
        if (checkedOff.length > 0) cache.invalidate(`digest:${req.householdId}`);

        await db.saveChatMessage(req.householdId, req.user.id, 'user', '📷 [Sent a receipt image]', conversationId);
        await db.saveChatMessage(req.householdId, req.user.id, 'assistant', msg, conversationId);
        await db.touchConversation(conversationId);

        return res.json({ message: msg, conversation_id: conversationId, actions: executedActions });
      }

      const noItemsMsg = "🧾 I couldn't find any items on that receipt. Try sending a clearer photo.";
      await db.saveChatMessage(req.householdId, req.user.id, 'user', '📷 [Sent an image]', conversationId);
      await db.saveChatMessage(req.householdId, req.user.id, 'assistant', noItemsMsg, conversationId);
      await db.touchConversation(conversationId);
      return res.json({ message: noItemsMsg, conversation_id: conversationId });
    }

    // ── Event/invitation handling ──
    if (scan.type === 'event' && scan.events?.length) {
      const created = [];
      const skippedDups = [];
      // Skip what the calendar already shows - synced term dates
      // (half term/INSET) and same-title-same-day rows (re-sent photos).
      const dupVerdicts = await findExtractionDuplicates(
        req.householdId,
        scan.events.map((e) => ({ title: e.title, date: e.date })),
      );
      for (const [evIndex, ev] of scan.events.entries()) {
        if (dupVerdicts[evIndex]) { skippedDups.push(dupVerdicts[evIndex]); continue; }
        try {
          // Image-scan output uses assigned_to_names[] in the prompt
          // schema; fall back to legacy singular for safety. Resolve to
          // parallel id/name arrays for the new event columns.
          const rawNames = Array.isArray(ev.assigned_to_names)
            ? ev.assigned_to_names
            : (ev.assigned_to_name ? [ev.assigned_to_name] : []);
          const { ids: assigneeIds, names: assigneeNames } = db.resolveAssignees(rawNames, members);
          const firstAssignee = assigneeIds.length > 0
            ? members.find(m => m.id === assigneeIds[0])
            : null;

          const startTime = ev.all_day
            ? `${ev.date}T00:00:00Z`
            : localToUTC(ev.date, ev.start_time || '09:00', userTz);
          const endTime = ev.all_day
            ? `${ev.date}T23:59:59Z`
            : localToUTC(ev.date, ev.end_time || ev.start_time || '10:00', userTz);

          const createdEvRow = await db.createCalendarEvent(req.householdId, {
            title: ev.title,
            start_time: startTime,
            end_time: endTime,
            all_day: !!ev.all_day,
            assigned_to_ids: assigneeIds,
            assigned_to_names: assigneeNames,
            color: firstAssignee?.color_theme || 'lavender',
            location: ev.location || null,
            description: ev.description || null,
            recurrence: ev.recurrence || null,
          }, req.user.id);
          // Same as the text create_event path: without event_assignees
          // rows, assignee-filtered views (kids' My Days, member colours)
          // can't see image-created events.
          if (createdEvRow && assigneeNames.length > 0) {
            await db.saveEventAssignees(createdEvRow.id, req.householdId, assigneeNames, members);
          }
          created.push(ev.recurrence ? `${ev.title} (repeats ${ev.recurrence})` : ev.title);
          // Same rich card payload as the text create_event path, so
          // image-scanned events get EVENT ADDED cards too.
          executedActions.push({
            type: 'event_created',
            event: {
              id: createdEvRow?.id || null,
              title: ev.title,
              start_time: startTime,
              end_time: endTime,
              all_day: !!ev.all_day,
              location: ev.location || null,
              recurrence: ev.recurrence || null,
              assigned_to_names: assigneeNames,
            },
          });
        } catch (err) {
          console.error(`Failed to create event "${ev.title}" from image:`, err.message);
        }
      }

      if (created.length || skippedDups.length) {
        let msg;
        if (created.length) {
          msg = `📅 **${created.length} event${created.length > 1 ? 's' : ''} added to calendar:**\n`;
          created.forEach(t => { msg += `• ${t}\n`; });
          const skipLine = skippedLine(skippedDups.length, skippedDups.includes('term_dates'));
          if (skipLine) msg += `\n${skipLine}\n`;
        } else {
          msg = `📅 ${skippedLine(skippedDups.length, skippedDups.includes('term_dates'))} Nothing new to add.\n`;
        }
        if (scan.summary) msg += `\n${scan.summary}`;
        cache.invalidate(`digest:${req.householdId}`);

        await db.saveChatMessage(req.householdId, req.user.id, 'user', '📷 [Sent an image with event details]', conversationId);
        await db.saveChatMessage(req.householdId, req.user.id, 'assistant', msg, conversationId);
        await db.touchConversation(conversationId);

        return res.json({ message: msg, conversation_id: conversationId, actions: executedActions });
      }
    }

    // ── Unknown ──
    const unknownMsg = `🤔 ${scan.summary || "I wasn't sure what to do with that image. Try sending a receipt or an event invitation."}`;
    await db.saveChatMessage(req.householdId, req.user.id, 'user', '📷 [Sent an image]', conversationId);
    await db.saveChatMessage(req.householdId, req.user.id, 'assistant', unknownMsg, conversationId);
    await db.touchConversation(conversationId);
    return res.json({ message: unknownMsg, conversation_id: conversationId });

  } catch (err) {
    console.error('POST /api/chat/image error:', err);
    return res.status(500).json({ error: 'Failed to process the attachment. Please try again.' });
  }
});

module.exports = router;
