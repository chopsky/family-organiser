const { Router } = require('express');
const db = require('../db/queries');
const { requireAuth, requireHousehold } = require('../middleware/auth');

const router = Router();

const DEFAULT_PREFERENCES = {
  calendar_reminders: true,
  task_assigned: true,
  shopping_updated: true,
  meal_plan_updated: true,
  family_activity: true,
};

/**
 * POST /api/notifications/register-device
 * Register a device push token for the current user.
 *
 * Body: { token, platform? }  (platform defaults to 'ios')
 */
router.post('/register-device', requireAuth, requireHousehold, async (req, res) => {
  const { token, platform = 'ios' } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'token is required' });
  }

  try {
    await db.registerDeviceToken(req.user.id, req.household.id, token, platform);
    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/notifications/register-device error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/notifications/unregister-device
 * Remove a device push token.
 *
 * Body: { token }
 */
router.post('/unregister-device', requireAuth, async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'token is required' });
  }

  try {
    await db.unregisterDeviceToken(token);
    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/notifications/unregister-device error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/notifications/preferences
 * Get notification preferences for the current user.
 */
router.get('/preferences', requireAuth, async (req, res) => {
  try {
    const prefs = await db.getNotificationPreferences(req.user.id);
    return res.json(prefs || DEFAULT_PREFERENCES);
  } catch (err) {
    console.error('GET /api/notifications/preferences error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/notifications/preferences
 * Create or update notification preferences for the current user.
 *
 * Body: partial or full preferences object
 */
router.put('/preferences', requireAuth, async (req, res) => {
  try {
    await db.upsertNotificationPreferences(req.user.id, req.body);
    return res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/notifications/preferences error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
