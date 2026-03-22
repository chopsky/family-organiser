const { Router } = require('express');
const db = require('../db/queries');
const { classify } = require('../services/ai');
const { requireAuth, requireHousehold } = require('../middleware/auth');

const router = Router();

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
    const result = await classify(text.trim(), memberNames);

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
          if (toAdd.length)    ops.push(db.addShoppingItems(req.householdId, toAdd, req.user.id));
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

        // Calendar events
        if (result.intent === 'create_event' && result.calendar_event) {
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
          const assigneeName = ev.assigned_to_name || ev.assigned_to;
          if (assigneeName) {
            const match = members.find(m => m.name.toLowerCase() === assigneeName.toLowerCase());
            if (match) {
              eventData.assigned_to = match.id;
              eventData.assigned_to_name = match.name;
            }
          }
          ops.push(db.createCalendarEvent(req.householdId, eventData, req.user.id));
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
