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

// Date-string helpers (parsed as local calendar dates, never UTC, so they don't
// drift across a timezone boundary - the string already encodes the day).
function ymd(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + n); return ymd(dt);
}
// Monday of the week containing dateStr (week is Monday-anchored, like the view).
function mondayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay(); // 0=Sun..6=Sat
  dt.setDate(dt.getDate() + (dow === 0 ? -6 : 1 - dow));
  return ymd(dt);
}

// Validate + normalise an incoming definition body. Returns { def } or { error }.
function normaliseDef(body, memberIds) {
  if (!body || typeof body.title !== 'string' || !body.title.trim()) return { error: 'title is required' };
  // "Anyone" chores are up-for-grabs: no assignee, always a chore (not a
  // routine). The completer is chosen at check-off time, not here.
  const anyone = !!body.anyone;
  const type = anyone ? 'chore' : (VALID_TYPES.includes(body.type) ? body.type : 'chore');
  const repeat = VALID_REPEATS.includes(body.repeat) ? body.repeat : 'daily';
  const assignee_ids = (!anyone && Array.isArray(body.assignee_ids))
    ? body.assignee_ids.filter((id) => memberIds.includes(id)) : [];
  const whens = (!anyone && type === 'routine' && Array.isArray(body.whens))
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
      title: body.title.trim(), emoji: body.emoji || null, type, anyone, assignee_ids, whens, repeat, days,
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
    const [defs, completions, balances] = await Promise.all([
      db.getChoreDefinitions(req.householdId),
      db.getChoreCompletionsForDate(req.householdId, date),
      db.getStarBalances(req.householdId),
    ]);
    // Skips are best-effort: if the chore_skips migration hasn't run yet, a
    // missing table must NOT blank the whole board - just show no skips.
    let skipped = new Set();
    try { skipped = new Set(await db.getChoreSkipsForDate(req.householdId, date)); }
    catch (e) { console.warn('chore skips unavailable (run migration-chore-skips.sql):', e.message); }
    const tasks = buildDayView(defs, completions, date).filter((t) => !skipped.has(t.id));
    return res.json({ date, tasks, balances });
  } catch (err) {
    console.error('GET /api/chores error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/chores/week?date= — raw data for the desktop Week grid: every
 * definition + the week's REAL completion/skip history, for the Monday-anchored
 * week containing `date` (defaults to the household's today). The client mirrors
 * appliesOn() to lay the grid out, and reads completions for past-day cells
 * instead of assuming complete.
 */
router.get('/week', requireAuth, requireHousehold, async (req, res) => {
  try {
    const today = await householdToday(req.householdId);
    const ref = DATE_RE.test(req.query.date) ? req.query.date : today;
    const from = mondayOf(ref);
    const to = addDays(from, 6);
    const [defs, completions, skips, balances] = await Promise.all([
      db.getChoreDefinitions(req.householdId),
      db.getChoreCompletionsForRange(req.householdId, from, to),
      db.getChoreSkipsForRange(req.householdId, from, to).catch(() => []), // pre-migration tolerant
      db.getStarBalances(req.householdId),
    ]);
    return res.json({ from, to, today, defs, completions, skips, balances });
  } catch (err) {
    console.error('GET /api/chores/week error:', err);
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
    // Assigned chores must be completed by one of their assignees; "Anyone"
    // chores accept any household member as the attributed completer (chosen in
    // the "Who completed this task?" popup).
    if (!def.anyone && !(def.assignee_ids || []).includes(memberId)) {
      return res.status(400).json({ error: 'Task not assigned to this member' });
    }

    // A routine shown in several time-of-day slots is completed per-slot, so
    // each (member, date, slot) is an independent tick. Chores/anyone are
    // slotless (''). Only honour a slot the routine actually carries.
    const slot = (def.type === 'routine' && VALID_WHENS.includes(req.body?.slot) && (def.whens || []).includes(req.body.slot))
      ? req.body.slot : '';

    const refId = slot ? `${def.id}:${memberId}:${date}:${slot}` : `${def.id}:${memberId}:${date}`;

    // The completion write is the source of truth for the toggle. The star
    // ledger + balance steps below are best-effort: a ledger hiccup must not
    // 500 the request, or the client would revert a toggle that actually saved.
    if (done) {
      // An "Anyone" chore is claimed once per day: if someone already completed
      // it, ignore further claims so a second member can't double-credit stars.
      let alreadyClaimed = false;
      if (def.anyone) {
        const dayCompletions = await db.getChoreCompletionsForDate(req.householdId, date);
        alreadyClaimed = (dayCompletions || []).some((c) => c.definition_id === def.id);
      }
      if (!alreadyClaimed) {
        const { inserted } = await db.addChoreCompletion(def.id, memberId, req.householdId, date, slot);
        // Credit stars only on a NEW completion (insert) so repeat taps can't double-credit.
        if (inserted && def.reward && def.stars > 0) {
          try {
            await db.addStarTransaction({ householdId: req.householdId, memberId, delta: def.stars, reason: 'earn', refType: 'chore_earn', refId });
          } catch (e) { console.warn('chore complete: star credit failed (non-fatal):', e.message); }
        }
      }
    } else {
      await db.removeChoreCompletion(def.id, memberId, date, req.householdId, slot);
      if (def.reward && def.stars > 0) {
        try { await db.removeStarTransactionByRef('chore_earn', refId); }
        catch (e) { console.warn('chore uncomplete: star refund failed (non-fatal):', e.message); }
      }
    }

    cache.invalidate(`digest:${req.householdId}`);
    let balances = {};
    try { balances = await db.getStarBalances(req.householdId); }
    catch (e) { console.warn('chore complete: balance fetch failed (non-fatal):', e.message); }
    return res.json({ ok: true, balances });
  } catch (err) {
    console.error('POST /api/chores/:id/complete error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.normaliseDef = normaliseDef;
