const { Router } = require('express');
const rateLimit = require('express-rate-limit');
// Lazy-load ical-generator. v10 is dual-format (the old "ESM-only" dynamic
// import was stale and also broke under Jest's CJS runtime), so a plain
// require works; kept lazy + async-shaped so call sites are unchanged.
let _ical = null;
async function getIcal() {
  if (!_ical) {
    const mod = require('ical-generator');
    _ical = mod.default || mod;
  }
  return _ical;
}
const db = require('../db/queries');
const { requireAuth } = require('../middleware/auth');
const deviceCalendarSync = require('../services/deviceCalendarSync');
const cache = require('../services/cache');
const push = require('../services/push');
const broadcast = require('../services/broadcast');
const externalFeed = require('../services/externalFeed');
const publicHolidays = require('../services/publicHolidays');
const { formatEventWhen } = require('../utils/event-when');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const r2 = require('../services/r2');
const { validateUpload, normaliseFilename } = require('../utils/fileValidation');

const router = Router();

// Event attachments: in-memory multer, 25 MB cap (same as documents). Type
// allowlist + magic-byte sniffing happens in validateUpload after parsing.
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// All colours that may appear as an event's `color`. The full surface
// area is union of three sources:
//   1. Original built-in event colours (sage, plum, ...).
//   2. The 16-colour member-theme palette defined in db/queries.js
//      COLOR_THEMES (so an event coloured by its first assignee's theme
//      can store any of those values).
//   3. Legacy profile-theme names kept for back-compat with rows
//      created before the palette was unified.
// Keep this in sync with the calendar_events.color CHECK constraint
// in migration-color-palette-unify.sql - the route validator and the
// DB constraint MUST accept the same set or we get a sneaky "Invalid
// color X" 400 on edit + the dishonest "Could not save event" banner.
const VALID_COLORS = [
  // Original event colours
  'sage', 'plum', 'coral', 'amber', 'sky', 'rose', 'teal', 'lavender', 'terracotta', 'slate',
  // 16-colour canonical member palette (matches db/queries.js COLOR_THEMES)
  'red', 'burnt-orange', 'gold', 'leaf', 'emerald', 'cobalt', 'indigo', 'purple', 'magenta', 'moss',
  // Legacy profile theme names retained for back-compat
  'sunset', 'tangerine', 'ocean', 'steel', 'denim', 'iris', 'grape',
  'blush', 'bubblegum', 'cocoa', 'stone', 'charcoal', 'midnight',
];
const VALID_RECURRENCES = ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'];

/**
 * Defence-in-depth guard against an event whose end falls before its start
 * (e.g. start 15:00, end 10:00 on the same day). The web form already blocks
 * this, but the AI / email / bulk-paste ingestion paths hit these routes
 * directly, so we enforce it server-side too.
 *
 * Returns an error string when the range is inverted, else null. We compare
 * strictly (`end < start`) rather than `<=` so a legitimate all-day event
 * stored with equal start/end timestamps (some sources use midnight for both)
 * is never rejected. Absent or unparseable timestamps are left to the
 * existing required-field checks.
 */
function timeRangeError(start_time, end_time) {
  if (!start_time || !end_time) return null;
  const start = new Date(start_time);
  const end = new Date(end_time);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (end < start) return 'The event end can’t be before its start.';
  return null;
}

/**
 * Parse a "YYYY-MM" month string into start and end date strings.
 * Returns { startDate, endDate } where endDate is the last day of the month.
 */
