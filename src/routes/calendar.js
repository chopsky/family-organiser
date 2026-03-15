const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const ical = require('ical-generator').default;
const db = require('../db/queries');
const { requireAuth } = require('../middleware/auth');
const calendarSync = require('../services/calendarSync');
const googleProvider = require('../services/providers/google');
const microsoftProvider = require('../services/providers/microsoft');
const appleProvider = require('../services/providers/apple');

const router = Router();

const VALID_COLORS = ['orange', 'blue', 'green', 'purple', 'red', 'gray'];
const VALID_RECURRENCES = ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'];

/**
 * Parse a "YYYY-MM" month string into start and end date strings.
 * Returns { startDate, endDate } where endDate is the last day of the month.
 */
function parseMonth(month) {
  const [year, mon] = month.split('-').map(Number);
  if (!year || !mon || mon < 1 || mon > 12) return null;
  const startDate = `${year}-${String(mon).padStart(2, '0')}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const endDate = `${year}-${String(mon).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { startDate, endDate };
}

// ---------------------------------------------------------------------------
// Public feed endpoint (no auth) — must be defined before router.use(requireAuth)
// ---------------------------------------------------------------------------

const feedLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 60,
  keyGenerator: (req) => `${req.params.token}`,
  message: { error: 'Too many requests, please try again later' },
  validate: { xForwardedForHeader: false, default: true },
});

/**
 * GET /api/calendar/feed/:token.ics
 * Public iCal feed — no authentication required.
 */
