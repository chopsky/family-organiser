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
const jwt = require('jsonwebtoken');
const db = require('../db/queries');
const { requireAuth, requireHousehold } = require('../middleware/auth');
const { encryptToken } = require('../utils/calendar-token-crypto');
const { localToUTC } = require('../utils/local-time');
const googleCal = require('../services/googleCalendar');
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

// ── Google Calendar OAuth (Phase 1: inbound read-only, flag-gated) ──────────
const GCAL_ENABLED = process.env.GOOGLE_CALENDAR_ENABLED === 'true';
const GCAL_REDIRECT = `${process.env.API_URL || 'http://localhost:3000'}/api/calendar/connect/google/callback`;
const GCAL_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

// Staged-rollout allowlist. When GOOGLE_CALENDAR_ALLOWLIST is set (comma-
// separated emails), the connect UI + routes are enabled ONLY for those users -
// everyone else sees nothing (status returns enabled:false). Unset → enabled for
// all (plain global-flag behaviour). The master GOOGLE_CALENDAR_ENABLED switch
// gates both: with it off, nobody gets it regardless of the allowlist. This lets
// the feature ship to prod while only the founder (a Google test user) can see
// it, until verification lifts the test-user cap.
const GCAL_ALLOWLIST = (process.env.GOOGLE_CALENDAR_ALLOWLIST || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

async function gcalEnabledFor(req) {
  if (!GCAL_ENABLED) return false;
  if (GCAL_ALLOWLIST.length === 0) return true; // no allowlist → everyone
  if (!req.user?.id) return false;
  try {
    const u = await db.getUserById(req.user.id);
    const email = (u?.email || '').toLowerCase();
    return !!email && GCAL_ALLOWLIST.includes(email);
  } catch {
    return false;
  }
}

function gcalOAuthClient() {
  const { google } = require('googleapis');
  return new google.auth.OAuth2(
    process.env.GOOGLE_CALENDAR_CLIENT_ID,
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    GCAL_REDIRECT,
  );
}

// Start the connect flow. Authenticated; returns the Google consent URL for the
// client to open. `state` is a short-lived signed JWT carrying user+household so
// the (unauthenticated) callback can attribute the tokens. Requests
// calendar.readonly always, and calendar.app.created additionally when outbound
// writes are globally enabled (Phase 2) - the write scope can only touch a
// secondary calendar this app creates, never the user's real calendars.
router.get('/connect/google', requireAuth, requireHousehold, async (req, res) => {
  if (!(await gcalEnabledFor(req))) return res.status(404).json({ error: 'Calendar connect is not available.' });
  if (!process.env.GOOGLE_CALENDAR_CLIENT_ID || !process.env.GOOGLE_CALENDAR_CLIENT_SECRET) {
    return res.status(500).json({ error: 'Google Calendar is not configured.' });
  }
  const state = jwt.sign(
    { uid: req.user.id, hid: req.householdId, p: 'gcal' },
    process.env.JWT_SECRET,
    { expiresIn: '15m' },
  );
  const scope = googleCal.writesGloballyEnabled() ? [...GCAL_SCOPES, googleCal.WRITE_SCOPE] : GCAL_SCOPES;
  const url = gcalOAuthClient().generateAuthUrl({
    access_type: 'offline',     // need a refresh token for background pulls
    prompt: 'consent',          // force a refresh token even on re-consent
    include_granted_scopes: true,
    scope,
    state,
  });
  return res.json({ url });
});

// OAuth callback - a top-level browser redirect from Google, so NO Bearer auth.
// Identity comes from the signed `state`. Exchanges the code, encrypts + stores
// the tokens, and bounces back to the web app's Connect Calendars screen.
router.get('/connect/google/callback', async (req, res) => {
  const webUrl = process.env.WEB_URL || 'http://localhost:5173';
  const back = (status, extra = '') =>
    res.redirect(`${webUrl}/settings?section=calendars&google=${status}${extra}`);
  if (!GCAL_ENABLED) return back('error', '&reason=disabled');

  const { code, state, error: oauthError } = req.query;
  if (oauthError) return back('error', `&reason=${encodeURIComponent(String(oauthError))}`);
  if (!code || !state) return back('error', '&reason=missing_code');

  let claims;
  try {
    claims = jwt.verify(String(state), process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return back('error', '&reason=bad_state');
  }
  if (claims.p !== 'gcal' || !claims.uid || !claims.hid) return back('error', '&reason=bad_state');

  try {
    const { tokens } = await gcalOAuthClient().getToken(String(code));
    let email = null;
    if (tokens.id_token) { try { email = jwt.decode(tokens.id_token)?.email || null; } catch { /* ignore */ } }
    const refreshTokenEnc = tokens.refresh_token ? encryptToken(tokens.refresh_token) : null;
    const conn = await db.upsertCalendarConnection({
      userId: claims.uid,
      householdId: claims.hid,
      provider: 'google',
      googleEmail: email,
      refreshTokenEnc,
      accessTokenEnc: tokens.access_token ? encryptToken(tokens.access_token) : null,
      tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      scopes: tokens.scope || GCAL_SCOPES.join(' '),
      // No refresh token → can't pull in the background; flag for re-connect.
      status: tokens.refresh_token ? 'ok' : 'needs_reconnect',
    });

    // Phase 2: if outbound writes are enabled AND the user granted the
    // app.created scope, create the dedicated "Housemait" calendar now so it
    // appears in their Google account immediately, and flip on this connection's
    // write flag. Non-fatal: the read-only connection already works, so a
    // failure here just leaves writes off (retried on next connect / first push).
    const grantedWrite = String(tokens.scope || '').includes(googleCal.WRITE_SCOPE);
    if (refreshTokenEnc && conn?.id && googleCal.writesGloballyEnabled() && grantedWrite) {
      try {
        const appCalId = await googleCal.ensureAppCalendar({ refresh_token: refreshTokenEnc, app_calendar_id: null });
        await db.setConnectionAppCalendar(conn.id, appCalId);
        await db.setConnectionWritesEnabled(conn.id, true);
      } catch (e) {
        console.error('[gcal callback] Housemait calendar setup failed:', e.message);
      }
    }
    return back('connected');
  } catch (err) {
    console.error('[gcal callback] token exchange failed:', err.message);
    return back('error', '&reason=exchange_failed');
  }
});

// Is a token error from Google a "the user revoked us / re-consent needed" one?
function isReconnectError(err) {
  const m = `${err?.message || ''} ${err?.response?.data?.error || ''}`.toLowerCase();
  return err?.code === 'NO_REFRESH_TOKEN' || /invalid_grant|unauthorized|invalid credentials|401/.test(m);
}

// Connection status for the UI: connected?, which account, which calendars chosen.
router.get('/google/status', requireAuth, requireHousehold, async (req, res) => {
  if (!(await gcalEnabledFor(req))) return res.json({ enabled: false, connected: false });
  try {
    const conn = await db.getCalendarConnectionByUser(req.user.id, 'google');
    if (!conn) return res.json({ enabled: true, connected: false });
    const feeds = await db.getGoogleFeedsByConnection(conn.id);
    return res.json({
      enabled: true,
      connected: true,
      email: conn.google_email,
      status: conn.status,
      calendars: feeds.map((f) => ({ id: f.google_calendar_id, name: f.display_name, lastSyncedAt: f.last_synced_at })),
    });
  } catch (err) {
    console.error('[gcal status]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// List the connected account's calendars for the picker (each flagged selected).
router.get('/google/calendars', requireAuth, requireHousehold, async (req, res) => {
  if (!(await gcalEnabledFor(req))) return res.status(404).json({ error: 'Not available' });
  const conn = await db.getCalendarConnectionByUser(req.user.id, 'google');
  if (!conn || conn.status === 'needs_reconnect' || !conn.refresh_token) {
    return res.status(409).json({ error: 'not_connected', needsConnect: true });
  }
  try {
    const [calendars, feeds] = await Promise.all([
      googleCal.listCalendars(conn),
      db.getGoogleFeedsByConnection(conn.id),
    ]);
    const selected = new Set(feeds.map((f) => f.google_calendar_id));
    return res.json({
      email: conn.google_email,
      calendars: calendars.map((c) => ({ ...c, selected: selected.has(c.id) })),
    });
  } catch (err) {
    if (isReconnectError(err)) {
      await db.markCalendarConnectionStatus(conn.id, 'needs_reconnect').catch(() => {});
      return res.status(409).json({ error: 'reconnect_required', needsConnect: true });
    }
    console.error('[gcal calendars]', err.message);
    return res.status(502).json({ error: 'Could not load calendars from Google.' });
  }
});

// Save which calendars to import. Adds feed rows for newly-selected calendars
// and removes deselected ones (their events cascade away via external_feed_id).
router.post('/google/select', requireAuth, requireHousehold, async (req, res) => {
  if (!(await gcalEnabledFor(req))) return res.status(404).json({ error: 'Not available' });
  const conn = await db.getCalendarConnectionByUser(req.user.id, 'google');
  if (!conn) return res.status(409).json({ error: 'not_connected' });
  const wanted = Array.isArray(req.body?.calendars) ? req.body.calendars : [];
  const wantById = new Map(wanted.filter((c) => c && c.id).map((c) => [String(c.id), c]));
  try {
    const existing = await db.getGoogleFeedsByConnection(conn.id);
    const existingIds = new Set(existing.map((f) => f.google_calendar_id));
    // New Google calendars default to belonging to the member who connected
    // them - they inherit that member's colour + attribution.
    const owner = await Promise.resolve(db.getUserById(req.user.id)).catch(() => null);
    const added = [];
    for (const [id, c] of wantById) {
      if (!existingIds.has(id)) {
        const feed = await db.addGoogleCalendarFeed({
          userId: req.user.id,
          householdId: req.householdId,
          connectionId: conn.id,
          googleCalendarId: id,
          displayName: c.summary || c.name || 'Google calendar',
          ownerMemberId: req.user.id,
          color: owner?.color_theme || 'sky',
        });
        if (feed) added.push(feed);
      }
    }
    for (const f of existing) {
      if (!wantById.has(f.google_calendar_id)) await db.deleteExternalFeed(f.id, req.householdId);
    }
    // Kick off an immediate first pull for the newly-added calendars so events
    // appear within seconds instead of waiting for the next 30-min cron tick.
    // Fire-and-forget: we've already saved the feed rows, so a transient sync
    // failure is non-fatal (the cron retries). Promise.resolve() guards against
    // a non-thenable return. Runs on the long-lived server, so it completes
    // after the response is sent.
    for (const feed of added) {
      Promise.resolve(googleCal.refreshGoogleFeed(feed, conn)).catch((err) =>
        console.warn(`[gcal select] immediate sync failed for feed ${feed.id}:`, err.message));
    }
    return res.json({ ok: true, count: wantById.size });
  } catch (err) {
    console.error('[gcal select]', err.message);
    return res.status(500).json({ error: 'Could not save calendar selection.' });
  }
});

// Disconnect: delete the "Housemait" app calendar (removes ONLY events we put
// there), then best-effort revoke at Google, then delete the connection (which
// cascades to its feed rows + pulled events + sync mappings).
router.delete('/google/disconnect', requireAuth, requireHousehold, async (req, res) => {
  if (!(await gcalEnabledFor(req))) return res.status(404).json({ error: 'Not available' });
  try {
    const conn = await db.getCalendarConnectionByUser(req.user.id, 'google');
    if (!conn) return res.json({ ok: true });
    // Delete the Housemait calendar FIRST - the revoke below kills the token we
    // need to do it. Best-effort: a failure here must not block disconnect.
    if (conn.app_calendar_id && conn.refresh_token) {
      try { await googleCal.deleteAppCalendar(conn); } catch (e) { console.error('[gcal disconnect] app calendar delete failed:', e.message); }
    }
    if (conn.refresh_token) {
      try { await googleCal.oauthClientForConnection(conn).revokeCredentials(); } catch { /* best-effort */ }
    }
    await db.deleteCalendarConnection(conn.id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[gcal disconnect]', err.message);
    return res.status(500).json({ error: 'Could not disconnect.' });
  }
});

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

    // Weekly extracurriculars flagged "show on the family calendar".
    // These live in child_weekly_schedule, not calendar_events, so the
    // feed materialises them: one VEVENT per occurrence over a bounded
    // window (last week → next ~13 weeks), inside the activity's term
    // window when one is set. Per-occurrence UTC conversion from the
    // household's wall-clock time keeps DST transitions correct - an
    // RRULE anchored to a fixed UTC DTSTART would drift by an hour.
    // Stable per-occurrence UIDs, same contract as events/tasks above.
    // Best-effort: a failure here never breaks the rest of the feed.
    try {
      const [activities, actMembers] = await Promise.all([
        db.getHouseholdActivities(tokenData.household_id),
        db.getHouseholdMembers(tokenData.household_id),
      ]);
      const flagged = activities.filter((a) => a.show_on_calendar !== false);
      if (flagged.length > 0) {
        const nameById = new Map(actMembers.map((m) => [m.id, m.name]));
        const tz = household?.timezone || 'Europe/London';
        // Anchor on "today" in the household tz; the Y-M-D constructor
        // keeps getDay() correct for that calendar date regardless of
        // the server's own timezone.
        const [ay, am, ad] = new Date().toLocaleDateString('en-CA', { timeZone: tz }).split('-').map(Number);
        const anchor = new Date(ay, am - 1, ad);
        anchor.setDate(anchor.getDate() - 7);
        for (let i = 0; i < 98; i++) {
          const d = new Date(anchor);
          d.setDate(anchor.getDate() + i);
          const wd = (d.getDay() + 6) % 7; // 0=Monday, app-wide convention
          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          for (const act of flagged) {
            if (act.day_of_week !== wd) continue;
            if (act.start_date && dateStr < act.start_date) continue;
            if (act.end_date && dateStr > act.end_date) continue;
            // Per-date skip: the occurrence stops being emitted, so
            // subscribers drop it on their next refresh.
            if (act.skips && act.skips.includes(dateStr)) continue;
            // Per-date override: emit the one-off time under the SAME
            // stable UID, so subscribers update the occurrence in place.
            const ov = act.overrides ? act.overrides[dateStr] : null;
            const effStart = ov ? ov.time_start : act.time_start;
            const effEnd = ov ? ov.time_end : act.time_end;
            const childName = nameById.get(act.child_id);
            const summary = childName ? `${childName} - ${act.activity}` : act.activity;
            if (effStart) {
              const startIso = localToUTC(dateStr, String(effStart).slice(0, 5), tz);
              const endIso = effEnd
                ? localToUTC(dateStr, String(effEnd).slice(0, 5), tz)
                : new Date(new Date(startIso).getTime() + 3600000).toISOString();
              calendar.createEvent({
                id: `housemait-act-${act.id}-${dateStr}@housemait.com`,
                start: new Date(startIso),
                end: new Date(endIso),
                summary,
              });
            } else {
              calendar.createEvent({
                id: `housemait-act-${act.id}-${dateStr}@housemait.com`,
                start: new Date(`${dateStr}T00:00:00Z`),
                summary,
                allDay: true,
              });
            }
          }
        }
      }
    } catch (actErr) {
      console.warn('outbound feed: activities skipped:', actErr.message);
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

    // Prefer NATIVE events over read-only SYNCED copies. The calendar client
    // dedupes events by title+date and keeps the FIRST one it sees, so ordering
    // native (no external_feed_id) ahead of synced means an event the user
    // deleted at its source and re-created in Housemait isn't hidden behind the
    // lingering subscribed copy (which clears on the next confirmed feed pull).
    // Stable sort: only the native/synced partition moves, other order is kept.
    events.sort((a, b) => (a.external_feed_id ? 1 : 0) - (b.external_feed_id ? 1 : 0));

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

    // Phase 2: mirror this household-native event out to any writable Google
    // calendar in the household (fire-and-forget; no-ops unless two-way writes
    // are on, and self-skips feed-sourced events via the echo guard).
    googleCal.syncEventOutbound(req.householdId, event, 'create').catch(() => {});

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

    // Phase 2: push the edit out to any writable Google calendar (fire-and-
    // forget; updates the mapped copy, or no-ops when writes are off).
    googleCal.syncEventOutbound(req.householdId, event, 'update').catch(() => {});

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
    // Phase 2: remove the mirrored copy from any writable Google calendar
    // (fire-and-forget, mapping-only — only ever deletes a copy we created).
    googleCal.syncEventOutbound(req.householdId, { id: req.params.id }, 'delete').catch(() => {});
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

// "Delete just this day" for RECURRING events: one event_skips row hides a
// single occurrence everywhere expansion happens (calendar, digest,
// reminders, ICS feed, AI ground truth) without touching the series.
// `date` = the occurrence's start ISO sliced to YYYY-MM-DD, exactly as the
// expansion derives it. Only meaningful on recurring events - a plain
// event's delete is the ordinary soft-delete above.
const SKIP_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.post('/events/:id/skips', async (req, res) => {
  try {
    const { date } = req.body || {};
    if (!date || !SKIP_DATE_RE.test(date)) return res.status(400).json({ error: 'A date (YYYY-MM-DD) is required' });
    const event = await db.getCalendarEventById(req.params.id, req.householdId);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (!event.recurrence) return res.status(400).json({ error: 'Only repeating events can skip a day' });
    await db.addEventSkip(req.params.id, req.householdId, date, req.user.id);
    cache.invalidatePattern(`cal-month:${req.householdId}:`);
    cache.invalidatePattern(`cal-events:${req.householdId}:`);
    cache.invalidate(`digest:${req.householdId}`);
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error('POST /api/calendar/events/:id/skips error:', err?.message || err);
    return res.status(500).json({ error: 'Could not skip this day.' });
  }
});

router.delete('/events/:id/skips/:date', async (req, res) => {
  try {
    if (!SKIP_DATE_RE.test(req.params.date)) return res.status(400).json({ error: 'Invalid date' });
    const event = await db.getCalendarEventById(req.params.id, req.householdId);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    await db.removeEventSkip(req.params.id, req.params.date);
    cache.invalidatePattern(`cal-month:${req.householdId}:`);
    cache.invalidatePattern(`cal-events:${req.householdId}:`);
    cache.invalidate(`digest:${req.householdId}`);
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/calendar/events/:id/skips/:date error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Party invites (the organic-growth loop, host side) ─────────────────────

/**
 * POST /api/calendar/events/:id/invite-link
 * Create - or return the existing live - public invite link for an event.
 * One link per event so a host who shares twice never splits the roster.
 */
router.post('/events/:id/invite-link', async (req, res) => {
  try {
    const link = await db.createOrGetEventInviteLink({
      eventId: req.params.id,
      householdId: req.householdId,
      createdBy: req.user.id,
    });
    const base = process.env.WEB_URL || 'https://housemait.com';
    return res.json({
      url: `${base}/p/${link.token}`,
      token: link.token,
      expiresAt: link.expires_at,
    });
  } catch (err) {
    if (err?.code === 'EVENT_NOT_FOUND') return res.status(404).json({ error: 'Event not found' });
    // 42P01 = relation missing: the event-invites migration hasn't run yet.
    if (err?.code === '42P01') return res.status(503).json({ error: 'Invites are not available yet' });
    console.error('POST /api/calendar/events/:id/invite-link error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/calendar/events/:id/invite-link
 * Turn off the event's live invite link. The link 404s for invitees from
 * this moment; RSVPs already received are kept (the roster aggregates
 * across revoked links). Creating again mints a fresh token - the
 * "shared it to the wrong group chat" rotation path.
 */
router.delete('/events/:id/invite-link', async (req, res) => {
  try {
    const revoked = await db.revokeEventInviteLink(req.params.id, req.householdId);
    return res.json({ ok: true, revoked });
  } catch (err) {
    console.error('DELETE /api/calendar/events/:id/invite-link error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/calendar/events/:id/rsvps
 * The host's roster + rollups (going/declined, headcounts, allergy list).
 * Returns the calm empty shape when the event has no live link.
 */
router.get('/events/:id/rsvps', async (req, res) => {
  try {
    const roster = await db.getEventRsvps(req.params.id, req.householdId);
    return res.json(roster);
  } catch (err) {
    console.error('GET /api/calendar/events/:id/rsvps error:', err?.message || err);
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
    // Google feeds are managed by the dedicated "Connect Google Calendar" card
    // (via /google/status), not this generic list - showing them here would
    // duplicate them and expose an iCal-style refresh that doesn't apply.
    return res.json({ feeds: feeds.filter((f) => f.source !== 'google') });
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
 *   - 400 if the URL is a known wrong-paste shape, or the initial pull
 *     proves the address can never work (the row is removed - the user
 *     should fix the paste, not keep a forever-failing subscription).
 *   - 409 if the URL is already subscribed in this household.
 *   - 502 if the initial pull fails transiently (the feed row is kept;
 *     the cron retries once the source comes back).
 */
// A friendly placeholder name shown until the feed's real X-WR-CALNAME is read
// on the initial pull (a few seconds). Derived from the provider host.
function provisionalFeedName(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('google')) return 'Google calendar';
    if (host.includes('icloud') || host.includes('apple')) return 'Apple calendar';
    if (host.includes('outlook') || host.includes('office')) return 'Outlook calendar';
  } catch { /* fall through */ }
  return 'Subscribed calendar';
}

router.post('/external-feeds', async (req, res) => {
  const { feed_url, display_name, color } = req.body || {};
  if (!feed_url) {
    return res.status(400).json({ error: 'feed_url is required.' });
  }
  // The name is optional - if the user leaves it blank we read the calendar's
  // own name (X-WR-CALNAME) from the feed on the initial pull below.
  const providedName = (display_name || '').trim();
  const autoName = !providedName;
  const normalisedUrl = externalFeed.normaliseFeedUrl(feed_url);
  if (!/^https?:\/\//i.test(normalisedUrl)) {
    return res.status(400).json({ error: 'Feed URL must start with https://, http://, or webcal://.' });
  }
  // Known wrong-paste shapes (the provider's web page / embed link instead
  // of the iCal address) - reject with "copy this instead" guidance rather
  // than creating a row that can never pull.
  const mistake = externalFeed.classifyFeedUrlMistake(normalisedUrl);
  if (mistake) {
    return res.status(400).json({ error: mistake });
  }

  let feed;
  try {
    // A synced calendar defaults to belonging to the person who connected it
    // (their own calendar) - events inherit that member's colour + attribution.
    // They can re-point it to another member or "Shared" later.
    const owner = await Promise.resolve(db.getUserById(req.user.id)).catch(() => null);
    feed = await db.createExternalFeed({
      user_id: req.user.id,
      household_id: req.householdId,
      feed_url: normalisedUrl,
      display_name: (providedName || provisionalFeedName(normalisedUrl)).slice(0, 200),
      owner_member_id: req.user.id,
      color: owner?.color_theme || color || 'sky',
    });
  } catch (err) {
    // Unique violation on (household_id, feed_url) - friendlier message.
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'Someone in your household has already subscribed to this URL.' });
    }
    console.error('POST /api/calendar/external-feeds error:', err);
    return res.status(500).json({ error: err.message || 'Could not add feed.' });
  }

  // Initial pull. A TRANSIENT failure (source briefly down) keeps the feed
  // row so the cron retries - the user shouldn't lose the URL they pasted.
  // A PERMANENT-shape failure (they pasted the wrong KIND of address - a web
  // page, or Google's public address on a non-public calendar) instead drops
  // the row and returns 400 with copy-this-instead guidance, so they fix the
  // paste rather than keeping a subscription that fails every cron forever.
  // Return as soon as the row exists; run the initial pull in the BACKGROUND.
  // A big calendar's first import (fetch + expand recurring events + upsert) can
  // take many seconds, and making the user wait on a spinner was the rough edge.
  // The common wrong-paste shapes were already rejected synchronously above
  // (classifyFeedUrlMistake), so what's left is: pull the events and - for a URL
  // that passes the shape check but proves permanently un-pullable - tidy the
  // row away so it doesn't fail every cron forever. Transient failures keep the
  // row (the refresh cron retries). Errors are logged, not surfaced - the
  // response has already gone out.
  externalFeed.refreshFeed(feed)
    .then((refresh) => {
      console.log(`[external-feeds] initial pull for ${feed.id} (${feed.display_name}): ${refresh?.fetched ?? 0} event(s)`);
      // If the user left the name blank, adopt the calendar's own name from the
      // feed (X-WR-CALNAME). Falls back silently to the provisional name.
      if (autoName && refresh?.calendarName) {
        db.updateExternalFeed(feed.id, req.householdId, { display_name: refresh.calendarName })
          .catch((e) => console.error('[external-feeds] auto-name update failed:', e.message));
      }
    })
    .catch(async (err) => {
      const refreshError = externalFeed.friendlyPullError(normalisedUrl, err.message || String(err));
      if (refreshError?.permanent) {
        await db.deleteExternalFeed(feed.id, req.householdId)
          .catch((e) => console.error('POST /external-feeds: bg cleanup of bad-URL row failed:', e.message));
        console.warn(`[external-feeds] initial pull for ${feed.id} permanently failed, row removed: ${refreshError.message}`);
      } else {
        console.warn(`[external-feeds] initial pull for ${feed.id} failed (transient, cron will retry): ${err.message}`);
      }
    });

  return res.status(201).json({ feed });
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
  // Google feeds have synthetic google:// URLs - they're pulled via the Google
  // Calendar API + the connection's token, NOT the iCal HTTP fetcher (which
  // would trip the SSRF guard with "Only http(s) URLs are allowed").
  if (feed.source === 'google') {
    try {
      const conn = feed.connection_id ? await db.getCalendarConnectionById(feed.connection_id) : null;
      if (!conn || !conn.refresh_token) {
        return res.status(409).json({ error: 'Reconnect Google Calendar to refresh this calendar.' });
      }
      const refresh = await googleCal.refreshGoogleFeed(feed, conn);
      return res.json({ refresh });
    } catch (err) {
      console.error(`[gcal manual refresh] feed ${feed.id}:`, err.message);
      return res.status(502).json({ error: err.message || 'Refresh failed.' });
    }
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
 * PATCH /api/calendar/external-feeds/:id/owner
 * Set which household member a synced calendar belongs to ("Whose calendar is
 * this?"). Body: { owner_member_id: <member id> | null }. null = "Shared"
 * (neutral colour, no assignee). Re-stamps already-imported events so the
 * colour + attribution update immediately, not just on the next sync.
 */
router.patch('/external-feeds/:id/owner', async (req, res) => {
  const feed = await db.getExternalFeedById(req.params.id);
  if (!feed || feed.household_id !== req.householdId) {
    return res.status(404).json({ error: 'Feed not found.' });
  }
  const ownerMemberId = req.body?.owner_member_id || null;
  try {
    // A non-null owner must be a member of THIS household (no cross-tenant).
    let attr = { color: 'slate', assignedIds: [], assignedNames: [] };
    if (ownerMemberId) {
      const member = await db.getUserById(ownerMemberId);
      if (!member || member.household_id !== req.householdId) {
        return res.status(400).json({ error: 'That member is not in your household.' });
      }
      attr = {
        color: member.color_theme || 'slate',
        assignedIds: [member.id],
        assignedNames: [member.name].filter(Boolean),
      };
    }
    const updated = await db.setExternalFeedOwner(feed.id, req.householdId, ownerMemberId, attr.color);
    await db.restampFeedEventsAttribution(feed.id, req.householdId, attr);
    cache.invalidatePattern(`cal-month:${req.householdId}:`);
    cache.invalidatePattern(`cal-events:${req.householdId}:`);
    return res.json({ feed: updated });
  } catch (err) {
    console.error(`PATCH /api/calendar/external-feeds/${feed.id}/owner error:`, err);
    return res.status(500).json({ error: err.message || 'Could not update calendar owner.' });
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
