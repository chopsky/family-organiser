const { Router } = require('express');
const db = require('../db/queries');
const { requireAuth, requireHousehold } = require('../middleware/auth');

const router = Router();

/**
 * GET /api/digest
 * Returns the data needed to render the weekly digest in the web app.
 *
 * Returns: { completed, outstanding, upcoming, household, members }
 */
router.get('/', requireAuth, requireHousehold, async (req, res) => {
  try {
    // Today's date in YYYY-MM-DD format
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    // Meals: today + next 6 days (covers the dashboard's "today + 3 days" view
    // even when it spans across a Mon-Sun week boundary)
    const mealsEnd = new Date(today);
    mealsEnd.setDate(today.getDate() + 6);
    const weekStart = todayStr;
    const weekEnd = mealsEnd.toISOString().slice(0, 10);

    const [
      { tasks: completedTasks, shoppingItems: completedShopping },
      outstanding,
      upcoming,
      household,
      members,
    ] = await Promise.all([
      db.getCompletedThisWeek(req.householdId),
      db.getTasks(req.householdId),       // overdue + today = "carrying over"
      db.getTasksDueNextWeek(req.householdId),
      db.getHouseholdById(req.householdId),
      db.getHouseholdMembers(req.householdId),
    ]);

    // These may fail if migrations haven't been run — fallback gracefully
    let shoppingItems = [];
    let todayEvents = [];
    let weekMeals = [];
    try { shoppingItems = await db.getShoppingList(req.householdId) || []; } catch (e) { console.warn('digest: shopping list fetch failed:', e.message); }
    try { todayEvents = await db.getCalendarEvents(req.householdId, todayStr, todayStr + 'T23:59:59') || []; } catch (e) { console.warn('digest: calendar events fetch failed:', e.message); }
    try { weekMeals = await db.getMealPlanForWeek(req.householdId, weekStart, weekEnd) || []; } catch (e) { console.warn('digest: meals fetch failed:', e.message); }

    return res.json({
      completed: { tasks: completedTasks, shopping: completedShopping },
      outstanding,
      upcoming,
      household,
      members,
      shoppingCount: shoppingItems.filter((i) => !i.completed).length,
      todayEvents,
      shoppingItems: shoppingItems.filter((i) => !i.completed),
      weekMeals,
    });
  } catch (err) {
    console.error('GET /api/digest error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
