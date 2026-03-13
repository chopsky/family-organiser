const { Router } = require('express');
const db = require('../db/queries');
const { supabase } = require('../db/client');
const { requireAuth, requireHousehold } = require('../middleware/auth');

const router = Router();

const VALID_RECURRENCES = ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'];
const VALID_PRIORITIES   = ['low', 'medium', 'high'];

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
      const { data, error } = await supabase
        .from('tasks')
        .select()
        .eq('household_id', req.householdId)
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
  }

  try {
    const members = await db.getHouseholdMembers(req.householdId);
    const saved = await db.addTasks(req.householdId, tasksInput, req.user.id, members);
    return res.status(201).json({ tasks: saved });
  } catch (err) {
    console.error('POST /api/tasks error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/tasks/:id
 * Toggle task completion. Generates next recurrence when completing a recurring task.
 *
 * Body: { completed: boolean }
 */
router.patch('/:id', requireAuth, requireHousehold, async (req, res) => {
  const { completed } = req.body;

  if (typeof completed !== 'boolean') {
    return res.status(400).json({ error: '"completed" (boolean) is required' });
  }

  try {
    // Fetch the task first (and verify household ownership)
    const { data: task, error: fetchErr } = await supabase
      .from('tasks')
      .select()
      .eq('id', req.params.id)
      .eq('household_id', req.householdId)
      .single();

    if (fetchErr || !task) return res.status(404).json({ error: 'Task not found' });

    const updateData = completed
      ? { completed: true,  completed_at: new Date().toISOString() }
      : { completed: false, completed_at: null };

    const { data: updated, error: updateErr } = await supabase
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

    return res.json({ task: updated, nextTask });
  } catch (err) {
    console.error('PATCH /api/tasks/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
