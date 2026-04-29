const { Router } = require('express');
const multer = require('multer');
const db = require('../db/queries');
const { requireAuth, requireHousehold } = require('../middleware/auth');
const { CHAT_ASSISTANT_SYSTEM } = require('../services/prompts');
const { scanImage, scanReceipt, matchReceiptToList } = require('../services/ai');
const { callWithFailover } = require('../services/ai-client');
const { getWeatherReport, getCoordsFromTimezone, getCityFromTimezone } = require('../services/weather');

// Multer config for chat image uploads (10 MB, images only)
const chatImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are accepted'));
    }
    cb(null, true);
  },
});

const router = Router();

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
async function buildSystemPrompt(householdId, householdName, userId) {
  const today = new Date().toISOString().split('T')[0];
  const twoWeeks = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];

  const [members, notes, shopping, tasks, events, household, schools] = await Promise.all([
    db.getHouseholdMembers(householdId),
    db.getHouseholdNotes(householdId),
    db.getShoppingList(householdId),
    db.getAllIncompleteTasks(householdId),
    db.getCalendarEvents(householdId, today, twoWeeks),
    db.getHouseholdById(householdId),
    db.getHouseholdSchools(householdId),
  ]);

  const currentUser = members.find(m => m.id === userId);
  const userTz = currentUser?.timezone || household?.timezone || 'Europe/London';
  const userCity = getCityFromTimezone(userTz);
  const locationStr = userCity
    ? `The family is based in **${userCity}**. Use this for local recommendations — suggest specific places, neighbourhoods, and services in this area.`
    : '';

  const membersStr = members.map(m => `${m.name}${m.family_role ? ` (${m.family_role})` : ''}`).join(', ') || 'none';
  const householdAllergies = (() => { try { return JSON.parse(household?.allergies || '[]'); } catch { return []; } })();
  const allergiesStr = householdAllergies.length > 0 ? householdAllergies.join(', ') : null;
  const notesStr = notes.length > 0
    ? notes.map(n => `- ${n.key}: ${n.value}`).join('\n')
    : '(none saved yet)';
  const shoppingStr = shopping.filter(i => !i.completed).length > 0
    ? shopping.filter(i => !i.completed).map(i => `- ${i.item}${i.category ? ` [${i.category}]` : ''}`).join('\n')
    : '(empty)';
  const tasksStr = tasks.length > 0
    ? tasks.map(t => `- ${t.title}${t.assigned_to_name ? ` (${t.assigned_to_name})` : ''}${t.due_date ? ` due ${t.due_date}` : ''}`).join('\n')
    : '(none)';
  const eventsStr = events.length > 0
    ? events.map(e => `- ${e.title} on ${e.start_time?.split('T')[0] || 'TBD'}${e.assigned_to_name ? ` (${e.assigned_to_name})` : ''}`).join('\n')
    : '(none)';

  // Build school context
  let schoolsStr = '(none)';
  if (schools.length > 0) {
    const schoolLines = [];
    for (const school of schools) {
      const children = members.filter(m => m.school_id === school.id);
      if (children.length > 0) {
        const childNames = children.map(c => `${c.name} (${c.year_group || 'no year group'})`).join(', ');
        schoolLines.push(`${school.school_name}: ${childNames}`);
      }
    }
    if (schoolLines.length > 0) schoolsStr = schoolLines.join('\n');
  }

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
    .replace(/{{NOTES}}/g, notesStr);

  if (allergiesStr) {
    prompt += `\n\nHOUSEHOLD ALLERGIES & DIETARY REQUIREMENTS: ${allergiesStr}\nALWAYS avoid these allergens/restrictions when suggesting recipes, meals, or food-related advice.`;
  }

  return prompt;
}

/**
 * Extract all action JSON blocks from assistant response.
 * Returns { cleanContent, actions[] } where actions may be empty.
 */
function extractActions(content) {
  const actions = [];
  let cleanContent = content;

  // 1. Extract fenced ```json ... ``` blocks
  const fencedRegex = /```json\s*\n?\s*(\{[\s\S]*?\})\s*\n?\s*```/g;
  let m;
  while ((m = fencedRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed.action) {
        actions.push(parsed);
      } else if (parsed.note_action) {
        if (parsed.note_action === 'save') actions.push({ action: 'save_note', key: parsed.key, value: parsed.value });
        else if (parsed.note_action === 'delete') actions.push({ action: 'delete_note', key: parsed.key });
      }
      cleanContent = cleanContent.replace(m[0], '');
    } catch {
      // Skip malformed JSON
    }
  }

  // 2. Extract bare inline {"action": ...} objects (not in fences)
  const bareRegex = /\s*(\{"action"\s*:\s*"[^"]*"[^}]*\})/g;
  while ((m = bareRegex.exec(cleanContent)) !== null) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed.action) {
        actions.push(parsed);
        cleanContent = cleanContent.replace(m[0], '');
      }
    } catch {
      // Skip malformed JSON
    }
  }

  return { cleanContent: cleanContent.trim(), actions };
}

