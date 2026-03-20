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

    const saved = { shopping: [], tasks: [] };

    // Shopping items
    if (result.shopping_items?.length) {
      const toAdd    = result.shopping_items.filter((i) => i.action === 'add');
      const toRemove = result.shopping_items.filter((i) => i.action === 'remove');

      if (toAdd.length) {
        const items = await db.addShoppingItems(req.householdId, toAdd, req.user.id);
        saved.shopping.push(...items);
      }
      if (toRemove.length) {
        const done = await db.completeShoppingItemsByName(req.householdId, toRemove.map((i) => i.item));
        saved.shopping.push(...done);
      }
    }

    // Tasks
    if (result.tasks?.length) {
      const toAdd      = result.tasks.filter((t) => t.action === 'add');
      const toComplete = result.tasks.filter((t) => t.action === 'complete');

      if (toAdd.length) {
        const tasks = await db.addTasks(req.householdId, toAdd, req.user.id, members);
        saved.tasks.push(...tasks);
      }
      for (const t of toComplete) {
        const done = await db.completeTasksByName(req.householdId, [t.title], t.assigned_to_name);
        saved.tasks.push(...done);
        for (const completedTask of done) {
          if (completedTask.recurrence) await db.generateNextRecurrence(completedTask);
        }
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

      // Resolve assigned_to member
      if (ev.assigned_to) {
        const match = members.find(m => m.name.toLowerCase() === ev.assigned_to.toLowerCase());
        if (match) {
          eventData.assigned_to = match.id;
          eventData.assigned_to_name = match.name;
        }
      }

      const created = await db.createCalendarEvent(req.householdId, eventData, req.user.id);
      saved.event = created;
    }

    return res.json({ result, saved });
  } catch (err) {
    console.error('POST /api/classify error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