router.get('/feed/:token.ics', feedLimiter, async (req, res) => {
  try {
    const tokenData = await db.getFeedTokenData(req.params.token);
    if (!tokenData) {
      return res.status(404).json({ error: 'Feed not found' });
    }

    const household = await db.getHouseholdById(tokenData.household_id);
    const { events, tasks } = await db.getAllEventsForFeed(tokenData.household_id);

    const calendar = ical({ name: household.name + ' \u2014 Curata' });

    // Add calendar events
    for (const event of events) {
      const vevent = {
        start: new Date(event.start_time),
        end: new Date(event.end_time),
        summary: event.title,
        allDay: event.all_day || false,
      };
      if (event.description) vevent.description = event.description;
      if (event.location) vevent.location = event.location;
      calendar.createEvent(vevent);
    }

    // Add incomplete tasks as all-day events on their due date
    for (const task of tasks) {
      if (task.due_date) {
        calendar.createEvent({
          start: new Date(task.due_date),
          summary: task.title,
          allDay: true,
        });
      }
    }

    res.set('Content-Type', 'text/calendar; charset=utf-8');
    return res.send(calendar.toString());
  } catch (err) {
    console.error('GET /api/calendar/feed error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// OAuth callbacks (no JWT auth — state carries user info)
// ---------------------------------------------------------------------------

/**
 * GET /api/calendar/connect/google/callback
 * Google OAuth2 callback — exchanges code for tokens.
 */
router.get('/connect/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).send('Missing code or state.');
    }

    const { userId, householdId } = JSON.parse(state);
    const tokens = await googleProvider.handleCallback(code);

    await db.upsertCalendarConnection({
      user_id: userId,
      household_id: householdId,
      provider: 'google',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(tokens.expiry_date).toISOString(),
      sync_enabled: true,
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    return res.redirect(`${frontendUrl}/settings?connected=google`);
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    return res.redirect(`${frontendUrl}/settings?error=google_connect_failed`);
  }
});

/**
 * GET /api/calendar/connect/microsoft/callback
 * Microsoft OAuth2 callback — exchanges code for tokens.
 */
router.get('/connect/microsoft/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).send('Missing code or state.');
    }

    const { userId, householdId } = JSON.parse(state);
    const tokens = await microsoftProvider.handleCallback(code);

    await db.upsertCalendarConnection({
      user_id: userId,
      household_id: householdId,
      provider: 'microsoft',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      sync_enabled: true,
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    return res.redirect(`${frontendUrl}/settings?connected=microsoft`);
  } catch (err) {
    console.error('Microsoft OAuth callback error:', err);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    return res.redirect(`${frontendUrl}/settings?error=microsoft_connect_failed`);
  }
});

// ---------------------------------------------------------------------------
// Webhooks — public endpoints for external calendar push notifications
// ---------------------------------------------------------------------------

/**
 * POST /api/calendar/webhooks/google
 * Google Calendar push notification handler.
 */
router.post('/webhooks/google', async (req, res) => {
  try {
    const channelToken = req.headers['x-goog-channel-token'];
    if (!channelToken) {
      return res.status(200).end();
    }

    const [connectionId] = channelToken.split(':');
    if (connectionId) {
      const connections = await db.getConnectionsByHousehold(null);
      const connection = connections.find(c => c.id === connectionId);
      if (connection) {
        calendarSync.pullChangesFromProvider(connection).catch(err => {
          console.error('Google webhook pull error:', err);
        });
      }
    }

    return res.status(200).end();
  } catch (err) {
    console.error('Google webhook error:', err);
    return res.status(200).end();
  }
});

/**
 * POST /api/calendar/webhooks/microsoft
 * Microsoft Graph subscription notification handler.
 */
router.post('/webhooks/microsoft', async (req, res) => {
  if (req.query.validationToken) {
    return res.status(200).set('Content-Type', 'text/plain').send(req.query.validationToken);
  }

  try {
    const notifications = req.body?.value || [];
    for (const notification of notifications) {
      if (notification.clientState) {
        const [connectionId] = notification.clientState.split(':');
        const connections = await db.getConnectionsByHousehold(null);
        const connection = connections.find(c => c.id === connectionId);
        if (connection) {
          calendarSync.pullChangesFromProvider(connection).catch(err => {
            console.error('Microsoft webhook pull error:', err);
          });
        }
      }
    }

    return res.status(202).end();
  } catch (err) {
    console.error('Microsoft webhook error:', err);
    return res.status(202).end();
  }
});

// ---------------------------------------------------------------------------
// All other routes require auth
// ---------------------------------------------------------------------------
router.use(requireAuth);

/**
 * GET /api/calendar/events
 * Query params: month (e.g. "2026-03")
 */
router.get('/events', async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) {
      return res.status(400).json({ error: '"month" query parameter is required (e.g. "2026-03")' });
    }

    const parsed = parseMonth(month);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid month format. Use "YYYY-MM".' });
    }

    const events = await db.getCalendarEvents(req.householdId, parsed.startDate, parsed.endDate);
    return res.json({ events });
  } catch (err) {
    console.error('GET /api/calendar/events error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/calendar/tasks
 * Query params: month (e.g. "2026-03")
 */
router.get('/tasks', async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) {
      return res.status(400).json({ error: '"month" query parameter is required (e.g. "2026-03")' });
    }

    const parsed = parseMonth(month);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid month format. Use "YYYY-MM".' });
    }

    const tasks = await db.getTasksByDateRange(req.householdId, parsed.startDate, parsed.endDate);
    return res.json({ tasks });
  } catch (err) {
    console.error('GET /api/calendar/tasks error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/calendar/events
 * Body: { title, start_time, end_time, all_day?, description?, location?, color?, recurrence?, assigned_to_name? }
 */
router.post('/events', async (req, res) => {
  const { title, start_time, end_time, all_day, description, location, color, recurrence, assigned_to_name } = req.body;

  if (!title?.trim()) {
    return res.status(400).json({ error: '"title" is required' });
  }
  if (!start_time) {
    return res.status(400).json({ error: '"start_time" is required' });
  }
  if (!end_time) {
    return res.status(400).json({ error: '"end_time" is required' });
  }
  if (color && !VALID_COLORS.includes(color)) {
    return res.status(400).json({ error: `Invalid color "${color}". Must be one of: ${VALID_COLORS.join(', ')}` });
  }
  if (recurrence && !VALID_RECURRENCES.includes(recurrence)) {
    return res.status(400).json({ error: `Invalid recurrence "${recurrence}". Must be one of: ${VALID_RECURRENCES.join(', ')}` });
  }

  try {
    const eventData = { title: title.trim(), start_time, end_time };
    if (all_day !== undefined) eventData.all_day = all_day;
    if (description) eventData.description = description;
    if (location) eventData.location = location;
    if (color) eventData.color = color;
    if (recurrence) eventData.recurrence = recurrence;

    if (assigned_to_name) {
      const user = await db.findUserByName(req.householdId, assigned_to_name);
      if (user) eventData.assigned_to = user.id;
    }

    const event = await db.createCalendarEvent(req.householdId, eventData, req.user.id);

    // Push to connected external calendars (fire-and-forget)
    calendarSync.pushEventToConnections(req.householdId, event, 'create').catch(() => {});

    return res.status(201).json({ event });
  } catch (err) {
    console.error('POST /api/calendar/events error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/calendar/events/:id
 * Body: any subset of event fields
 */
router.patch('/events/:id', async (req, res) => {
  const { color, recurrence, assigned_to_name, ...rest } = req.body;

  if (color && !VALID_COLORS.includes(color)) {
    return res.status(400).json({ error: `Invalid color "${color}". Must be one of: ${VALID_COLORS.join(', ')}` });
  }
  if (recurrence && !VALID_RECURRENCES.includes(recurrence)) {
    return res.status(400).json({ error: `Invalid recurrence "${recurrence}". Must be one of: ${VALID_RECURRENCES.join(', ')}` });
  }

  try {
    const updates = { ...rest };
    if (color) updates.color = color;
    if (recurrence !== undefined) updates.recurrence = recurrence;

    if (assigned_to_name) {
      const user = await db.findUserByName(req.householdId, assigned_to_name);
      if (user) updates.assigned_to = user.id;
    }

    const event = await db.updateCalendarEvent(req.params.id, req.householdId, updates);

    // Push update to connected external calendars (fire-and-forget)
    calendarSync.pushEventToConnections(req.householdId, event, 'update').catch(() => {});

    return res.json({ event });
  } catch (err) {
    console.error('PATCH /api/calendar/events/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/calendar/events/:id
 */
router.delete('/events/:id', async (req, res) => {
  try {
    // Push delete to connected external calendars before removing from DB
    calendarSync.pushEventToConnections(req.householdId, { id: req.params.id }, 'delete').catch(() => {});

    await db.deleteCalendarEvent(req.params.id, req.householdId);
    return res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/calendar/events/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/calendar/feed-token
 * Get or create a feed token for the current user.
 */
router.get('/feed-token', async (req, res) => {
  try {
    const token = await db.getOrCreateFeedToken(req.user.id, req.householdId);
    const baseUrl = process.env.API_URL || 'http://localhost:3000';
    const feedUrl = `${baseUrl}/api/calendar/feed/${token.token}.ics`;
    return res.json({ token: token.token, feedUrl });
  } catch (err) {
    console.error('GET /api/calendar/feed-token error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/calendar/feed-token
 * Regenerate the feed token for the current user.
 */
router.post('/feed-token', async (req, res) => {
  try {
    const token = await db.regenerateFeedToken(req.user.id, req.householdId);
    const baseUrl = process.env.API_URL || 'http://localhost:3000';
    const feedUrl = `${baseUrl}/api/calendar/feed/${token.token}.ics`;
    return res.json({ token: token.token, feedUrl });
  } catch (err) {
    console.error('POST /api/calendar/feed-token error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Calendar connections — list, connect, disconnect
// ---------------------------------------------------------------------------

/**
 * GET /api/calendar/connections
 * List the current user's calendar connections.
 */
router.get('/connections', async (req, res) => {
  try {
    const connections = await db.getCalendarConnections(req.user.id);
    // Strip tokens from response
    const safe = connections.map(({ access_token, refresh_token, ...c }) => c);
    return res.json({ connections: safe });
  } catch (err) {
    console.error('GET /api/calendar/connections error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/calendar/connect/google
 * Redirect user to Google OAuth2 consent screen.
 */
router.get('/connect/google', (req, res) => {
  try {
    const url = googleProvider.getAuthUrl(req.user.id, req.householdId);
    return res.json({ url });
  } catch (err) {
    console.error('GET /api/calendar/connect/google error:', err);
    return res.status(500).json({ error: 'Could not generate Google auth URL' });
  }
});

/**
 * GET /api/calendar/connect/microsoft
 * Redirect user to Microsoft OAuth2 consent screen.
 */
router.get('/connect/microsoft', (req, res) => {
  try {
    const url = microsoftProvider.getAuthUrl(req.user.id, req.householdId);
    return res.json({ url });
  } catch (err) {
    console.error('GET /api/calendar/connect/microsoft error:', err);
    return res.status(500).json({ error: 'Could not generate Microsoft auth URL' });
  }
});

/**
 * POST /api/calendar/connect/apple
 * Connect Apple Calendar via CalDAV credentials.
 * Body: { email, appPassword }
 */
router.post('/connect/apple', async (req, res) => {
  const { email, appPassword } = req.body;
  if (!email || !appPassword) {
    return res.status(400).json({ error: 'Email and app-specific password are required.' });
  }
  try {
    const result = await appleProvider.validateCredentials(email, appPassword);
    if (!result.valid) {
      return res.status(400).json({ error: result.error || 'Invalid credentials.' });
    }

    await db.upsertCalendarConnection({
      user_id: req.user.id,
      household_id: req.householdId,
      provider: 'apple',
      access_token: appPassword,
      caldav_username: email,
      sync_enabled: true,
    });

    return res.json({ success: true, message: 'Apple Calendar connected.' });
  } catch (err) {
    console.error('POST /api/calendar/connect/apple error:', err);
    return res.status(500).json({ error: 'Could not connect Apple Calendar.' });
  }
});

/**
 * DELETE /api/calendar/connections/:provider
 * Disconnect a calendar provider.
 */
router.delete('/connections/:provider', async (req, res) => {
  const { provider } = req.params;
  if (!['google', 'microsoft', 'apple'].includes(provider)) {
    return res.status(400).json({ error: 'Invalid provider.' });
  }
  try {
    await db.deleteCalendarConnection(req.user.id, provider);
    return res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/calendar/connections error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
