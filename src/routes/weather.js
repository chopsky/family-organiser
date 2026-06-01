const { Router } = require('express');
const db = require('../db/queries');
const { requireAuth, requireHousehold } = require('../middleware/auth');
const { getWeatherWidget } = require('../services/weather-widget');

const router = Router();

/**
 * GET /api/weather/widget
 * Payload for the Home-screen WeatherStrip: current conditions, a 24-hour
 * forward forecast, and a context-aware AI note tying the weather to
 * today's calendar.
 *
 * Returns { available: false, reason } when the household has no address
 * set or the upstream is down, so the UI can render nothing cleanly.
 */
router.get('/widget', requireAuth, requireHousehold, async (req, res) => {
  try {
    const household = await db.getHouseholdById(req.householdId);
    if (!household) return res.json({ available: false, reason: 'no_household' });

    // Today's calendar events feed the AI note. Scope to the household's
    // local day. Soft-fail to an empty list - the note generator just
    // omits the row when there are no timed events, so a calendar hiccup
    // degrades to "weather without a note" rather than a 500.
    let events = [];
    try {
      const tz = household.timezone || 'Europe/London';
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: tz });
      events = await db.getCalendarEvents(
        req.householdId,
        `${todayStr}T00:00:00`,
        `${todayStr}T23:59:59`,
        { userId: req.user.id },
      ) || [];
    } catch (e) {
      console.warn('[weather/widget] event fetch failed:', e.message);
    }

    const payload = await getWeatherWidget(household, { userId: req.user.id, events });
    return res.json(payload);
  } catch (err) {
    console.error('GET /api/weather/widget error:', err);
    return res.status(500).json({ available: false, reason: 'error' });
  }
});

module.exports = router;
