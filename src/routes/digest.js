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
    const [
      { tasks: completedTasks, shoppingItems: completedShopping },
      outstanding,
      upcoming,
      household,
      members,
      shoppingItems,
    ] = await Promise.all([
      db.getCompletedThisWeek(req.householdId),
      db.getTasks(req.householdId),       // overdue + today = "carrying over"
      db.getTasksDueNextWeek(req.householdId),
      db.getHouseholdById(req.householdId),
      db.getHouseholdMembers(req.householdId),
      db.getShoppingList(req.householdId),
    ]);

    return res.json({
      completed: { tasks: completedTasks, shopping: completedShopping },
      outstanding,
      upcoming,
      household,
      members,
      shoppingCount: shoppingItems.filter((i) => !i.completed).length,
    });
  } catch (err) {
    console.error('GET /api/digest error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
