const { Router } = require('express');
const db = require('../db/queries');
const { requireAuth, requireHousehold } = require('../middleware/auth');
const cache = require('../services/cache');

const router = Router();

/**
 * GET /api/shopping-lists
 * Returns all shopping lists for the household.
 */
router.get('/shopping-lists', requireAuth, requireHousehold, async (req, res) => {
  try {
    const cacheKey = `shopping-lists:${req.householdId}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const lists = await db.getShoppingLists(req.householdId);
    const result = { lists };
    cache.set(cacheKey, result, 300); // 5 min TTL
    return res.json(result);
  } catch (err) {
    console.error('GET /api/shopping-lists error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/shopping-lists
 * Create a new shopping list.
 * Body: { name }
 */
router.post('/shopping-lists', requireAuth, requireHousehold, async (req, res) => {
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'List name is required' });
  }

  try {
    const list = await db.createShoppingList(req.householdId, name.trim());
    cache.invalidate(`shopping-lists:${req.householdId}`);
    cache.invalidate(`digest:${req.householdId}`);
    return res.status(201).json({ list });
  } catch (err) {
    console.error('POST /api/shopping-lists error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/shopping-lists/:id
 * Delete a shopping list (cannot delete "Default").
 */
router.delete('/shopping-lists/:id', requireAuth, requireHousehold, async (req, res) => {
  try {
    // Check if this is the Default list
    const lists = await db.getShoppingLists(req.householdId);
    const target = lists.find((l) => l.id === req.params.id);

    if (!target) {
      return res.status(404).json({ error: 'List not found' });
    }
    if (target.name === 'Default') {
      return res.status(400).json({ error: 'Cannot delete the Default list' });
    }

    await db.deleteShoppingList(req.params.id, req.householdId);
    cache.invalidate(`shopping-lists:${req.householdId}`);
    cache.invalidate(`digest:${req.householdId}`);
    return res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/shopping-lists/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
