const { Router } = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const db = require('../db/queries');
const { requireAuth, requireHousehold } = require('../middleware/auth');
const { CHAT_ASSISTANT_SYSTEM } = require('../services/prompts');
const { formatPreferenceLines } = require('../services/preferences-format');
const { scanImage, scanReceipt, matchReceiptToList, classify } = require('../services/ai');
const { callWithFailover } = require('../services/ai-client');
const { getWeatherReport, getCityFromTimezone, extractLocationFromMessage, geocodeLocation, reverseGeocode } = require('../services/weather');
const { messageMentionsLocation } = require('../utils/location-relevance');
const { summariseSchoolTermDates } = require('../utils/school-term-summary');
const { parseRemindersFromMessage, messageMentionsReminder, snapToTaskNotification } = require('../utils/reminder-parser');
const { transcribeVoice } = require('../services/transcribe');
const cache = require('../services/cache');

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

/**
 * Build the system prompt with family context injected.
 */
async function buildSystemPrompt(householdId, householdName, userId, currentMessage = '', deviceCoords = null) {
  const today = new Date().toISOString().split('T')[0];
  const twoWeeks = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];

  const [members, notes, shopping, tasks, events, household, schools, recipes, rawPreferences] = await Promise.all([
    db.getHouseholdMembers(householdId),
    db.getHouseholdNotes(householdId),
    db.getShoppingList(householdId),
    db.getAllIncompleteTasks(householdId),
    db.getCalendarEvents(householdId, today, twoWeeks),
    db.getHouseholdById(householdId),
    db.getHouseholdSchools(householdId),
    db.getRecipes(householdId).catch(() => []),
    db.getHouseholdPreferences(householdId).catch(() => []),
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

  let prompt = CHAT_ASSISTANT_SYSTEM
    .replace(/{{HOUSEHOLD_NAME}}/g, householdName || 'your')
    .replace(/{{DATE}}/g, today)
    .replace(/{{TIMEZONE}}/g, userTz)
    .replace(/{{LOCATION}}/g, locationStr)
    .replace(/{{MEMBERS}}/g, membersStr)
    .replace(/{{SHOPPING_LIST}}/g, shoppingStr)
    .replace(/{{TASKS}}/g, tasksStr)
    .replace(/{{EVENTS}}/g, eventsStr)
    .replace(/{{SCHOOLS}}/g, schoolsStr)
    .replace(/{{NOTES}}/g, notesStr)
    .replace(/{{PREFERENCES}}/g, preferencesStr)
    .replace(/{{RECIPES}}/g, recipesStr);

  if (allergiesStr) {
    prompt += `\n\nHOUSEHOLD ALLERGIES & DIETARY REQUIREMENTS: ${allergiesStr}\nALWAYS avoid these allergens/restrictions when suggesting recipes, meals, or food-related advice.`;
  }

  return prompt;
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
  const fenceOpen = /```[a-zA-Z]*\s*\n?\s*(?=\{)/g;
  let m;
  while ((m = fenceOpen.exec(content)) !== null) {
    const jsonText = balancedJson(content, m.index + m[0].length);
    if (!jsonText) continue;
    try {
      const parsed = JSON.parse(jsonText);
      if (take(parsed)) {
        // Strip the whole fence (opening tag + JSON + closing backticks if present).
        const closeAt = content.indexOf('```', m.index + m[0].length + jsonText.length);
        const fullBlock = content.slice(m.index, closeAt >= 0 ? closeAt + 3 : m.index + m[0].length + jsonText.length);
        cleanContent = cleanContent.replace(fullBlock, '');
      }
    } catch { /* skip malformed JSON */ }
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
    // Get last message preview for each conversation
    const withPreviews = await Promise.all(conversations.map(async (conv) => {
      const msgs = await db.getChatHistory(conv.id, 1, req.householdId);
      return { ...conv, lastMessage: msgs[0]?.content?.substring(0, 80) || null };
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
      return res.json({ messages });
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
    const systemPrompt = await buildSystemPrompt(req.householdId, household?.name, req.user.id, message, deviceCoords);

    // Get recent conversation history for context
    const history = await db.getChatHistory(conversationId, 30, req.householdId);

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
    });
    if (provider !== 'claude') {
      console.log(`[chat] Response served by ${provider}`);
    }

    // Extract and process all actions
    let { cleanContent, actions } = extractActions(aiText);

    // Truth guard (real failure: "Okay, I've added Mason's tennis lesson…"
    // with NO action block, so nothing was saved and the user only found out
    // days later). If the prose claims a save/add/create but zero action
    // blocks parsed, correct the reply instead of letting the claim stand.
    if (actions.length === 0 && /\bI(?:'|’)?ve (?:added|created|scheduled|saved|set up|updated|removed|deleted)\b|\bI (?:added|created|scheduled|saved)\b/i.test(cleanContent)) {
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

        } else if (act.action === 'add_shopping' && act.items?.length) {
          // shopping_items.list_id is NOT NULL since multi-list support
          // landed - attach the default list + aisle_category before
          // insert, matching the classify.js / shopping.js pattern.
          const defaultList = await db.getDefaultShoppingList(req.householdId);
          const enriched = act.items.map((i) => ({
            ...i,
            list_id: defaultList.id,
            aisle_category: i.aisle_category || i.category || 'Other',
          }));
          const { detectOverrideHint } = require('../utils/shoppingDedupe');
          const overrideHint = detectOverrideHint(message || '');
          await db.addShoppingItemsWithDedupe(req.householdId, enriched, req.user.id, { overrideHint });
          executedActions.push({ type: 'add_shopping', count: act.items.length });

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
              cleanContent += `\n\n📍 **${place}**\n\n` + report;
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
        }
      } catch (actionErr) {
        console.error(`Action ${act.action} failed (non-fatal):`, actionErr.message);
      }
    }

    // Save both messages to DB
    await db.saveChatMessage(req.householdId, req.user.id, 'user', message.trim(), conversationId);
    await db.saveChatMessage(req.householdId, req.user.id, 'assistant', cleanContent, conversationId);
    await db.touchConversation(conversationId);

    // Chat actions mutate digest data (events, tasks, shopping, meals) -
    // bust the 5-min digest cache so the dashboard reflects them on its
    // next fetch instead of serving the pre-action snapshot.
    if (executedActions.length > 0) cache.invalidate(`digest:${req.householdId}`);

    return res.json({
      message: cleanContent,
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

    const members = await db.getHouseholdMembers(req.householdId);
    const memberNames = members.map(m => m.name);
    const aiCtx = { householdId: req.householdId, userId: req.user.id };

    // ── PDF branch ─────────────────────────────────────────────────────────
    // Extract text, then hand it to the classifier. We treat the PDF
    // content as if it were a long user message asking us to extract
    // events / tasks / shopping items. The classifier returns the same
    // shape the text-chat endpoint above already knows how to act on.
    if (req.file.mimetype === 'application/pdf') {
      let pdfText = '';
      try {
        const parsed = await pdfParse(req.file.buffer);
        pdfText = (parsed.text || '').trim();
      } catch (err) {
        console.error('[chat/image] pdfParse failed:', err.message);
        const errorMsg = "📄 I couldn't read that PDF. The file might be scanned or password-protected — try saving it as a normal PDF (File → Save As → PDF) and re-attaching.";
        await db.saveChatMessage(req.householdId, req.user.id, 'user', '📄 [Sent a PDF]', conversationId);
        await db.saveChatMessage(req.householdId, req.user.id, 'assistant', errorMsg, conversationId);
        await db.touchConversation(conversationId);
        return res.json({ message: errorMsg, conversation_id: conversationId });
      }
      if (!pdfText) {
        const emptyMsg = "📄 That PDF didn't have any readable text. If it's a scanned document, try opening it on your phone and using the camera to scan it as a photo instead — I can read images directly.";
        await db.saveChatMessage(req.householdId, req.user.id, 'user', '📄 [Sent a PDF]', conversationId);
        await db.saveChatMessage(req.householdId, req.user.id, 'assistant', emptyMsg, conversationId);
        await db.touchConversation(conversationId);
        return res.json({ message: emptyMsg, conversation_id: conversationId });
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
      const summaryLines = [];
      if (Array.isArray(result.tasks) && result.tasks.length > 0) {
        const toAdd = result.tasks.filter(t => t.action !== 'complete');
        if (toAdd.length > 0) {
          await db.addTasks(req.householdId, toAdd, req.user.id, members);
          summaryLines.push(`📋 Added ${toAdd.length} task${toAdd.length === 1 ? '' : 's'}: ${toAdd.map(t => t.title).join(', ')}`);
        }
      }
      if (result.calendar_event) {
        try {
          const ev = result.calendar_event;
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
        } catch (err) {
          console.error('[chat/image] PDF event create failed:', err.message);
        }
      }

      if (summaryLines.length > 0) cache.invalidate(`digest:${req.householdId}`);
      const msg = summaryLines.length > 0
        ? `📄 Read your PDF.\n\n${summaryLines.join('\n')}`
        : (result.response_message || "📄 I read the PDF but didn't find anything actionable to add (no clear events, tasks, or items).");

      await db.saveChatMessage(req.householdId, req.user.id, 'user', '📄 [Sent a PDF]', conversationId);
      await db.saveChatMessage(req.householdId, req.user.id, 'assistant', msg, conversationId);
      await db.touchConversation(conversationId);
      return res.json({ message: msg, conversation_id: conversationId });
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
      for (const ev of scan.events) {
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
        } catch (err) {
          console.error(`Failed to create event "${ev.title}" from image:`, err.message);
        }
      }

      if (created.length) {
        let msg = `📅 **${created.length} event${created.length > 1 ? 's' : ''} added to calendar:**\n`;
        created.forEach(t => { msg += `• ${t}\n`; });
        if (scan.summary) msg += `\n${scan.summary}`;
        executedActions.push({ type: 'create_events', count: created.length });
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
