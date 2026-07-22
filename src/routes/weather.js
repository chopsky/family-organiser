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
 * Optional ?lat= & ?lon= query params carry the device's GPS location from
 * the iOS app. When present they're the primary location source; otherwise
 * the household address is used as a fallback.
 *
 * Returns { available: false, reason } when there's no device location and
 * no address set, or the upstream is down, so the UI can render nothing
 * cleanly (or prompt the user to enable location).
 */
router.get('/widget', requireAuth, requireHousehold, async (req, res) => {
  try {
    const household = await db.getHouseholdById(req.householdId);
    if (!household) return res.json({ available: false, reason: 'no_household' });

    // Device GPS coords (primary). Parse defensively — bad params fall back
    // to the household address rather than erroring.
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    const coords = (Number.isFinite(lat) && Number.isFinite(lon)) ? { lat, lon } : null;

    // Persist the shared location so the WhatsApp morning brief (a server cron
    // with no device) can fall back to it - the brief prefers a fresh shared
    // location, then the typed home address. Fire-and-forget: never blocks or
    // fails the widget response.
    if (coords) {
      db.updateUserLocation(req.user.id, lat, lon).catch((e) =>
        console.warn('[weather/widget] persist location failed:', e.message));
    }

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

    const payload = await getWeatherWidget(household, { userId: req.user.id, events, coords });
    return res.json(payload);
  } catch (err) {
    console.error('GET /api/weather/widget error:', err);
    return res.status(500).json({ available: false, reason: 'error' });
  }
});

module.exports = router;