function parseMonth(month) {
  const [year, mon] = month.split('-').map(Number);
  if (!year || !mon || mon < 1 || mon > 12) return null;
  const startDate = `${year}-${String(mon).padStart(2, '0')}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  // End of the last day, inclusive - without the time, PostgREST casts
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
// Public feed endpoint (no auth) - must be defined before router.use(requireAuth)
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
 * Public iCal feed - no authentication required.
 */
router.get('/feed/:token.ics', feedLimiter, async (req, res) => {
  try {
    const tokenData = await db.getFeedTokenData(req.params.token);
    if (!tokenData) {
      return res.status(404).json({ error: 'Feed not found' });
    }

    const household = await db.getHouseholdById(tokenData.household_id);
    const { events, tasks } = await db.getAllEventsForFeed(tokenData.household_id, tokenData.user_id);

    const ical = await getIcal();
    const calendar = ical({ name: household.name + ' \u2014 Housemait' });

    // Add calendar events. The explicit, row-id-based UID is load-bearing:
    // without it ical-generator mints a RANDOM UID on every request, so
    // subscribers' calendar apps saw the entire Housemait calendar deleted
    // and recreated on each refresh (breaking their caching/busy-time
    // handling). Stable UIDs also let future inbound integrations recognise
    // and skip Housemait's own events (echo-loop guard).
    for (const event of events) {
      const vevent = {
        id: `housemait-evt-${event.id}@housemait.com`,
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
          id: `housemait-task-${task.id}@housemait.com`,
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
      birthdays: true,
    });

    // Attach assignees to events (synthesised birthdays have non-uuid ids and
    // no assignees - keep them out of the uuid-typed batch query).
    const eventIds = events.filter((e) => e.category !== 'birthday').map((e) => e.id);
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
 * date filter. Powers the calendar page's search dropdown - the prior
 * client-side filter only saw events in the currently-loaded ~3-month
 * window, which made it useless for finding anything older or further
 * out than that.
 *
 * Query params:
 *   q     - required, ≥2 chars (single letters waste DB time on giant
 *           result sets; the frontend doesn't fire below 2 chars either)
 *   limit - optional, default 50, capped at 100 by the query helper
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
 * Combined endpoint - returns events + tasks for a month in a single request.
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
        birthdays: true,
      }),
      db.getTasksByDateRange(req.householdId, parsed.startDate, parsed.endDate),
    ]);

    // Attach assignees + reminders to events. Both are stored in
    // separate tables so we batch-fetch them by event_id and group
    // client-side. The Edit Event modal reads ev.reminders to populate
    // the notification dropdown - without this join the modal opened
    // empty even when a reminder was saved (real bug from prod).
    const eventIds = events.filter((e) => e.category !== 'birthday').map((e) => e.id);
    const [allAssignees, allReminders] = await Promise.all([
      eventIds.length > 0 ? db.getEventAssigneesBatch(eventIds) : Promise.resolve([]),
      eventIds.length > 0 ? db.getEventRemindersBatch(eventIds) : Promise.resolve([]),
    ]);
    const assigneesByEvent = {};
    for (const a of allAssignees) {
      if (!assigneesByEvent[a.event_id]) assigneesByEvent[a.event_id] = [];
      assigneesByEvent[a.event_id].push(a);
    }
    const remindersByEvent = {};
    for (const r of allReminders) {
      if (!remindersByEvent[r.event_id]) remindersByEvent[r.event_id] = [];
      remindersByEvent[r.event_id].push({ time: r.time, unit: r.unit });
    }
    for (const event of events) {
      event.assignees = assigneesByEvent[event.id] || [];
      event.reminders = remindersByEvent[event.id] || [];
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
 * Body: { title, start_time, end_time, all_day?, description?, location?,
 *         color?, recurrence?, assigned_to_names?: string[], reminders? }
 *
 * `assigned_to_names` is an array of household member names. Names not
 * in the household are dropped silently. Empty array (or omitted) means
 * "no specific person" - shown as a household event.
 */
router.post('/events', async (req, res) => {
  const { title, start_time, end_time, all_day, description, location, color, recurrence, reminders, assigned_to_names, force } = req.body;

  if (!title?.trim()) {
    return res.status(400).json({ error: '"title" is required' });
  }
  if (!start_time) {
    return res.status(400).json({ error: '"start_time" is required' });
  }
  if (!end_time) {
    return res.status(400).json({ error: '"end_time" is required' });
  }
  const postRangeError = timeRangeError(start_time, end_time);
  if (postRangeError) {
    return res.status(400).json({ error: postRangeError });
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

    // Resolve assignee names → parallel id + name arrays. createCalendarEvent
    // writes both arrays to the calendar_events row.
    if (Array.isArray(assigned_to_names) && assigned_to_names.length > 0) {
      const members = await db.getHouseholdMembers(req.householdId);
      const { ids, names } = db.resolveAssignees(assigned_to_names, members);
      eventData.assigned_to_ids = ids;
      eventData.assigned_to_names = names;
    }

    const event = await db.createCalendarEvent(req.householdId, eventData, req.user.id);

    // Save reminders + event_assignees (the separate per-person reminder
    // system - independent of the calendar_events.assigned_to_ids
    // column, which drives the calendar chip + dashboard filter).
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
    // Fire-and-forget - a failure in either channel must not block the response.
    (async () => {
      try {
        const [members, household] = await Promise.all([
          db.getHouseholdMembers(req.householdId),
          db.getHouseholdById(req.householdId).catch(() => null),
        ]);
        const creator = members.find(m => m.id === req.user.id);
        const creatorName = creator?.name || 'Someone';
        const tz = household?.timezone || 'Europe/London';
        const when = formatEventWhen(event, tz);
        const { assigneeBracket } = require('../utils/notification-format');
        const who = assigneeBracket(event.assigned_to_names);
        // "Padel - Sat 30 May, 10:00-11:00 (for Grant)" - title +
        // when + assignee bracket. Each piece is optional, so the
        // suffix degrades gracefully: an undated everyone-event just
        // reads "Padel".
        const titleWithWhen = `${event.title}${when ? ` - ${when}` : ''}${who}`;
        const pushBody = `${creatorName} added "${titleWithWhen}"`;
        push.sendToHousehold(req.householdId, req.user.id, {
          title: 'New event',
          body: pushBody,
          category: 'calendar_reminders',
        }).catch((err) => console.error('[calendar] push failed:', err.message));
        broadcast.toHousehold(req.user.id, members, `📅 ${creatorName} added event: ${titleWithWhen}`);
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
  const { color, recurrence, reminders, assigned_to_names, ...rest } = req.body;

  if (color && !VALID_COLORS.includes(color)) {
    return res.status(400).json({ error: `Invalid color "${color}". Must be one of: ${VALID_COLORS.join(', ')}` });
  }
  if (recurrence && !VALID_RECURRENCES.includes(recurrence)) {
    return res.status(400).json({ error: `Invalid recurrence "${recurrence}". Must be one of: ${VALID_RECURRENCES.join(', ')}` });
  }

  try {
    const existing = await db.getCalendarEventById(req.params.id, req.householdId);

    // Synced copies are read-only: an edit would "succeed" and then be
    // silently overwritten by the next sync/refresh of the source calendar -
    // the most confusing possible outcome. Push the user to the source.
    if (existing?.external_feed_id) {
      return res.status(409).json({
        error: 'This event syncs from an external calendar. Edit it in the source calendar and the change will appear here automatically.',
        synced: true,
      });
    }

    // When a time is being changed, validate the resulting range against the
    // unchanged side too - a PATCH may move only the start or only the end.
    if (rest.start_time !== undefined || rest.end_time !== undefined) {
      const effStart = rest.start_time !== undefined ? rest.start_time : existing?.start_time;
      const effEnd = rest.end_time !== undefined ? rest.end_time : existing?.end_time;
      const patchRangeError = timeRangeError(effStart, effEnd);
      if (patchRangeError) {
        return res.status(400).json({ error: patchRangeError });
      }
    }

    const updates = { ...rest };
    if (color) updates.color = color;
    if (recurrence !== undefined) updates.recurrence = recurrence;

    // Replace the full assignee list. Passing [] clears it (= no specific
    // person). undefined means "don't touch".
    if (assigned_to_names !== undefined) {
      const members = await db.getHouseholdMembers(req.householdId);
      const { ids, names } = db.resolveAssignees(assigned_to_names || [], members);
      updates.assigned_to_ids = ids;
      updates.assigned_to_names = names;
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
    // Synced copies are read-only: a "delete" would resurrect on the next
    // sync/refresh of the source calendar. Removing the whole calendar is
    // done from Settings; removing one event is done in the source calendar.
    const existing = await db.getCalendarEventById(req.params.id, req.householdId);
    if (existing?.external_feed_id) {
      return res.status(409).json({
        error: 'This event syncs from an external calendar. Delete it in the source calendar and it will disappear here automatically.',
        synced: true,
      });
    }

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
    // Null covers not-found, not-deleted AND synced (external_feed_id) rows -
    // restoring a feed-pruned copy would resurrect an event its source
    // calendar cancelled, so the query refuses to match them.
    if (!event) return res.status(404).json({ error: 'Event not found or cannot be restored.' });
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
 * active - without auto-creating a feed token just by visiting the page.
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
 * sync, or from the mutual-exclusivity warning. Idempotent - succeeds
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
    // Unique violation on (household_id, feed_url) - friendlier message.
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'Someone in your household has already subscribed to this URL.' });
    }
    console.error('POST /api/calendar/external-feeds error:', err);
    return res.status(500).json({ error: err.message || 'Could not add feed.' });
  }

  // Initial pull. If it fails, we still return the feed so the user can
  // see it in their list and retry later - they shouldn't lose the URL
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
  // Device-sourced links have synthetic device:// URLs - there is nothing
  // server-side to fetch. Freshness comes from the owner's phone syncing.
  if (feed.source === 'device') {
    return res.status(400).json({ error: "This calendar syncs from a phone, not a URL. Open Housemait on the connected iPhone to refresh it." });
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
 * PATCH /api/calendar/external-feeds/:id
 * Update editable fields on a subscribed feed - currently just colour
 * and display name. URL is immutable (changing it would mean a
 * different feed; remove + re-add for that). The new colour
 * propagates to every event from this feed on the next calendar
 * render via the Calendar.jsx feedColorById lookup.
 *
 * Body: { color?, display_name? }
 */
router.patch('/external-feeds/:id', async (req, res) => {
  const feed = await db.getExternalFeedById(req.params.id);
  if (!feed || feed.household_id !== req.householdId) {
    return res.status(404).json({ error: 'Feed not found.' });
  }
  try {
    const updated = await db.updateExternalFeed(feed.id, req.householdId, req.body || {});
    if (!updated) return res.status(400).json({ error: 'No supported fields to update.' });
    return res.json({ feed: updated });
  } catch (err) {
    console.error(`PATCH /api/calendar/external-feeds/${feed.id} error:`, err);
    return res.status(500).json({ error: err.message || 'Could not update feed.' });
  }
});

/**
 * DELETE /api/calendar/external-feeds/:id
 * Remove a feed. Events created by this feed are hard-deleted via the
 * ON DELETE CASCADE on calendar_events.external_feed_id - they re-appear
 * if the user re-subscribes.
 */
router.delete('/external-feeds/:id', async (req, res) => {
  const feed = await db.getExternalFeedById(req.params.id);
  if (!feed || feed.household_id !== req.householdId) {
    return res.status(404).json({ error: 'Feed not found.' });
  }
  try {
    if (feed.source === 'device') {
      // TOMBSTONE, don't delete: the owning phone still has this calendar in
      // its local selection, and a hard delete would just be recreated on its
      // next foreground sync (adopt-or-create), silently undoing the removal.
      // sync_enabled=false makes the next sync answer {disabled:true}, which
      // tells the phone to drop the calendar from its selection; the events
      // disappear now. Re-ticking in the picker re-enables explicitly.
      // Events FIRST: if the tombstone write committed but the event delete
      // failed, the feed would vanish from the Settings roster (it filters
      // sync_enabled) while its read-only events stayed - unremovable from
      // any surface. This order leaves every failure mode retryable.
      await db.deleteEventsForFeed(feed.id);
      await db.updateDeviceCalendarLink(feed.id, { sync_enabled: false, last_sync_hash: null });
    } else {
      await db.deleteExternalFeed(feed.id, req.householdId);
    }
    cache.invalidatePattern(`cal-month:${req.householdId}:`);
    cache.invalidate(`digest:${req.householdId}`);
    return res.json({ success: true });
  } catch (err) {
    console.error(`DELETE /api/calendar/external-feeds/${feed.id} error:`, err);
    return res.status(500).json({ error: err.message || 'Could not remove feed.' });
  }
});

/**
 * POST /api/calendar/device-sync
 * The iOS app uploads window snapshots of the user's SELECTED device
 * calendars, read via the read-only EventKit bridge. Each calendar becomes
 * (or adopts) an external_calendar_feeds row with source='device'; events
 * flow through the same pipeline as URL-feed events. The service layer
 * enforces the echo guard (Housemait-prefixed UIDs dropped), household
 * dedupe, hash-skip and the replace-window apply.
 *
 * Body: { calendars: [{ deviceCalendarId, name, color?, hash?, windowStart,
 *         windowEnd, events: [{uid, title, start, end?, allDay?, location?}] }] }
 */
router.post('/device-sync', async (req, res) => {
  const calendars = Array.isArray(req.body?.calendars) ? req.body.calendars : null;
  if (!calendars || calendars.length === 0) {
    return res.status(400).json({ error: 'calendars array is required.' });
  }
  if (calendars.length > 10) {
    return res.status(400).json({ error: 'At most 10 calendars per sync.' });
  }
  const results = [];
  let changed = false;
  const allIds = calendars.map((c) => c?.deviceCalendarId).filter(Boolean);
  for (const calendar of calendars) {
    try {
      const result = await deviceCalendarSync.syncDeviceCalendar({
        householdId: req.householdId,
        userId: req.user.id,
        calendar,
        // The other calendar ids in this request - the adopt-by-name path
        // must not cannibalise a sibling's link.
        siblingCalendarIds: allIds.filter((id) => id !== calendar?.deviceCalendarId),
      });
      if (result.ok && !result.skipped) changed = true;
      // The disabled branch sweeps leftover events (race with a web
      // removal), so the cached month view may have changed too.
      if (result.disabled) changed = true;
      results.push(result);
    } catch (err) {
      // One calendar failing must not abort the batch NOR mask the others'
      // committed writes (cache invalidation below still runs).
      console.error('POST /api/calendar/device-sync calendar error:', err);
      results.push({ ok: false, error: 'Sync failed for this calendar.' });
      changed = true; // a partial apply may have written rows - play it safe
    }
  }
  if (changed) {
    cache.invalidatePattern(`cal-month:${req.householdId}:`);
    cache.invalidate(`digest:${req.householdId}`);
  }
  return res.json({ results });
});

// ─── POST /api/calendar/seed-holidays ─────────────────────────────────────────
// Seed public holidays for the current household (idempotent - skips duplicates)
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

// ─── Event attachments ──────────────────────────────────────────────────────

/**
 * GET /api/calendar/events/:id/attachments
 * List a calendar event's attachments, each with a short-lived signed URL.
 */
router.get('/events/:id/attachments', async (req, res) => {
  try {
    const event = await db.getCalendarEventById(req.params.id, req.householdId);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const rows = await db.getEventAttachments(req.params.id);
    const attachments = await Promise.all(rows.map(async (a) => ({
      id: a.id,
      name: a.name,
      mime_type: a.mime_type,
      file_size: a.file_size,
      created_at: a.created_at,
      url: await r2.getSignedDownloadUrl(a.file_path).catch(() => null),
    })));
    return res.json({ attachments });
  } catch (err) {
    console.error('GET /api/calendar/events/:id/attachments error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/calendar/events/:id/attachments  (multipart, field "file")
 * Attach a file to a calendar event. Stored in R2; metadata in the DB.
 */
router.post('/events/:id/attachments', attachmentUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded. Use field name "file".' });
  try {
    const event = await db.getCalendarEventById(req.params.id, req.householdId);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Type allowlist + magic-byte sniff (rejects executables, scripts, HTML/SVG,
    // and extension/content mismatches) - same guard as the documents upload.
    let validated;
    try {
      validated = validateUpload(req.file.buffer, req.file.originalname);
    } catch (validationErr) {
      return res.status(validationErr.statusCode || 415).json({ error: validationErr.message });
    }

    const displayName = normaliseFilename(req.file.originalname) || `file.${validated.ext}`;
    const safeFilename = displayName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `${req.householdId}/events/${req.params.id}/${crypto.randomUUID()}-${safeFilename}`;

    await r2.uploadFile(storageKey, req.file.buffer, validated.mime);

    const attachment = await db.createEventAttachment(req.householdId, {
      event_id: req.params.id,
      name: displayName,
      file_path: storageKey,
      file_size: req.file.size,
      mime_type: validated.mime,
      uploaded_by: req.user.id,
    });

    const url = await r2.getSignedDownloadUrl(storageKey).catch(() => null);
    return res.status(201).json({
      attachment: {
        id: attachment.id,
        name: attachment.name,
        mime_type: attachment.mime_type,
        file_size: attachment.file_size,
        created_at: attachment.created_at,
        url,
      },
    });
  } catch (err) {
    console.error('POST /api/calendar/events/:id/attachments error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/calendar/attachments/:attachmentId
 * Remove an attachment (R2 object + row), scoped to the caller's household.
 */
router.delete('/attachments/:attachmentId', async (req, res) => {
  try {
    const a = await db.getEventAttachmentById(req.params.attachmentId, req.householdId);
    if (!a) return res.status(404).json({ error: 'Attachment not found' });
    await r2.deleteFile(a.file_path).catch((e) => console.warn('[calendar] R2 delete failed:', e.message));
    await db.deleteEventAttachment(a.id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/calendar/attachments/:attachmentId error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
// Exposed for unit tests - pure helper, no Express/db dependency.
module.exports.timeRangeError = timeRangeError;
