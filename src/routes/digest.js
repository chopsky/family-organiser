const { Router } = require('express');
const db = require('../db/queries');
const { requireAuth, requireHousehold } = require('../middleware/auth');
const cache = require('../services/cache');
const { buildDayView } = require('../services/chores');

const router = Router();

/**
 * Deduplicate a day's events for the digest:
 *  - drop a read-only SYNCED copy (external_feed_id) shadowed by a NATIVE event
 *    of the same title+date - a subscribed event deleted at the source that
 *    lingers until the feed pull confirms it, re-created natively at a new time;
 *    without this "Up next" / Today's schedule surface the ghost's old time;
 *  - then collapse exact title+start_time dupes that sync can create.
 * Pure + exported for testing. Mirrors the Calendar page's native-over-synced
 * de-dup.
 */
function dedupeTodayEvents(events) {
  const dateOf = (e) => (e.start_time || '').split('T')[0];
  const nativeTitleDates = new Set(
    events.filter((e) => !e.external_feed_id).map((e) => `${e.title}|${dateOf(e)}`),
  );
  const seen = new Set();
  return events.filter((e) => {
    if (e.external_feed_id && nativeTitleDates.has(`${e.title}|${dateOf(e)}`)) return false;
    const key = `${e.title}|${e.start_time}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * GET /api/digest
 * Returns the data needed to render the weekly digest in the web app.
 *
 * Returns: { completed, outstanding, upcoming, household, members }
 */
router.get('/', requireAuth, requireHousehold, async (req, res) => {
  try {
    const cacheKey = `digest:${req.householdId}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    // Fetch household first so we can use its timezone for date calculations
    const household = await db.getHouseholdById(req.householdId);
    const tz = household?.timezone || 'Europe/London';

    // Today's date in YYYY-MM-DD format, in the household's timezone
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: tz }); // en-CA gives YYYY-MM-DD

    // Meals: today + next 6 days (covers the dashboard's "today + 3 days" view
    // even when it spans across a Mon-Sun week boundary)
    const mealsEnd = new Date(now);
    mealsEnd.setDate(now.getDate() + 6);
    const weekStart = todayStr;
    const weekEnd = mealsEnd.toLocaleDateString('en-CA', { timeZone: tz });

    const [
      { tasks: completedTasks, shoppingItems: completedShopping },
      outstanding,
      upcoming,
      members,
    ] = await Promise.all([
      db.getCompletedThisWeek(req.householdId),
      db.getTasks(req.householdId),       // overdue + today = "carrying over"
      db.getTasksDueNextWeek(req.householdId),
      db.getHouseholdMembers(req.householdId),
    ]);

    // These may fail if migrations haven't been run - fallback gracefully
    let shoppingItems = [];
    let todayEvents = [];
    let weekMeals = [];
    try { shoppingItems = await db.getShoppingList(req.householdId) || []; } catch (e) { console.warn('digest: shopping list fetch failed:', e.message); }
    try {
      // Fetch a wide window then filter by date string - this matches how the Calendar page works
      // and avoids timezone mismatches between the DB (timestamptz/UTC) and the household TZ
      const windowStart = todayStr + 'T00:00:00';
      const windowEnd = todayStr + 'T23:59:59';
      const allTodayEvents = await db.getCalendarEvents(req.householdId, windowStart, windowEnd, { userId: req.user.id }) || [];
      // Log every event so we can see what's being counted
      console.log(`[digest] todayStr=${todayStr} tz=${tz} allTodayEvents=${allTodayEvents.length}`);
      allTodayEvents.forEach((e, i) => console.log(`[digest] ${i+1}. [${e.category||'general'}] "${e.title}" start=${e.start_time} end=${e.end_time}`));
      // Filter to only events that actually fall on today (by date string, matching Calendar page logic)
      // and exclude public holidays and birthdays since they aren't actionable schedule items
      const filtered = allTodayEvents.filter(e => {
        const start = e.start_time?.split('T')[0];
        const end = e.end_time?.split('T')[0];
        const isToday = start === todayStr || (start <= todayStr && end >= todayStr);
        return isToday && e.category !== 'public_holiday' && e.category !== 'birthday';
      });
      // Drop sync ghosts shadowed by a native event, then exact dupes.
      todayEvents = dedupeTodayEvents(filtered);
      // Attach the multi-assignee list (event_assignees rows, the
      // separate per-event reminder fanout table) so the Dashboard can
      // render stacked avatars + "A, B +N" name labels. The
      // calendar_events.assigned_to_ids/_names arrays on the row itself
      // already carry the same data for the calendar chip; this batch
      // join surfaces names for the dashboard summary specifically.
      try {
        const eventIds = todayEvents.map(e => e.id).filter(Boolean);
        const rows = await db.getEventAssigneesBatch(eventIds);
        const byEvent = new Map();
        for (const r of rows) {
          if (!byEvent.has(r.event_id)) byEvent.set(r.event_id, []);
          byEvent.get(r.event_id).push({ member_id: r.member_id, member_name: r.member_name });
        }
        todayEvents = todayEvents.map(e => ({
          ...e,
          assignees: byEvent.get(e.id) || [],
        }));
      } catch (assigneeErr) {
        console.warn('digest: assignees batch fetch failed:', assigneeErr.message);
      }
      console.log(`[digest] DB returned ${allTodayEvents.length}, after filter+dedup: ${todayEvents.length}`);
    } catch (e) { console.warn('digest: calendar events fetch failed:', e.message); }
    try { weekMeals = await db.getMealPlanForWeek(req.householdId, weekStart, weekEnd) || []; } catch (e) { console.warn('digest: meals fetch failed:', e.message); }

    // Per-member progress on today's chores/routines, for the dashboard
    // "Today's tasks" scorecard. Only members with at least one task today are
    // listed. "Anyone" chores are excluded (no single assignee). Best-effort:
    // a chore_* migration gap must not break the rest of the digest.
    let taskScores = [];
    try {
      const [defs, completions] = await Promise.all([
        db.getChoreDefinitions(req.householdId),
        db.getChoreCompletionsForDate(req.householdId, todayStr),
      ]);
      let skipped = new Set();
      try { skipped = new Set(await db.getChoreSkipsForDate(req.householdId, todayStr)); } catch { /* no skips table yet */ }
      const dayTasks = buildDayView(defs, completions, todayStr).filter((t) => !skipped.has(t.id) && !t.anyone);
      taskScores = members.map((m) => {
        const mine = dayTasks.filter((t) => (t.assignee_ids || []).includes(m.id));
        return {
          member_id: m.id,
          name: m.name,
          color_theme: m.color_theme,
          avatar_url: m.avatar_url,
          avatar_id: m.avatar_id,
          done: mine.filter((t) => t.done?.[m.id]).length,
          total: mine.length,
        };
      }).filter((s) => s.total > 0);
    } catch (e) { console.warn('digest: task scores failed:', e.message); }

    const result = {
      completed: { tasks: completedTasks, shopping: completedShopping },
      outstanding,
      upcoming,
      household,
      members,
      shoppingCount: shoppingItems.filter((i) => !i.completed).length,
      todayEvents,
      shoppingItems: shoppingItems.filter((i) => !i.completed),
      weekMeals,
      taskScores,
    };
    cache.set(cacheKey, result, 60); // 60 sec TTL
    return res.json(result);
  } catch (err) {
    console.error('GET /api/digest error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.dedupeTodayEvents = dedupeTodayEvents;
