const { Router } = require('express');
const db = require('../db/queries');
const push = require('../services/push');
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
    // requireHousehold sets req.householdId (the string), not req.household
    // (an object). Previous code did req.household.id which threw 'Cannot
    // read properties of undefined', surfacing as a 500 to the client and
    // an empty device_tokens table — the only reason push notifications
    // didn't work for any iOS user since this endpoint was added.
    await db.registerDeviceToken(req.user.id, req.householdId, token, platform);
    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/notifications/register-device error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/notifications/test
 * Send a test push notification to the current user's registered devices,
 * delayed by 5 seconds so the user has time to lock their phone or
 * background the app and see the actual system banner (iOS suppresses
 * banners while the app is in foreground).
 *
 * Returns immediately so the UI can show "scheduled" feedback without
 * blocking.
 */
router.post('/test', requireAuth, async (req, res) => {
  // Acknowledge immediately. The push fires 5s later (see below).
  res.json({ ok: true, scheduled: true, delaySeconds: 5 });

  setTimeout(async () => {
    try {
      const result = await push.sendToUser(req.user.id, {
        title: 'Test from Housemait',
        body: 'If you can see this, push notifications are working.',
        category: 'family_activity',
      });
      console.log('[push] test push fired for user', req.user.id, '— result:', result);
    } catch (err) {
      console.error('[push] test push error:', err.message);
    }
  }, 5000);
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
