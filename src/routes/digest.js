const { Router } = require('express');
const db = require('../db/queries');
const { requireAuth, requireHousehold } = require('../middleware/auth');
const cache = require('../services/cache');

const router = Router();

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

    // These may fail if migrations haven't been run — fallback gracefully
    let shoppingItems = [];
    let todayEvents = [];
    let weekMeals = [];
    try { shoppingItems = await db.getShoppingList(req.householdId) || []; } catch (e) { console.warn('digest: shopping list fetch failed:', e.message); }
    try {
      const allTodayEvents = await db.getCalendarEvents(req.householdId, todayStr, todayStr + 'T23:59:59', { userId: req.user.id }) || [];
      // Filter out public holidays — they inflate the count and aren't actionable
      todayEvents = allTodayEvents.filter(e => e.category !== 'public_holiday');
    } catch (e) { console.warn('digest: calendar events fetch failed:', e.message); }
    try { weekMeals = await db.getMealPlanForWeek(req.householdId, weekStart, weekEnd) || []; } catch (e) { console.warn('digest: meals fetch failed:', e.message); }

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
    };
    cache.set(cacheKey, result, 60); // 60 sec TTL
    return res.json(result);
  } catch (err) {
    console.error('GET /api/digest error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
