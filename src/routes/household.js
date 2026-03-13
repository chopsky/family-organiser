const { Router } = require('express');
const db = require('../db/queries');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = Router();

/**
 * GET /api/household
 * Returns household info + members list.
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const [household, members] = await Promise.all([
      db.getHouseholdById(req.householdId),
      db.getHouseholdMembers(req.householdId),
    ]);
    return res.json({ household, members });
  } catch (err) {
    console.error('GET /api/household error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/settings
 * Update household settings. Admin only.
 *
 * Body: { name?: string, reminder_time?: string }
 */
router.patch('/settings', requireAuth, requireAdmin, async (req, res) => {
  const { name, reminder_time } = req.body;
  const updates = {};

  if (name !== undefined) updates.name = name.trim();
  if (reminder_time !== undefined) updates.reminder_time = reminder_time;

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  try {
    const updated = await db.updateHouseholdSettings(req.householdId, updates);
    return res.json({ household: updated });
  } catch (err) {
    console.error('PATCH /api/settings error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/household/members/:userId
 * Remove a member from the household. Admin only.
 */
router.delete('/members/:userId', requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.params;

  if (userId === req.user.id) {
    return res.status(400).json({ error: 'You cannot remove yourself from the household.' });
  }

  try {
    // Verify target user belongs to the same household
    const members = await db.getHouseholdMembers(req.householdId);
    const target = members.find((m) => m.id === userId);
    if (!target) {
      return res.status(404).json({ error: 'Member not found in this household.' });
    }

    await db.deleteUser(userId, req.householdId);
    return res.json({ message: 'Member removed.' });
  } catch (err) {
    console.error('DELETE /api/household/members error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
