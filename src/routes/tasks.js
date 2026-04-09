const { Router } = require('express');
const db = require('../db/queries');
const { supabaseAdmin } = require('../db/client');
const { requireAuth, requireHousehold } = require('../middleware/auth');
const cache = require('../services/cache');

const router = Router();

const VALID_RECURRENCES = ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'];
const VALID_PRIORITIES   = ['low', 'medium', 'high'];
const VALID_NOTIFICATIONS = ['at_time', '5_min', '15_min', '30_min', '1_hour', '2_hours', '1_day', '2_days'];

/**
 * GET /api/tasks/recent
 * Returns tasks completed in the last 24 hours (for undo/restore).
 */
router.get('/recent', requireAuth, requireHousehold, async (req, res) => {
  try {
    const tasks = await db.getRecentlyCompletedTasks(req.householdId);
    return res.json({ tasks });
  } catch (err) {
    console.error('GET /api/tasks/recent error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/tasks
 * Query params:
 *   all=true              → all incomplete tasks
 *   assignee=<userId>     → tasks for this user + everyone tasks
 *   completed=true        → include completed tasks
 */
router.get('/', requireAuth, requireHousehold, async (req, res) => {
  try {
    let tasks;

    if (req.query.all === 'true') {
      tasks = await db.getAllIncompleteTasks(req.householdId);
    } else if (req.query.assignee) {
      tasks = await db.getTasks(req.householdId, { assignedToId: req.query.assignee });
    } else {
      // Default: due today + overdue
      tasks = await db.getTasks(req.householdId);
    }

    if (req.query.completed === 'true') {
      const userDb = supabaseAdmin;
      const { data, error } = await userDb
        .from('tasks')
        .select()
        .eq('completed', true)
        .order('completed_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      tasks = (tasks || []).concat(data || []);
    }

    return res.json({ tasks });
  } catch (err) {
    console.error('GET /api/tasks error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/tasks
 * Add one or more tasks manually.
 *
 * Body: { tasks: [{ title, assigned_to_name?, due_date?, recurrence?, priority? }] }
 *    or: { title, ... } (single task shorthand)
 */
router.post('/', requireAuth, requireHousehold, async (req, res) => {
  let tasksInput = req.body.tasks;
  if (!tasksInput && req.body.title) {
    tasksInput = [req.body];
  }

  if (!Array.isArray(tasksInput) || !tasksInput.length) {
    return res.status(400).json({ error: 'tasks array is required' });
  }

  for (const t of tasksInput) {
    if (!t.title?.trim()) return res.status(400).json({ error: 'Each task must have a "title"' });
    if (t.recurrence && !VALID_RECURRENCES.includes(t.recurrence)) {
      return res.status(400).json({ error: `Invalid recurrence "${t.recurrence}"` });
    }
    if (t.priority && !VALID_PRIORITIES.includes(t.priority)) {
      return res.status(400).json({ error: `Invalid priority "${t.priority}"` });
    }
    if (t.notification && !VALID_NOTIFICATIONS.includes(t.notification)) {
      return res.status(400).json({ error: `Invalid notification "${t.notification}"` });
    }
  }

  try {
    const members = await db.getHouseholdMembers(req.householdId);
    const saved = await db.addTasks(req.householdId, tasksInput, req.user.id, members);
    cache.invalidate(`digest:${req.householdId}`);
    return res.status(201).json({ tasks: saved });
  } catch (err) {
    console.error('POST /api/tasks error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/tasks/:id
 * Update task fields: any editable field.
 *
 * Body: { title?, completed?, priority?, due_date?, due_time?, assigned_to_name?,
 *         recurrence?, description?, notification? }
 */
router.patch('/:id', requireAuth, requireHousehold, async (req, res) => {
  const {
    completed, priority, title, due_date, due_time,
    assigned_to_name, recurrence, description, notification,
  } = req.body;

  if (priority && !VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: `Invalid priority "${priority}"` });
  }
  if (recurrence && !VALID_RECURRENCES.includes(recurrence)) {
    return res.status(400).json({ error: `Invalid recurrence "${recurrence}"` });
  }
  if (notification && !VALID_NOTIFICATIONS.includes(notification)) {
    return res.status(400).json({ error: `Invalid notification "${notification}"` });
  }

  try {
    // Fetch the task first (and verify household ownership)
    const userDb = supabaseAdmin;
    const { data: task, error: fetchErr } = await userDb
      .from('tasks')
      .select()
      .eq('id', req.params.id)
      .single();

    if (fetchErr || !task) return res.status(404).json({ error: 'Task not found' });

    const updateData = {};

    if (typeof completed === 'boolean') {
      updateData.completed = completed;
      updateData.completed_at = completed ? new Date().toISOString() : null;
    }
    if (title !== undefined) updateData.title = title.trim();
    if (priority) updateData.priority = priority;
    if (due_date !== undefined) updateData.due_date = due_date;
    if (due_time !== undefined) updateData.due_time = due_time || null;
    if (recurrence !== undefined) updateData.recurrence = recurrence || null;
    if (description !== undefined) updateData.description = description || null;
    if (notification !== undefined) {
      updateData.notification = notification || null;
      updateData.notification_sent_at = null; // Reset so notification fires again
    }

    // Resolve assigned_to_name to user ID
    if (assigned_to_name !== undefined) {
      updateData.assigned_to_name = assigned_to_name || null;
      if (assigned_to_name) {
        const members = await db.getHouseholdMembers(req.householdId);
        const member = members.find((m) => m.name.toLowerCase() === assigned_to_name.toLowerCase());
        updateData.assigned_to = member ? member.id : null;
      } else {
        updateData.assigned_to = null;
      }
    }

    // Reset notification_sent_at if due_date or due_time changed
    if (due_date !== undefined || due_time !== undefined) {
      updateData.notification_sent_at = null;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { data: updated, error: updateErr } = await userDb
      .from('tasks')
      .update(updateData)
      .eq('id', req.params.id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // If completing a recurring task, generate the next occurrence
    let nextTask = null;
    if (completed && task.recurrence) {
      nextTask = await db.generateNextRecurrence(task);
    }

    cache.invalidate(`digest:${req.householdId}`);
    return res.json({ task: updated, nextTask });
  } catch (err) {
    console.error('PATCH /api/tasks/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/tasks/:id
 * Permanently delete a task.
 */
router.delete('/:id', requireAuth, requireHousehold, async (req, res) => {
  try {
    await db.deleteTask(req.params.id, req.householdId);
    cache.invalidate(`digest:${req.householdId}`);
    return res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/tasks/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
