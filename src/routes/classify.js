const { Router } = require('express');
const db = require('../db/queries');
const { classify } = require('../services/ai');
const { callWithFailover, LONG_TIMEOUT_MS } = require('../services/ai-client');
const { getWeatherReport, getCoordsFromTimezone, extractLocationFromMessage, geocodeLocation } = require('../services/weather');
const { requireAuth, requireHousehold } = require('../middleware/auth');

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
    const result = await classify(text.trim(), memberNames, notes, { householdId: req.householdId, userId: req.user.id, sender: currentUser?.name || req.user.name, calendarEvents, tasks: openTasks, timezone: userTz });

    // Strip any leaked JSON action blocks from the response message
    if (result.response_message) {
      result.response_message = stripActionBlocks(result.response_message);
    }

    // Handle weather intent — fetch weather before responding
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
          const fullUser = members.find(m => m.id === req.user.id);
          lat = fullUser?.latitude;
          lon = fullUser?.longitude;
          tz = fullUser?.timezone || 'Europe/London';
          if (!lat || !lon) {
            const tzCoords = getCoordsFromTimezone(tz);
            if (tzCoords) [lat, lon] = tzCoords;
          }
        }

        if (lat && lon) {
          const weatherReport = await getWeatherReport(lat, lon, tz, { userMessage: text });
          const prefix = locationLabel ? `📍 **${locationLabel}**\n\n` : '';
          result.response_message = prefix + weatherReport;
        } else {
          result.response_message = "I couldn't determine your location. Try asking 'weather in Cape Town' or check your profile settings. 📍";
        }
      } catch (err) {
        console.error('Weather fetch failed:', err.message);
        result.response_message = "Sorry, I couldn't fetch the weather right now. Please try again in a moment. 🌤️";
      }
      return res.json({ result });
    }

    // Send the AI response immediately — don't wait for DB saves
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
            ops.push(db.addShoppingItems(req.householdId, enriched, req.user.id));
          }
          if (toRemove.length) ops.push(db.completeShoppingItemsByName(req.householdId, toRemove.map((i) => i.item)));
        }

        // Tasks (adds run in parallel, completes need sequential for recurrence)
        if (result.tasks?.length) {
          const toAdd      = result.tasks.filter((t) => t.action === 'add');
          const toComplete = result.tasks.filter((t) => t.action === 'complete');
          if (toAdd.length) ops.push(db.addTasks(req.householdId, toAdd, req.user.id, members));
          if (toComplete.length) {
            ops.push((async () => {
              for (const t of toComplete) {
                const done = await db.completeTasksByName(req.householdId, [t.title], t.assigned_to_name);
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
          // Support both assigned_to_names (array) and legacy assigned_to_name (string)
          const assigneeNames = ev.assigned_to_names || (ev.assigned_to_name ? [ev.assigned_to_name] : []);
          if (assigneeNames.length > 0) {
            const firstMatch = members.find(m => m.name.toLowerCase() === assigneeNames[0].toLowerCase());
            if (firstMatch) {
              eventData.assigned_to = firstMatch.id;
              eventData.assigned_to_name = firstMatch.name;
            }
          }
          ops.push((async () => {
            const created = await db.createCalendarEvent(req.householdId, eventData, req.user.id);
            if (created && assigneeNames.length > 0) {
              await db.saveEventAssignees(created.id, req.householdId, assigneeNames, members);
            }
            // Reminders only when the user explicitly asked. The classifier
            // prompt leaves ev.reminders null otherwise. See bot/handlers.js
            // for the matching WhatsApp-side wiring.
            if (created && Array.isArray(ev.reminders) && ev.reminders.length > 0) {
              try {
                await db.saveEventReminders(created.id, req.householdId, ev.reminders, created.start_time);
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