// List conversations
router.get('/conversations', requireAuth, requireHousehold, async (req, res) => {
  try {
    const conversations = await db.getConversations(req.user.id);
    // Get last message preview for each conversation
    const withPreviews = await Promise.all(conversations.map(async (conv) => {
      const msgs = await db.getChatHistory(conv.id, 1);
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
      const messages = await db.getChatHistory(conversation_id, 50);
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
    await db.clearChatHistory(conversation_id);
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
  const { message, conversation_id } = req.body;

  if (!message?.trim()) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  try {
    // Resolve or create conversation
    let conversationId = conversation_id;
    if (!conversationId) {
      const conv = await db.createConversation(req.householdId, req.user.id, message.substring(0, 50));
      conversationId = conv.id;
    }

    // Build context-rich system prompt
    const household = await db.getHouseholdById(req.householdId);
    const systemPrompt = await buildSystemPrompt(req.householdId, household?.name, req.user.id);

    // Get recent conversation history for context
    const history = await db.getChatHistory(conversationId, 30);

    // Build messages array
    const messages = [
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message.trim() },
    ];

    // Call AI (Claude primary, GPT-4o fallback)
    const { text: aiText, provider } = await callWithFailover({
      system: systemPrompt,
      messages,
      feature: 'chat',
      householdId: req.householdId,
      userId: req.user.id,
    });
    if (provider !== 'claude') {
      console.log(`[chat] Response served by ${provider}`);
    }

    // Extract and process all actions
    let { cleanContent, actions } = extractActions(aiText);
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
          const assignee = act.assigned_to ? members.find(m => m.name.toLowerCase() === act.assigned_to.toLowerCase()) : null;
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
            assigned_to: assignee?.id || null,
            assigned_to_name: assignee?.name || null,
            color: assignee?.color_theme || 'lavender',
            location: act.location || null,
            description: act.description || null,
          }, req.user.id);
          executedActions.push({ type: 'create_event', title: act.title });

        } else if (act.action === 'add_shopping' && act.items?.length) {
          // shopping_items.list_id is NOT NULL since multi-list support
          // landed — attach the default list + aisle_category before
          // insert, matching the classify.js / shopping.js pattern.
          const defaultList = await db.getDefaultShoppingList(req.householdId);
          const enriched = act.items.map((i) => ({
            ...i,
            list_id: defaultList.id,
            aisle_category: i.aisle_category || i.category || 'Other',
          }));
          await db.addShoppingItems(req.householdId, enriched, req.user.id);
          executedActions.push({ type: 'add_shopping', count: act.items.length });

        } else if (act.action === 'fetch_weather') {
          let lat = currentUser?.latitude;
          let lon = currentUser?.longitude;
          // Fallback: derive coordinates from timezone if no GPS
          if (!lat || !lon) {
            const tzCoords = getCoordsFromTimezone(userTz);
            if (tzCoords) {
              [lat, lon] = tzCoords;
            }
          }
          if (lat && lon) {
            const report = await getWeatherReport(lat, lon, userTz, { userMessage: message });
            cleanContent += '\n\n' + report;
            executedActions.push({ type: 'fetch_weather' });
          } else {
            cleanContent += "\n\n📍 I couldn't determine your location. Try opening the app in your browser to sync your timezone, then ask me again!";
          }

        } else if (act.action === 'create_task') {
          await db.addTasks(req.householdId, [{
            title: act.title,
            assigned_to_name: act.assigned_to || null,
            due_date: act.due_date || null,
          }], req.user.id, members);
          executedActions.push({ type: 'create_task', title: act.title });

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
        }
      } catch (actionErr) {
        console.error(`Action ${act.action} failed (non-fatal):`, actionErr.message);
      }
    }

    // Save both messages to DB
    await db.saveChatMessage(req.householdId, req.user.id, 'user', message.trim(), conversationId);
    await db.saveChatMessage(req.householdId, req.user.id, 'assistant', cleanContent, conversationId);
    await db.touchConversation(conversationId);

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
 * Upload an image for the AI to scan (receipts, invitations, flight confirmations, etc.)
 */
router.post('/image', requireAuth, requireHousehold, chatImageUpload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded.' });
  }

  try {
    // Resolve or create conversation
    let conversationId = req.body.conversation_id;
    if (!conversationId) {
      const conv = await db.createConversation(req.householdId, req.user.id, 'Image scan');
      conversationId = conv.id;
    }

    const members = await db.getHouseholdMembers(req.householdId);
    const memberNames = members.map(m => m.name);
    const aiCtx = { householdId: req.householdId, userId: req.user.id };
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
          const assignee = ev.assigned_to_name
            ? members.find(m => m.name.toLowerCase() === ev.assigned_to_name.toLowerCase())
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
            assigned_to: assignee?.id || null,
            assigned_to_name: assignee?.name || null,
            color: assignee?.color_theme || 'lavender',
            location: ev.location || null,
            description: ev.description || null,
          }, req.user.id);
          created.push(ev.title);
        } catch (err) {
          console.error(`Failed to create event "${ev.title}" from image:`, err.message);
        }
      }

      if (created.length) {
        let msg = `📅 **${created.length} event${created.length > 1 ? 's' : ''} added to calendar:**\n`;
        created.forEach(t => { msg += `• ${t}\n`; });
        if (scan.summary) msg += `\n${scan.summary}`;
        executedActions.push({ type: 'create_events', count: created.length });

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
    return res.status(500).json({ error: 'Failed to process image. Please try again.' });
  }
});

module.exports = router;
