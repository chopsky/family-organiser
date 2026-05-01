const { Router } = require('express');
const rateLimit = require('express-rate-limit');
// Lazy-load ical-generator via dynamic import — it's ESM-only
let _ical = null;
async function getIcal() {
  if (!_ical) {
    const mod = await import('ical-generator');
    _ical = mod.default;
  }
  return _ical;
}
const db = require('../db/queries');
const { requireAuth } = require('../middleware/auth');
const cache = require('../services/cache');
const push = require('../services/push');
const broadcast = require('../services/broadcast');
const externalFeed = require('../services/externalFeed');
const publicHolidays = require('../services/publicHolidays');

const router = Router();

const VALID_COLORS = [
  // Calendar event colors
  'sage', 'plum', 'coral', 'amber', 'sky', 'rose', 'teal', 'lavender', 'terracotta', 'slate',
  // Profile/member color themes
  'red', 'sunset', 'tangerine', 'gold', 'leaf', 'ocean', 'steel', 'denim', 'iris', 'grape',
  'blush', 'bubblegum', 'cocoa', 'stone', 'charcoal', 'midnight',
];
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
  // End of the last day, inclusive — without the time, PostgREST casts
  // the date string to a timestamp at midnight, which silently excludes
  // any event with a non-midnight start_time on the last day of the
  // month. (Latent bug discovered when an inbound-feed event at 13:30
  // on April 30 didn't render in the April view.)
  // getTasksByDateRange splits on 'T' so the date-only contract is
  // preserved for that caller.
  const endDate = `${year}-${String(mon).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59.999Z`;
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
  validate: false,
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

    const ical = await getIcal();
    const calendar = ical({ name: household.name + ' \u2014 Housemait' });

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

    const { category } = req.query;
    const cacheKey = `cal-events:${req.householdId}:${month}:${category || 'all'}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const events = await db.getCalendarEvents(req.householdId, parsed.startDate, parsed.endDate, {
      userId: req.user.id,
      category: category || undefined,
    });

    // Attach assignees to events
    const eventIds = events.map((e) => e.id);
    const allAssignees = eventIds.length > 0
      ? await db.getEventAssigneesBatch(eventIds)
      : [];
    const assigneesByEvent = {};
    for (const a of allAssignees) {
      if (!assigneesByEvent[a.event_id]) assigneesByEvent[a.event_id] = [];
      assigneesByEvent[a.event_id].push(a);
    }
    for (const event of events) {
      event.assignees = assigneesByEvent[event.id] || [];
    }

    const result = { events };
    cache.set(cacheKey, result, 60); // cache for 60 seconds
    return res.json(result);
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

    const cacheKey = `cal-tasks:${req.householdId}:${month}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const tasks = await db.getTasksByDateRange(req.householdId, parsed.startDate, parsed.endDate);
    const result = { tasks };
    cache.set(cacheKey, result, 60);
    return res.json(result);
  } catch (err) {
    console.error('GET /api/calendar/tasks error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/calendar/search
 * Substring search across events + tasks for the household, with NO
 * date filter. Powers the calendar page's search dropdown — the prior
 * client-side filter only saw events in the currently-loaded ~3-month
 * window, which made it useless for finding anything older or further
 * out than that.
 *
 * Query params:
 *   q     — required, ≥2 chars (single letters waste DB time on giant
 *           result sets; the frontend doesn't fire below 2 chars either)
 *   limit — optional, default 50, capped at 100 by the query helper
 *
 * Returns: { events: Event[], tasks: Task[] } sorted most-recent-first.
 */
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) {
      return res.json({ events: [], tasks: [] });
    }
    const parsedLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 50;
    const results = await db.searchCalendar(req.householdId, q, { limit });
    return res.json(results);
  } catch (err) {
    console.error('GET /api/calendar/search error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/calendar/month
 * Combined endpoint — returns events + tasks for a month in a single request.
 * Query params: month (e.g. "2026-03"), category? (optional)
 */
router.get('/month', async (req, res) => {
  try {
    const { month, category } = req.query;
    if (!month) {
      return res.status(400).json({ error: '"month" query parameter is required (e.g. "2026-03")' });
    }
    const parsed = parseMonth(month);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid month format. Use "YYYY-MM".' });
    }

    const cacheKey = `cal-month:${req.householdId}:${month}:${category || 'all'}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const [events, tasks] = await Promise.all([
      db.getCalendarEvents(req.householdId, parsed.startDate, parsed.endDate, {
        userId: req.user.id,
        category: category || undefined,
      }),
      db.getTasksByDateRange(req.householdId, parsed.startDate, parsed.endDate),
    ]);

    // Attach assignees to events
    const eventIds = events.map((e) => e.id);
    const allAssignees = eventIds.length > 0
      ? await db.getEventAssigneesBatch(eventIds)
      : [];
    const assigneesByEvent = {};
    for (const a of allAssignees) {
      if (!assigneesByEvent[a.event_id]) assigneesByEvent[a.event_id] = [];
      assigneesByEvent[a.event_id].push(a);
    }
    for (const event of events) {
      event.assignees = assigneesByEvent[event.id] || [];
    }

    const result = { events, tasks };
    cache.set(cacheKey, result, 60);
    return res.json(result);
  } catch (err) {
    console.error('GET /api/calendar/month error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/calendar/events
 * Body: { title, start_time, end_time, all_day?, description?, location?, color?, recurrence?, assigned_to_name?, reminders?, assigned_to_names? }
 */
router.post('/events', async (req, res) => {
  const { title, start_time, end_time, all_day, description, location, color, recurrence, assigned_to_name, reminders, assigned_to_names, force } = req.body;

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
    // ── Duplicate detection ──
    // If another member already added the same event on the same date, return
    // 409 and let the client confirm before forcing a second copy. Skipped when
    // the client explicitly passes `force: true`.
    if (!force) {
      const existing = await db.findSimilarEvent(req.householdId, title, start_time);
      if (existing) {
        let creatorName = 'Someone';
        if (existing.created_by) {
          const members = await db.getHouseholdMembers(req.householdId);
          const creator = members.find(m => m.id === existing.created_by);
          if (creator) creatorName = creator.name;
        }
        return res.status(409).json({
          error: 'duplicate',
          message: `${creatorName} already added "${existing.title}" on this date.`,
          existing: {
            id: existing.id,
            title: existing.title,
            start_time: existing.start_time,
            all_day: existing.all_day,
            created_by_name: creatorName,
          },
        });
      }
    }

    const eventData = { title: title.trim(), start_time, end_time };
    if (all_day !== undefined) eventData.all_day = all_day;
    if (description) eventData.description = description;
    if (location) eventData.location = location;
    if (color) eventData.color = color;
    if (recurrence) eventData.recurrence = recurrence;

    if (assigned_to_name) {
      const user = await db.findUserByName(req.householdId, assigned_to_name);
      if (user) {
        eventData.assigned_to = user.id;
        eventData.assigned_to_name = user.name;
      }
    }

    const event = await db.createCalendarEvent(req.householdId, eventData, req.user.id);

    // Save reminders and assignees (fire-and-forget errors to avoid blocking response)
    try {
      if (reminders && Array.isArray(reminders) && reminders.length > 0) {
        await db.saveEventReminders(event.id, req.householdId, reminders, event.start_time);
      }
      if (assigned_to_names && Array.isArray(assigned_to_names) && assigned_to_names.length > 0) {
        await db.saveEventAssignees(event.id, req.householdId, assigned_to_names);
      }
    } catch (err) {
      console.error('Failed to save reminders/assignees:', err.message);
    }

    // Notify household via BOTH channels so we reach members regardless of
    // whether they've registered for iOS push, have WhatsApp linked, or both.
    // Fire-and-forget — a failure in either channel must not block the response.
    (async () => {
      try {
        const members = await db.getHouseholdMembers(req.householdId);
        const creator = members.find(m => m.id === req.user.id);
        const creatorName = creator?.name || 'Someone';
        const pushBody = `${creatorName} added "${event.title}"`;
        push.sendToHousehold(req.householdId, req.user.id, {
          title: 'New event',
          body: pushBody,
          category: 'calendar_reminders',
        }).catch((err) => console.error('[calendar] push failed:', err.message));
        broadcast.toHousehold(req.user.id, members, `📅 ${creatorName} added event: ${event.title}`);
      } catch (err) {
        console.error('[calendar] notify household failed:', err.message);
      }
    })();

    // cal-month is the only one the frontend actually reads (see
    // Calendar.jsx fetchMonth). cal-events / cal-tasks are kept for
    // legacy endpoints that may still be hit by other clients. Without
    // cal-month invalidation here, create/update/delete appeared to
    // silently no-op until the 60-second server cache TTL expired.
    cache.invalidatePattern(`cal-month:${req.householdId}:`);
    cache.invalidatePattern(`cal-events:${req.householdId}:`);
    cache.invalidatePattern(`cal-tasks:${req.householdId}:`);
    cache.invalidate(`digest:${req.householdId}`);
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
  const { color, recurrence, assigned_to_name, reminders, assigned_to_names, ...rest } = req.body;

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
      if (user) {
        updates.assigned_to = user.id;
        updates.assigned_to_name = user.name;
      }
    } else if (assigned_to_name === null) {
      // Explicitly unassign
      updates.assigned_to = null;
      updates.assigned_to_name = null;
    }

    const event = await db.updateCalendarEvent(req.params.id, req.householdId, updates);

    // Re-save reminders and assignees on edit
    try {
      if (reminders !== undefined) {
        await db.saveEventReminders(event.id, req.householdId, reminders || [], event.start_time);
      }
      if (assigned_to_names !== undefined) {
        await db.saveEventAssignees(event.id, req.householdId, assigned_to_names || []);
      }
    } catch (err) {
      console.error('Failed to update reminders/assignees:', err.message);
    }

    // cal-month is the only one the frontend actually reads (see
    // Calendar.jsx fetchMonth). cal-events / cal-tasks are kept for
    // legacy endpoints that may still be hit by other clients. Without
    // cal-month invalidation here, create/update/delete appeared to
    // silently no-op until the 60-second server cache TTL expired.
    cache.invalidatePattern(`cal-month:${req.householdId}:`);
    cache.invalidatePattern(`cal-events:${req.householdId}:`);
    cache.invalidatePattern(`cal-tasks:${req.householdId}:`);
    cache.invalidate(`digest:${req.householdId}`);
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
    // Clean up assignees before soft-deleting
    await db.saveEventAssignees(req.params.id, req.householdId, [], []).catch(() => {});
    await db.deleteCalendarEvent(req.params.id, req.householdId);
    // cal-month is the only one the frontend actually reads (see
    // Calendar.jsx fetchMonth). cal-events / cal-tasks are kept for
    // legacy endpoints that may still be hit by other clients. Without
    // cal-month invalidation here, create/update/delete appeared to
    // silently no-op until the 60-second server cache TTL expired.
    cache.invalidatePattern(`cal-month:${req.householdId}:`);
    cache.invalidatePattern(`cal-events:${req.householdId}:`);
    cache.invalidatePattern(`cal-tasks:${req.householdId}:`);
    cache.invalidate(`digest:${req.householdId}`);
    return res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/calendar/events/:id error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/calendar/deleted
 * List soft-deleted calendar events for the household.
 */
router.get('/deleted', async (req, res) => {
  try {
    const events = await db.getDeletedCalendarEvents(req.householdId);
    return res.json({ events });
  } catch (err) {
    console.error('GET /api/calendar/deleted error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/calendar/:id/restore
 * Restore a soft-deleted calendar event.
 */
router.post('/:id/restore', async (req, res) => {
  try {
    const event = await db.restoreCalendarEvent(req.params.id, req.householdId);
    return res.json({ event });
  } catch (err) {
    console.error('POST /api/calendar/:id/restore error:', err);
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
 * GET /api/calendar/feed-token/status
 * Check whether a feed token already exists for the current user, without
 * creating one. The Settings page calls this on mount so it can surface a
 * mutual-exclusivity warning when a feed and a two-way sync are both
 * active — without auto-creating a feed token just by visiting the page.
 */
router.get('/feed-token/status', async (req, res) => {
  try {
    const token = await db.getFeedTokenIfExists(req.user.id, req.householdId);
    if (!token) return res.json({ exists: false, feedUrl: null });
    const baseUrl = process.env.API_URL || 'http://localhost:3000';
    return res.json({
      exists: true,
      feedUrl: `${baseUrl}/api/calendar/feed/${token.token}.ics`,
    });
  } catch (err) {
    console.error('GET /api/calendar/feed-token/status error:', err);
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

/**
 * DELETE /api/calendar/feed-token
 * Revoke the user's feed token. Used when switching from feed to two-way
 * sync, or from the mutual-exclusivity warning. Idempotent — succeeds
 * even if no token exists.
 */
router.delete('/feed-token', async (req, res) => {
  try {
    await db.deleteFeedToken(req.user.id, req.householdId);
    return res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/calendar/feed-token error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


// ─── External calendar feeds (read-only inbound subscriptions) ──────────────

/**
 * GET /api/calendar/external-feeds
 * List all external feeds visible to the current household. Per-user
 * ownership is tracked but events are household-visible, so the list
 * shows everyone's feeds with the owner's user_id attached so the UI
 * can render attribution.
 */
router.get('/external-feeds', async (req, res) => {
  try {
    const feeds = await db.getExternalFeedsByHousehold(req.householdId);
    return res.json({ feeds });
  } catch (err) {
    console.error('GET /api/calendar/external-feeds error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/calendar/external-feeds
 * Add a new feed and immediately do an initial pull so the user sees
 * events appear within seconds rather than waiting for the cron.
 *
 * Body: { feed_url, display_name, color? }
 *
 * Returns: { feed, refresh: stats } on success.
 *   - 409 if the URL is already subscribed in this household.
 *   - 502 if the initial pull fails (the feed row is still created;
 *     the user can hit "Refresh" once the source comes back).
 */
router.post('/external-feeds', async (req, res) => {
  const { feed_url, display_name, color } = req.body || {};
  if (!feed_url || !display_name) {
    return res.status(400).json({ error: 'feed_url and display_name are required.' });
  }
  const normalisedUrl = externalFeed.normaliseFeedUrl(feed_url);
  if (!/^https?:\/\//i.test(normalisedUrl)) {
    return res.status(400).json({ error: 'Feed URL must start with https://, http://, or webcal://.' });
  }

  let feed;
  try {
    feed = await db.createExternalFeed({
      user_id: req.user.id,
      household_id: req.householdId,
      feed_url: normalisedUrl,
      display_name: display_name.trim().slice(0, 200),
      color: color || 'sky',
    });
  } catch (err) {
    // Unique violation on (household_id, feed_url) — friendlier message.
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'Someone in your household has already subscribed to this URL.' });
    }
    console.error('POST /api/calendar/external-feeds error:', err);
    return res.status(500).json({ error: err.message || 'Could not add feed.' });
  }

  // Initial pull. If it fails, we still return the feed so the user can
  // see it in their list and retry later — they shouldn't lose the URL
  // they pasted just because the source is temporarily down.
  let refresh = null;
  let refreshError = null;
  try {
    refresh = await externalFeed.refreshFeed(feed);
  } catch (err) {
    refreshError = err.message || String(err);
  }

  if (refreshError) {
    return res.status(502).json({ feed, refresh: null, error: refreshError });
  }
  return res.json({ feed, refresh });
});

/**
 * POST /api/calendar/external-feeds/:id/refresh
 * Manually pull the feed now. Useful while we don't have a cron, and
 * stays useful after the cron exists for "I just added an event in
 * Apple Calendar, give it to me now" moments.
 */
router.post('/external-feeds/:id/refresh', async (req, res) => {
  const feed = await db.getExternalFeedById(req.params.id);
  if (!feed || feed.household_id !== req.householdId) {
    return res.status(404).json({ error: 'Feed not found.' });
  }
  try {
    const refresh = await externalFeed.refreshFeed(feed);
    return res.json({ refresh });
  } catch (err) {
    // Surface Postgres' detail/hint/code in the response so dup-key-style
    // errors are diagnosable without trawling through the API logs.
    console.error(`POST /api/calendar/external-feeds/${feed.id}/refresh error:`, err);
    return res.status(502).json({
      error: err.message || 'Refresh failed.',
      detail: err.details || err.detail || null,
      hint: err.hint || null,
      code: err.code || null,
    });
  }
});

/**
 * DELETE /api/calendar/external-feeds/:id
 * Remove a feed. Events created by this feed are hard-deleted via the
 * ON DELETE CASCADE on calendar_events.external_feed_id — they re-appear
 * if the user re-subscribes.
 */
router.delete('/external-feeds/:id', async (req, res) => {
  const feed = await db.getExternalFeedById(req.params.id);
  if (!feed || feed.household_id !== req.householdId) {
    return res.status(404).json({ error: 'Feed not found.' });
  }
  try {
    await db.deleteExternalFeed(feed.id, req.householdId);
    return res.json({ success: true });
  } catch (err) {
    console.error(`DELETE /api/calendar/external-feeds/${feed.id} error:`, err);
    return res.status(500).json({ error: err.message || 'Could not remove feed.' });
  }
});

// ─── POST /api/calendar/seed-holidays ─────────────────────────────────────────
// Seed public holidays for the current household (idempotent — skips duplicates)
router.post('/seed-holidays', requireAuth, async (req, res) => {
  if (!req.householdId) {
    return res.status(400).json({ error: 'No household' });
  }
  try {
    const household = await db.getHouseholdById(req.householdId);
    const countryCode = publicHolidays.countryFromTimezone(household.timezone);
    if (!countryCode) {
      return res.status(400).json({ error: `Cannot determine country from timezone "${household.timezone}". Please update your household timezone in settings.` });
    }
    const currentYear = new Date().getFullYear();
    const count1 = await publicHolidays.insertHolidaysForHousehold(req.householdId, countryCode, currentYear, req.user.id);
    const count2 = await publicHolidays.insertHolidaysForHousehold(req.householdId, countryCode, currentYear + 1, req.user.id);
    return res.json({ inserted: count1 + count2, country: countryCode });
  } catch (err) {
    console.error('POST /seed-holidays error:', err);
    return res.status(500).json({ error: 'Failed to seed holidays' });
  }
});

module.exports = router;
