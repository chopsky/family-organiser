const { Router } = require('express');
const db = require('../db/queries');
const { requireAuth, requireHousehold } = require('../middleware/auth');
const cache = require('../services/cache');
const { buildDayView } = require('../services/chores');

const router = Router();

const VALID_TYPES = ['routine', 'chore'];
const VALID_REPEATS = ['daily', 'weekly', 'once'];
const VALID_WHENS = ['morning', 'afternoon', 'evening'];
const VALID_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

// Today in the household's timezone (en-CA gives YYYY-MM-DD). Mirrors digest.js.
async function householdToday(householdId) {
  let tz = 'Europe/London';
  try { tz = (await db.getHouseholdById(householdId))?.timezone || tz; } catch { /* default */ }
  return new Date().toLocaleDateString('en-CA', { timeZone: tz });
}

// Validate + normalise an incoming definition body. Returns { def } or { error }.
function normaliseDef(body, memberIds) {
  if (!body || typeof body.title !== 'string' || !body.title.trim()) return { error: 'title is required' };
  const type = VALID_TYPES.includes(body.type) ? body.type : 'chore';
  const repeat = VALID_REPEATS.includes(body.repeat) ? body.repeat : 'daily';
  const assignee_ids = Array.isArray(body.assignee_ids)
    ? body.assignee_ids.filter((id) => memberIds.includes(id)) : [];
  const whens = type === 'routine' && Array.isArray(body.whens)
    ? body.whens.filter((w) => VALID_WHENS.includes(w)) : [];
  const days = repeat === 'weekly' && Array.isArray(body.days)
    ? body.days.filter((d) => VALID_DAYS.includes(d)) : [];
  if (repeat === 'once' && body.due_date && !DATE_RE.test(body.due_date)) return { error: 'invalid due_date' };
  if (body.start_date && !DATE_RE.test(body.start_date)) return { error: 'invalid start_date' };
  if (body.due_time && !TIME_RE.test(body.due_time)) return { error: 'invalid due_time' };
  const reward = !!body.reward;
  const stars = reward ? Math.max(0, Math.min(999, parseInt(body.stars, 10) || 0)) : 0;
  return {
    def: {
      title: body.title.trim(), emoji: body.emoji || null, type, assignee_ids, whens, repeat, days,
      due_date: repeat === 'once' ? (body.due_date || null) : null,
      start_date: body.start_date || null,
      due_time: body.due_time || null,
      reward, stars, position: body.position,
    },
  };
}

/**
 * GET /api/chores?date=YYYY-MM-DD
 * The selected day's view: recurring definitions that apply on that date, each
 * with a per-member `done` map, plus current star balances for the columns.
 */
router.get('/', requireAuth, requireHousehold, async (req, res) => {
  try {
    const date = DATE_RE.test(req.query.date) ? req.query.date : await householdToday(req.householdId);
    const [defs, completions, balances, skips] = await Promise.all([
      db.getChoreDefinitions(req.householdId),
      db.getChoreCompletionsForDate(req.householdId, date),
      db.getStarBalances(req.householdId),
      db.getChoreSkipsForDate(req.householdId, date),
    ]);
    const skipped = new Set(skips);
    const tasks = buildDayView(defs, completions, date).filter((t) => !skipped.has(t.id));
    return res.json({ date, tasks, balances });
  } catch (err) {
    console.error('GET /api/chores error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** POST /api/chores — create a recurring definition. */
router.post('/', requireAuth, requireHousehold, async (req, res) => {
  try {
    const members = await db.getHouseholdMembers(req.householdId);
    const { def, error } = normaliseDef(req.body, members.map((m) => m.id));
    if (error) return res.status(400).json({ error });
    const created = await db.addChoreDefinition(req.householdId, def, req.user.id);
    cache.invalidate(`digest:${req.householdId}`);
    return res.status(201).json({ task: created });
  } catch (err) {
    console.error('POST /api/chores error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** PATCH /api/chores/:id — edit a definition. */
router.patch('/:id', requireAuth, requireHousehold, async (req, res) => {
  try {
    const members = await db.getHouseholdMembers(req.householdId);
    const { def, error } = normaliseDef({ ...req.body }, members.map((m) => m.id));
    if (error) return res.status(400).json({ error });
    const updated = await db.updateChoreDefinition(req.params.id, req.householdId, def);
    if (!updated) return res.status(404).json({ error: 'Task not found' });
    cache.invalidate(`digest:${req.householdId}`);
    return res.json({ task: updated });
  } catch (err) {
    console.error('PATCH /api/chores/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** DELETE /api/chores/:id — archive ("Delete for everyone"). */
router.delete('/:id', requireAuth, requireHousehold, async (req, res) => {
  try {
    await db.archiveChoreDefinition(req.params.id, req.householdId);
    cache.invalidate(`digest:${req.householdId}`);
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/chores/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** POST /api/chores/:id/skip — body { date } hides this recurring task for the day. */
router.post('/:id/skip', requireAuth, requireHousehold, async (req, res) => {
  try {
    const date = DATE_RE.test(req.body?.date) ? req.body.date : null;
    if (!date) return res.status(400).json({ error: 'date is required' });
    await db.addChoreSkip(req.params.id, req.householdId, date);
    cache.invalidate(`digest:${req.householdId}`);
    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/chores/:id/skip error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** POST /api/chores/reorder — body { ids: [definitionId,...] } new manual order. */
router.post('/reorder', requireAuth, requireHousehold, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    await db.reorderChoreDefinitions(req.householdId, ids);
    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/chores/reorder error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/chores/:id/complete
 * Body { member_id, date: 'YYYY-MM-DD', done: bool }.
 * Records (or clears) one person's completion for that day. A rewarded chore
 * completed by a KID (member_type 'dependent') credits stars exactly once;
 * un-completing refunds. Returns the fresh star balances.
 */
router.post('/:id/complete', requireAuth, requireHousehold, async (req, res) => {
  try {
    const { member_id: memberId, done } = req.body || {};
    const date = DATE_RE.test(req.body?.date) ? req.body.date : null;
    if (!memberId || !date) return res.status(400).json({ error: 'member_id and date are required' });

    const members = await db.getHouseholdMembers(req.householdId);
    const member = members.find((m) => m.id === memberId);
    if (!member) return res.status(400).json({ error: 'Unknown member' });

    const defs = await db.getChoreDefinitions(req.householdId);
    const def = defs.find((d) => d.id === req.params.id);
    if (!def) return res.status(404).json({ error: 'Task not found' });
    if (!(def.assignee_ids || []).includes(memberId)) return res.status(400).json({ error: 'Task not assigned to this member' });

    const isKid = member.member_type === 'dependent';
    const refId = `${def.id}:${memberId}:${date}`;

    if (done) {
      const { inserted } = await db.addChoreCompletion(def.id, memberId, req.householdId, date);
      // Credit stars only on a NEW completion (insert) so repeat taps can't double-credit.
      if (inserted && isKid && def.reward && def.stars > 0) {
        await db.addStarTransaction({ householdId: req.householdId, memberId, delta: def.stars, reason: 'earn', refType: 'chore_earn', refId });
      }
    } else {
      await db.removeChoreCompletion(def.id, memberId, date, req.householdId);
      if (def.reward && def.stars > 0) await db.removeStarTransactionByRef('chore_earn', refId);
    }

    cache.invalidate(`digest:${req.householdId}`);
    const balances = await db.getStarBalances(req.householdId);
    return res.json({ ok: true, balances });
  } catch (err) {
    console.error('POST /api/chores/:id/complete error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.normaliseDef = normaliseDef;
