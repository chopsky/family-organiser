const { Router } = require('express');
const db = require('../db/queries');
const { requireAuth, requireHousehold } = require('../middleware/auth');

const router = Router();

const VALID_CATEGORIES = ['groceries', 'clothing', 'household', 'school', 'pets', 'other'];

/**
 * GET /api/shopping/recent
 * Returns shopping items completed in the last 24 hours (for undo/restore).
 */
router.get('/recent', requireAuth, requireHousehold, async (req, res) => {
  try {
    const items = await db.getRecentlyCompletedShopping(req.householdId);
    return res.json({ items });
  } catch (err) {
    console.error('GET /api/shopping/recent error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/shopping
 * Query params: category, completed (boolean string)
 */
router.get('/', requireAuth, requireHousehold, async (req, res) => {
  try {
    const includeCompleted = req.query.completed === 'true';
    let items = await db.getShoppingList(req.householdId, { includeCompleted });

    if (req.query.category) {
      items = items.filter((i) => i.category === req.query.category);
    }

    return res.json({ items });
  } catch (err) {
    console.error('GET /api/shopping error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/shopping
 * Add one or more items.
 *
 * Body: { items: [{ item, category?, quantity? }] }
 *    or: { item, category?, quantity? }   (single item shorthand)
 */
router.post('/', requireAuth, requireHousehold, async (req, res) => {
  let itemsInput = req.body.items;
  if (!itemsInput && req.body.item) {
    // single-item shorthand
    itemsInput = [req.body];
  }

  if (!Array.isArray(itemsInput) || !itemsInput.length) {
    return res.status(400).json({ error: 'items array is required' });
  }

  for (const i of itemsInput) {
    if (!i.item?.trim()) return res.status(400).json({ error: 'Each item must have an "item" name' });
    if (i.category && !VALID_CATEGORIES.includes(i.category)) {
      return res.status(400).json({ error: `Invalid category "${i.category}"` });
    }
  }

  try {
    const saved = await db.addShoppingItems(req.householdId, itemsInput, req.user.id);
    return res.status(201).json({ items: saved });
  } catch (err) {
    console.error('POST /api/shopping error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/shopping/:id
 * Toggle completion status of an item.
 *
 * Body: { completed: boolean }
 */
router.patch('/:id', requireAuth, requireHousehold, async (req, res) => {
  const { completed } = req.body;

  if (typeof completed !== 'boolean') {
    return res.status(400).json({ error: '"completed" (boolean) is required' });
  }

  try {
    const { supabase } = require('../db/client');
    const updateData = completed
      ? { completed: true,  completed_at: new Date().toISOString() }
      : { completed: false, completed_at: null };

    const { data, error } = await supabase
      .from('shopping_items')
      .update(updateData)
      .eq('id', req.params.id)
      .eq('household_id', req.householdId) // scoped to household
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'Item not found' });
      throw error;
    }
    return res.json({ item: data });
  } catch (err) {
    console.error('PATCH /api/shopping/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/shopping/:id
 * Permanently delete a shopping item.
 */
router.delete('/:id', requireAuth, requireHousehold, async (req, res) => {
  try {
    await db.deleteShoppingItem(req.params.id, req.householdId);
    return res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/shopping/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
