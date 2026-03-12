const { Router } = require('express');
const db = require('../db/queries');
const { signToken } = require('../middleware/auth');

const router = Router();

/**
 * POST /api/auth/join
 * Join a household with a 6-character code.
 * Creates a new web user (no telegram_chat_id) if the name isn't already in the household.
 *
 * Body: { code: string, name: string }
 * Returns: { token, user, household }
 */
router.post('/join', async (req, res) => {
  const { code, name } = req.body;

  if (!code || !name?.trim()) {
    return res.status(400).json({ error: 'code and name are required' });
  }

  try {
    const household = await db.getHouseholdByCode(code.trim().toUpperCase());
    if (!household) {
      return res.status(404).json({ error: 'No household found with that code' });
    }

    // Check if a user with this name already exists in the household (web re-login)
    const members = await db.getHouseholdMembers(household.id);
    let user = members.find((m) => m.name.toLowerCase() === name.trim().toLowerCase());

    if (!user) {
      user = await db.createUser({
        householdId: household.id,
        name: name.trim(),
        telegramChatId: null,
        telegramUsername: null,
        role: members.length === 0 ? 'admin' : 'member',
      });
    }

    const token = signToken({
      userId: user.id,
      householdId: household.id,
      name: user.name,
      role: user.role,
    });

    return res.json({
      token,
      user: { id: user.id, name: user.name, role: user.role },
      household: { id: household.id, name: household.name, join_code: household.join_code },
    });
  } catch (err) {
    console.error('POST /api/auth/join error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
