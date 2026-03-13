const { Router } = require('express');
const crypto = require('crypto');
const db = require('../db/queries');
const { requireAuth, requireAdmin, requireHousehold } = require('../middleware/auth');
const email = require('../services/email');

const router = Router();

/**
 * GET /api/household
 * Returns household info + members list.
 */
router.get('/', requireAuth, requireHousehold, async (req, res) => {
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
router.patch('/settings', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
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
router.delete('/members/:userId', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
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

/**
 * POST /api/household/invite
 * Send an email invite to join the household. Admin only.
 */
router.post('/invite', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  const { email: inviteEmail } = req.body;

  if (!inviteEmail?.trim()) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const household = await db.getHouseholdById(req.householdId);
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    await db.createInvite({
      householdId: req.householdId,
      email: inviteEmail.trim().toLowerCase(),
      token,
      invitedBy: req.user.id,
      expiresAt,
    });

    try {
      await email.sendInviteEmail(inviteEmail.trim(), req.user.name, household.name, token);
    } catch (emailErr) {
      console.error('Failed to send invite email:', emailErr);
    }

    return res.json({ message: 'Invite sent.' });
  } catch (err) {
    console.error('POST /api/household/invite error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/household/invites
 * List pending invites for the household. Admin only.
 */
router.get('/invites', requireAuth, requireHousehold, requireAdmin, async (req, res) => {
  try {
    const invites = await db.getPendingInvites(req.householdId);
    return res.json({ invites });
  } catch (err) {
    console.error('GET /api/household/invites error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
