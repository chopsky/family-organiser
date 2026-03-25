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
const { getWeatherReport, getCoordsFromTimezone } = require('../services/weather');
const { callWithFailover } = require('../services/ai-client');

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
async function handleTextMessage(text, user, household) {
  const memberNames = household.members.map((m) => m.name);

  // Fetch saved notes for context
  const notes = await db.getHouseholdNotes(household.id);
  const result = await classify(text, memberNames, notes, { householdId: household.id, userId: user.id });

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
    const taskResponse = await handleTasks(user, household);
    return { response: taskResponse, actions };
  }

  // Handle weather request
  if (result.intent === 'weather') {
    try {
      // Get user's geolocation from profile
      const fullUser = household.members.find(m => m.id === user.id);
      let lat = fullUser?.latitude;
      let lon = fullUser?.longitude;
      const tz = fullUser?.timezone || household.timezone || 'Europe/London';
      // Fallback: derive coordinates from timezone if no GPS
      if (!lat || !lon) {
        const tzCoords = getCoordsFromTimezone(tz);
        if (tzCoords) {
          [lat, lon] = tzCoords;
        }
      }
      if (!lat || !lon) {
        return { response: "I couldn't determine your location. Please open the Anora app in your browser to sync your timezone, then ask me again! 📍", actions };
      }
      const report = await getWeatherReport(lat, lon, tz);
      return { response: report, actions };
    } catch (err) {
      console.error('Weather fetch failed:', err.message);
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

  // Handle calendar event creation
  if (result.intent === 'create_event' && result.calendar_event) {
    try {
      const ev = result.calendar_event;
      const assignee = ev.assigned_to_name
        ? household.members.find(m => m.name.toLowerCase() === ev.assigned_to_name.toLowerCase())
        : null;

      const userTz = user.timezone || household.timezone || 'Europe/London';
      const startTime = ev.all_day
        ? `${ev.date}T00:00:00Z`
        : localToUTC(ev.date, ev.start_time || '09:00', userTz);
      const endTime = ev.all_day
        ? `${ev.date}T23:59:59Z`
        : localToUTC(ev.date, ev.end_time || ev.start_time || '10:00', userTz);

      await db.createCalendarEvent(household.id, {
        title: ev.title,
        start_time: startTime,
        end_time: endTime,
        all_day: !!ev.all_day,
        assigned_to: assignee?.id || null,
        assigned_to_name: assignee?.name || ev.assigned_to_name || null,
        color: assignee?.color_theme || 'lavender',
        location: ev.location || null,
        description: ev.description || null,
      }, user.id);

      actions.eventsAdded = [ev.title];
    } catch (eventErr) {
      console.error('Calendar event creation failed:', eventErr.message);
      return { response: `⚠️ I understood the event but couldn't save it: ${eventErr.message}`, actions };
    }
    return { response: result.response_message || '📅 Event added! ✅', actions };
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
      const assignee = ev.assigned_to_name
        ? household.members.find(m => m.name.toLowerCase() === ev.assigned_to_name.toLowerCase())
        : null;

      const userTz = user.timezone || household.timezone || 'Europe/London';
      const startTime = ev.all_day ? `${ev.date}T00:00:00Z` : localToUTC(ev.date, ev.start_time || '09:00', userTz);
      const endTime = ev.all_day ? `${ev.date}T23:59:59Z` : localToUTC(ev.date, ev.end_time || ev.start_time || '10:00', userTz);

      await db.createCalendarEvent(household.id, {
        title: ev.title,
        start_time: startTime,
        end_time: endTime,
        all_day: !!ev.all_day,
        assigned_to: assignee?.id || null,
        assigned_to_name: assignee?.name || ev.assigned_to_name || null,
        color: assignee?.color_theme || 'sky',
        location: ev.location || null,
        description: ev.description || null,
        category: 'school',
      }, user.id);
    } catch (err) {
      console.error('School event creation failed:', err.message);
      return { response: `⚠️ I understood the event but couldn't save it: ${err.message}`, actions };
    }
    return { response: result.response_message || '🏫 School event added! ✅', actions };
  }

  // Handle recipe request — generate, save to Recipe Box, format nicely
  if (result.intent === 'recipe' && result.recipe_request) {
    try {
      const req = result.recipe_request;
      const recipe = await generateAndSaveRecipe(household.id, req.description, req.dietary, req.servings);
      const response = formatRecipeResponse(recipe);
      return { response, actions };
    } catch (err) {
      console.error('Recipe generation failed:', err.message);
      // Fall back to chat response
      return { response: result.response_message || "Sorry, I couldn't create that recipe right now. Try again in a moment!", actions };
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
      // Add ingredients to shopping list
      const ingredientItems = recipe.ingredients
        .filter(ing => ing.name && !ing.optional)
        .map(ing => ({
          item: ing.quantity && ing.unit
            ? `${ing.quantity}${ing.unit} ${ing.name}`
            : ing.quantity
              ? `${ing.quantity} ${ing.name}`
              : ing.name,
          category: 'groceries',
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
      await db.addShoppingItems(household.id, toAdd, user.id);
      actions.shoppingAdded = toAdd.map((i) => i.item);
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
      await db.addTasks(household.id, toAdd, user.id, household.members);
      actions.tasksAdded = toAdd.map((t) => t.title);
    }
    for (const t of toComplete) {
      const done = await db.completeTasksByName(household.id, [t.title], t.assigned_to_name);
      actions.tasksCompleted.push(t.title);
      for (const completedTask of done) {
        if (completedTask.recurrence) await db.generateNextRecurrence(completedTask);
      }
    }
  }

  return {
    response: result.response_message || 'Done! ✅',
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
  const scan = await scanImage(imageBuffer, mimeType, memberNames);

  // ── Receipt handling ──
  if (scan.type === 'receipt') {
    const extracted = await scanReceipt(imageBuffer, mimeType);

    if (!extracted.items?.length) {
      return {
        response: "🧾 I couldn't find any items on that receipt. Is this a grocery receipt? Try sending a clearer photo.",
        actions: noActions,
      };
    }

    const shoppingList = await db.getShoppingList(household.id);
    const matchResult = await matchReceiptToList(extracted.items, shoppingList);

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
        const assignee = ev.assigned_to_name
          ? members.find(m => m.name.toLowerCase() === ev.assigned_to_name.toLowerCase())
          : null;

        const startTime = ev.all_day
          ? `${ev.date}T00:00:00Z`
          : localToUTC(ev.date, ev.start_time || '09:00', userTz);
        const endTime = ev.all_day
          ? `${ev.date}T23:59:59Z`
          : localToUTC(ev.date, ev.end_time || ev.start_time || '10:00', userTz);

        await db.createCalendarEvent(household.id, {
          title: ev.title,
          start_time: startTime,
          end_time: endTime,
          all_day: !!ev.all_day,
          assigned_to: assignee?.id || null,
          assigned_to_name: assignee?.name || null,
          color: assignee?.color_theme || 'lavender',
          location: ev.location || null,
          description: ev.description || null,
        }, user.id);

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
  "category": "breakfast|lunch|dinner|snack",
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
