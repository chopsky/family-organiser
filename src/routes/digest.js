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

    // Monday–Sunday of the current week
    const dayOfWeek = today.getDay(); // 0 = Sunday
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const weekStart = monday.toISOString().slice(0, 10);
    const weekEnd = sunday.toISOString().slice(0, 10);

    const [
      { tasks: completedTasks, shoppingItems: completedShopping },
      outstanding,
      upcoming,
      household,
      members,
      shoppingItems,
      todayEvents,
      weekMeals,
    ] = await Promise.all([
      db.getCompletedThisWeek(req.householdId),
      db.getTasks(req.householdId),       // overdue + today = "carrying over"
      db.getTasksDueNextWeek(req.householdId),
      db.getHouseholdById(req.householdId),
      db.getHouseholdMembers(req.householdId),
      db.getShoppingList(req.householdId),
      db.getCalendarEvents(req.householdId, todayStr, todayStr),
      db.getMealPlanForWeek(req.householdId, weekStart, weekEnd),
    ]);

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
