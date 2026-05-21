const { Router } = require('express');
const db = require('../db/queries');
const { classify } = require('../services/ai');
const { callWithFailover, LONG_TIMEOUT_MS } = require('../services/ai-client');
const { getWeatherReport, extractLocationFromMessage, geocodeLocation } = require('../services/weather');
const { requireAuth, requireHousehold } = require('../middleware/auth');
const { summariseSchoolTermDates } = require('../utils/school-term-summary');
const { parseRemindersFromMessage, messageMentionsReminder, snapToTaskNotification } = require('../utils/reminder-parser');

const router = Router();

/**
 * Strip JSON action blocks (```json...```) from AI response text
 * so they don't leak into the user-visible message.
 */
function stripActionBlocks(text) {
  if (!text) return text;
  // Remove fenced JSON blocks
  let cleaned = text.replace(/```json\s*\{[^`]*?\}\s*```/gs, '').trim();
  // Remove any JSON action objects (on their own line or inline)
  cleaned = cleaned.replace(/\s*\{"action"\s*:.*?\}/g, '').trim();
  // Collapse multiple blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned;
}

/**
 * POST /api/classify
 * Send text to AI, save resulting items/tasks, return the full result.
 *
 * Body: { text: string }
 * Returns: { result, saved: { shopping, tasks } }
 */
router.post('/', requireAuth, requireHousehold, async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) {
    return res.status(400).json({ error: '"text" is required' });
  }

  try {
    const members = await db.getHouseholdMembers(req.householdId);
    const memberNames = members.map((m) => m.name);

    // Fetch notes and upcoming calendar events for context
    const notes = await db.getHouseholdNotes(req.householdId).catch(() => []);
    const now = new Date();
    const futureDate = new Date(now);
    futureDate.setDate(futureDate.getDate() + 365);
    const calendarEvents = await db.getCalendarEvents(
      req.householdId,
      now.toISOString(),
      futureDate.toISOString(),
      { userId: req.user.id }
    ).catch(() => []);
    // Open tasks give the classifier the context to treat "Elementor paid"
    // as a completion of an existing task instead of creating a new one.
    const openTasks = await db.getAllIncompleteTasks(req.householdId).catch(() => []);

    const currentUser = members.find(m => m.id === req.user.id);
    const userTz = currentUser?.timezone || 'Europe/London';
    // Pull household record (for address) + school term dates so the AI
    // can answer location-aware AND school-term-aware questions from
    // real household data instead of training-set guesses. Each fetch
    // is wrapped in try/await to tolerate unmocked db functions in
    // tests (and any genuine DB hiccups in prod - these are
    // nice-to-have context, not blockers).
    let householdRow = null;
    try { householdRow = await db.getHouseholdById(req.householdId); } catch {}
    let householdSchools = [];
    try { householdSchools = (await db.getHouseholdSchools(req.householdId)) || []; } catch {}
    let termDates = [];
    if (householdSchools.length) {
      try { termDates = (await db.getTermDatesBySchoolIds(householdSchools.map((s) => s.id))) || []; } catch {}
    }
    const schoolTermDates = summariseSchoolTermDates(householdSchools, termDates);
    const result = await classify(text.trim(), memberNames, notes, { householdId: req.householdId, userId: req.user.id, sender: currentUser?.name || req.user.name, calendarEvents, tasks: openTasks, timezone: userTz, address: householdRow?.address, schoolTermDates });

    // Strip any leaked JSON action blocks from the response message
    if (result.response_message) {
      result.response_message = stripActionBlocks(result.response_message);
    }

    // Handle weather intent - fetch weather before responding.
    // Explicit-location only - see the equivalent block in bot/handlers.js
    // for why we don't fall back to stored user location anymore.
    if (result.intent === 'weather') {
      try {
        const locationName = extractLocationFromMessage(text);
        if (!locationName) {
          result.response_message = "I can't tell where you are - Housemait doesn't track your location. Try asking with a city, e.g. _\"weather in Brighton tomorrow\"_. 📍";
        } else {
          const geo = await geocodeLocation(locationName);
          if (!geo) {
            result.response_message = `I couldn't find _"${locationName}"_ on the map. Try the full city + country, e.g. _"weather in Cape Town, South Africa"_. 🗺️`;
          } else {
            const weatherReport = await getWeatherReport(geo.lat, geo.lon, geo.timezone || 'auto', { userMessage: text });
            result.response_message = `📍 **${geo.name}, ${geo.country}**\n\n` + weatherReport;
          }
        }
      } catch (err) {
        console.error('Weather fetch failed:', err.message);
        result.response_message = "Sorry, I couldn't fetch the weather right now. Please try again in a moment. 🌤️";
      }
      return res.json({ result });
    }

    // Send the AI response immediately - don't wait for DB saves
    res.json({ result });

    // Fire-and-forget: save items to DB in the background
    (async () => {
      try {
        const ops = [];

        // Shopping items
        if (result.shopping_items?.length) {
          const toAdd    = result.shopping_items.filter((i) => i.action === 'add');
          const toRemove = result.shopping_items.filter((i) => i.action === 'remove');
          if (toAdd.length) {
            // Get Default list for this household
            const defaultList = await db.getDefaultShoppingList(req.householdId);
            const enriched = toAdd.map(i => ({
              ...i,
              list_id: defaultList.id,
              aisle_category: i.category || 'Other',
            }));
            // Use deduped insert. classify is called from the in-app text bar;
            // detect override hint from the same text the AI just classified.
            const { detectOverrideHint } = require('../utils/shoppingDedupe');
            const overrideHint = detectOverrideHint(req.body.text || '');
            ops.push(db.addShoppingItemsWithDedupe(
              req.householdId, enriched, req.user.id, { overrideHint },
            ).then(r => [...r.created, ...r.updated]));
          }
          if (toRemove.length) ops.push(db.completeShoppingItemsByName(req.householdId, toRemove.map((i) => i.item)));
        }

        // Tasks (adds run in parallel, completes need sequential for recurrence)
        if (result.tasks?.length) {
          const toAdd      = result.tasks.filter((t) => t.action === 'add');
          const toComplete = result.tasks.filter((t) => t.action === 'complete');
          // Deterministic notification fallback: if the user's text
          // mentions a reminder, parse the offset and snap to the
          // tasks.notification enum. Mirrors bot/handlers.js.
          if (toAdd.length && messageMentionsReminder(text)) {
            const parsed = parseRemindersFromMessage(text);
            if (parsed.length > 0) {
              const snap = snapToTaskNotification(parsed[0]);
              if (snap && snap.value) {
                for (const t of toAdd) {
                  if (!t.notification) t.notification = snap.value;
                }
                if (snap.snapped) {
                  console.log('[classify] Task notification snapped:', snap.requestedLabel, '->', snap.chosenLabel);
                }
              }
            }
          }
          if (toAdd.length) ops.push(db.addTasks(req.householdId, toAdd, req.user.id, members));
          if (toComplete.length) {
            ops.push((async () => {
              for (const t of toComplete) {
                const completionAssignee = Array.isArray(t.assigned_to_names) && t.assigned_to_names.length > 0
                  ? t.assigned_to_names[0]
                  : t.assigned_to_name;
                const done = await db.completeTasksByName(req.householdId, [t.title], completionAssignee);
                for (const completedTask of done) {
                  if (completedTask.recurrence) await db.generateNextRecurrence(completedTask);
                }
              }
            })());
          }
        }

        // Calendar events. Deliberately NOT gated on intent === 'create_event'
        // so the classifier can emit a calendar_event alongside a task
        // completion (e.g. "Booked car service for Wednesday morning" →
        // complete task + add event in the same turn).
        if (result.calendar_event) {
          const ev = result.calendar_event;
          const eventData = {
            title: ev.title,
            start_time: ev.all_day
              ? `${ev.date}T00:00:00Z`
              : `${ev.date}T${ev.start_time || '00:00'}:00Z`,
            end_time: ev.all_day
              ? `${ev.date}T23:59:59Z`
              : ev.end_time ? `${ev.date}T${ev.end_time}:00Z` : null,
            all_day: ev.all_day || false,
            description: ev.description || null,
            location: ev.location || null,
            category: ev.category || 'general',
            recurrence: ev.recurrence || null,
          };
          // Resolve every name the classifier emitted into parallel
          // id/name arrays. Names not in the household are silently
          // dropped by resolveAssignees.
          const rawNames = ev.assigned_to_names || (ev.assigned_to_name ? [ev.assigned_to_name] : []);
          const { ids: assigneeIds, names: assigneeNames } = db.resolveAssignees(rawNames, members);
          eventData.assigned_to_ids = assigneeIds;
          eventData.assigned_to_names = assigneeNames;
          ops.push((async () => {
            const created = await db.createCalendarEvent(req.householdId, eventData, req.user.id);
            if (created && assigneeNames.length > 0) {
              await db.saveEventAssignees(created.id, req.householdId, assigneeNames, members);
            }
            // Reminders only when the user explicitly asked. The classifier
            // prompt leaves ev.reminders null otherwise. Deterministic
            // fallback: if the LLM forgot to populate reminders but the
            // user's raw message has an unambiguous reminder phrase
            // ("remind me 10 min before"), parse it server-side. Same
            // structural backstop as bot/handlers.js.
            let remindersToSave = Array.isArray(ev.reminders) ? ev.reminders.filter(Boolean) : [];
            if (remindersToSave.length === 0 && messageMentionsReminder(text)) {
              const parsed = parseRemindersFromMessage(text);
              if (parsed.length > 0) {
                remindersToSave = parsed;
                console.log('[classify] Reminder fallback parsed', JSON.stringify(parsed), 'from user text');
              }
            }
            if (created && remindersToSave.length > 0) {
              try {
                await db.saveEventReminders(created.id, req.householdId, remindersToSave, created.start_time);
              } catch (err) {
                console.error('[classify] saveEventReminders failed:', err.message);
              }
            }
          })());
        }

        // Recipe generation (intent = 'recipe')
        if (result.intent === 'recipe' && result.recipe_request) {
          ops.push((async () => {
            try {
              const req2 = result.recipe_request;
              const prompt = `Create a simple, family-friendly recipe based on: ${req2.description}
${req2.dietary ? `Dietary requirements: ${req2.dietary}` : ''}
${req2.servings ? `Servings: ${req2.servings}` : ''}

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
}`;
              const { text: aiText } = await callWithFailover({
                system: 'You are a family recipe creator for busy UK households. Create simple, practical recipes. Return ONLY valid JSON.',
                messages: [{ role: 'user', content: prompt }],
                useThinking: false,
                maxTokens: 2048,
                timeoutMs: LONG_TIMEOUT_MS,
                feature: 'recipe_generate',
                householdId: req.householdId,
                userId: req.user.id,
              });
              const cleaned = aiText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
              const parsed = JSON.parse(cleaned);
              await db.createRecipe(req.householdId, {
                name: parsed.name,
                category: (parsed.category || 'dinner').toLowerCase(),
                ingredients: parsed.ingredients || [],
                method: parsed.method || [],
                prep_time_mins: parsed.prep_time_mins || null,
                cook_time_mins: parsed.cook_time_mins || null,
                servings: parsed.servings || null,
                dietary_tags: parsed.dietary_tags || [],
                source_type: 'ai_generated',
              });
            } catch (recipeErr) {
              console.error('Background recipe generation failed:', recipeErr);
            }
          })());
        }

        await Promise.all(ops);
      } catch (bgErr) {
        console.error('Background save after classify failed:', bgErr);
      }
    })();
  } catch (err) {
    console.error('POST /api/classify error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
