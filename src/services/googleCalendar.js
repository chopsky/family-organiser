// Google Calendar API helpers (Phase 1: read-only). The OAuth2 client is built
// from a stored connection's ENCRYPTED refresh token - googleapis mints/refreshes
// access tokens on demand from the refresh token, so we don't manage expiry here.
//
// Phase 1 exposes listCalendars (for the picker) and the inbound event pull
// (refreshGoogleFeed) that feeds Google events into the EXISTING
// external_calendar_feeds / calendar_events render pipeline. No write scopes are
// ever requested - this whole module is read-only.

const db = require('../db/queries');
const cache = require('./cache');
const { decryptToken } = require('../utils/calendar-token-crypto');

// Full-sync window: pull events from 30 days ago forward. The floor is fixed for
// the life of the syncToken Google returns; far-future events still sync.
const SYNC_WINDOW_PAST_DAYS = 30;
// Hard ceiling on events materialised in one pull, so a pathological calendar
// (e.g. a "forever" daily recurrence) can't blow up memory. Logged if hit.
const MAX_EVENTS_PER_SYNC = 5000;

const REDIRECT = `${process.env.API_URL || 'http://localhost:3000'}/api/calendar/connect/google/callback`;

// Build an authorised OAuth2 client for a calendar_connections row. Throws
// NO_REFRESH_TOKEN when the stored token is missing (caller marks reconnect).
function oauthClientForConnection(connection) {
  const { google } = require('googleapis');
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CALENDAR_CLIENT_ID,
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    REDIRECT,
  );
  const refresh = connection.refresh_token ? decryptToken(connection.refresh_token) : null;
  if (!refresh) {
    const e = new Error('NO_REFRESH_TOKEN');
    e.code = 'NO_REFRESH_TOKEN';
    throw e;
  }
  client.setCredentials({ refresh_token: refresh });
  return client;
}

function calendarApi(connection) {
  const { google } = require('googleapis');
  return google.calendar({ version: 'v3', auth: oauthClientForConnection(connection) });
}

// List the user's calendars for the picker. Read-only.
async function listCalendars(connection) {
  const cal = calendarApi(connection);
  const res = await cal.calendarList.list({ maxResults: 250 });
  return (res.data.items || [])
    .filter((c) => c.id)
    .map((c) => ({
      id: c.id,
      summary: c.summaryOverride || c.summary || c.id,
      primary: !!c.primary,
      backgroundColor: c.backgroundColor || null,
      accessRole: c.accessRole || null,
    }));
}

// ─── Inbound event pull ─────────────────────────────────────────────────────

/**
 * Map a Google event resource to our calendar_events time fields.
 *
 * SAFETY (the whole reason for two-way fear): we never re-interpret a wall-clock
 * time against the server's timezone. Timed events carry an RFC3339 dateTime
 * that ALREADY embeds the UTC offset (e.g. "2026-06-24T09:00:00+01:00"), so
 * new Date(...).toISOString() yields the exact absolute instant - it cannot
 * shift the time no matter where the server runs or what DST is in effect.
 *
 * All-day events carry a date-only `date`. Google's end.date is EXCLUSIVE (the
 * day after), so we subtract one to store an inclusive end - identical to the
 * iCal pipeline's all_day convention, so both render on the same day.
 */
function googleEventToTimes(ev) {
  const start = ev.start || {};
  const end = ev.end || {};
  if (start.date) {
    const startDay = start.date; // YYYY-MM-DD
    let endDay = end.date || startDay;
    const d = new Date(`${endDay}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    const inclusive = d.toISOString().slice(0, 10);
    endDay = inclusive < startDay ? startDay : inclusive;
    return { start_time: startDay, end_time: endDay, all_day: true };
  }
  const startDt = start.dateTime || start.date;
  const endDt = end.dateTime || end.date || startDt;
  return {
    start_time: new Date(startDt).toISOString(),
    end_time: new Date(endDt).toISOString(),
    all_day: false,
  };
}

function isGone(err) {
  return err?.code === 410 || err?.response?.status === 410 || /\b410\b/.test(err?.message || '');
}

/**
 * Pull a single Google calendar's changes via the incremental sync protocol.
 *
 * - No stored token → FULL sync: events.list with singleEvents=true (Google
 *   expands recurrences server-side) over [now-30d, ∞). The last page yields a
 *   nextSyncToken.
 * - Stored token → INCREMENTAL sync: only what changed since, INCLUDING
 *   deletions (status='cancelled'). Explicit deletes mean no absence-inference,
 *   so a transient partial response can never wipe the feed (unlike iCal).
 * - Expired token (410) → restart as a full sync.
 *
 * Returns { changed: [event...], cancelledIds: [id...], nextSyncToken, fullSync }.
 */
async function pullCalendarChanges(connection, calendarId, syncToken) {
  const cal = calendarApi(connection);
  const fullSync = !syncToken;
  const changed = [];
  const cancelledIds = [];
  let pageToken = null;
  let nextSyncToken = null;

  const baseParams = fullSync
    ? {
        singleEvents: true,
        showDeleted: false,
        timeMin: new Date(Date.now() - SYNC_WINDOW_PAST_DAYS * 86400_000).toISOString(),
        maxResults: 250,
      }
    // showDeleted defaults to true alongside a syncToken, which is what we want:
    // cancelled events arrive so we can propagate the deletion.
    : { syncToken, maxResults: 250 };

  for (;;) {
    let res;
    try {
      res = await cal.events.list({ calendarId, ...baseParams, ...(pageToken ? { pageToken } : {}) });
    } catch (err) {
      // A 410 only happens on an incremental sync whose token aged out - retry
      // from scratch as a full sync. A full sync can't 410, so no infinite loop.
      if (isGone(err) && !fullSync) {
        return pullCalendarChanges(connection, calendarId, null);
      }
      throw err;
    }
    for (const ev of res.data.items || []) {
      if (ev.status === 'cancelled') cancelledIds.push(ev.id);
      else changed.push(ev);
    }
    if (changed.length > MAX_EVENTS_PER_SYNC) {
      console.warn(`[gcal pull] calendar ${calendarId} exceeded ${MAX_EVENTS_PER_SYNC} events - truncating`);
      // Stop paging; we deliberately do NOT capture a syncToken here so the next
      // run re-attempts a fresh full sync rather than persisting a partial state.
      return { changed: changed.slice(0, MAX_EVENTS_PER_SYNC), cancelledIds, nextSyncToken: null, fullSync };
    }
    if (res.data.nextPageToken) { pageToken = res.data.nextPageToken; continue; }
    nextSyncToken = res.data.nextSyncToken || null;
    break;
  }
  return { changed, cancelledIds, nextSyncToken, fullSync };
}

/**
 * Pull one selected Google calendar (a source='google' feed row) and reconcile
 * it into calendar_events, then persist the new syncToken.
 *
 * On a full sync the returned set is the authoritative current state within the
 * window, so feed rows not in it (and starting within the window) are pruned -
 * this recovers cleanly from a 410 token reset without leaving orphans. On an
 * incremental sync we only act on what Google explicitly sent (upserts +
 * cancelled deletes), never on absence.
 */
async function refreshGoogleFeed(feed, connection) {
  const stats = { fetched: 0, created: 0, updated: 0, deleted: 0 };
  let pull;
  try {
    pull = await pullCalendarChanges(connection, feed.google_calendar_id, feed.sync_token);
  } catch (err) {
    await db.recordExternalFeedFailure(feed.id, err.message || String(err));
    throw err;
  }

  // Dedupe by event id (last wins - a moved/edited instance can appear once).
  const byId = new Map();
  for (const ev of pull.changed) byId.set(ev.id, ev);
  const events = Array.from(byId.values());
  stats.fetched = events.length;

  const existing = await db.getExternalFeedEvents(feed.id); // [{ id, external_uid, ... }]
  const existingByUid = new Map(existing.map((e) => [e.external_uid, e]));

  const rows = events.map((ev) => {
    if (existingByUid.has(ev.id)) stats.updated += 1; else stats.created += 1;
    return {
      household_id: feed.household_id,
      title: ev.summary || 'Untitled event',
      description: ev.description || null,
      location: ev.location || null,
      color: feed.color || 'sky',
      source_user_id: feed.user_id,
      external_feed_id: feed.id,
      external_uid: ev.id,
      visibility: 'family',
      ...googleEventToTimes(ev),
    };
  });

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.batchUpsertExternalFeedEvents(rows.slice(i, i + CHUNK));
  }

  // Deletes: explicit cancellations always; on a full sync also prune rows that
  // fell out of the authoritative set, but ONLY those starting within the
  // pulled window (events before timeMin were never in scope for this token).
  const toDelete = new Set();
  for (const uid of pull.cancelledIds) {
    const row = existingByUid.get(uid);
    if (row) toDelete.add(row.id);
  }
  if (pull.fullSync) {
    const windowStart = new Date(Date.now() - SYNC_WINDOW_PAST_DAYS * 86400_000).toISOString();
    const seen = new Set(rows.map((r) => r.external_uid));
    for (const e of existing) {
      if (seen.has(e.external_uid)) continue;
      // start_time is 'YYYY-MM-DD' (all-day) or an ISO instant; string compare
      // against the ISO windowStart is monotonic for both once normalised to a
      // date, so compare on the date portion to keep all-day rows in scope.
      if (String(e.start_time).slice(0, 10) >= windowStart.slice(0, 10)) toDelete.add(e.id);
    }
  }
  const deleteIds = Array.from(toDelete);
  for (let i = 0; i < deleteIds.length; i += CHUNK) {
    await db.batchSoftDeleteCalendarEvents(deleteIds.slice(i, i + CHUNK), feed.household_id);
  }
  stats.deleted = deleteIds.length;

  // Persist the new token (null when truncated/absent → forces a fresh full
  // sync next run) and mark the feed healthy.
  await db.updateGoogleFeedSyncToken(feed.id, pull.nextSyncToken);
  await db.recordExternalFeedSuccess(feed.id);

  cache.invalidatePattern(`cal-month:${feed.household_id}:`);
  cache.invalidatePattern(`cal-events:${feed.household_id}:`);

  return stats;
}

// ─── Phase 2: outbound writes (calendar.app.created, SAFE-by-scoping) ────────
//
// This scope can touch ONLY a secondary calendar this app creates - never the
// user's primary or any other calendar. Every function below layers the guards
// the founder required on top of that permission guarantee: a global kill
// switch + per-connection flag, an echo guard (never push an event we pulled
// IN), a single-target assertion (the calendarId is ALWAYS app_calendar_id),
// mapping-ONLY deletes (never delete-by-absence), tz-correct payloads, and an
// audit row for every attempt.

const WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const APP_CALENDAR_SUMMARY = 'Housemait';

// Master kill switch. With this off, NO outbound write happens for anyone,
// regardless of per-connection flags. Inbound pull is unaffected.
function writesGloballyEnabled() {
  return process.env.GOOGLE_CALENDAR_WRITES_ENABLED === 'true';
}

// Find-or-create the dedicated "Housemait" secondary calendar in the user's
// account. Reuses a stored app_calendar_id when present (idempotent across
// reconnects). Returns the calendar id; the caller persists it.
async function ensureAppCalendar(connection) {
  if (connection.app_calendar_id) return connection.app_calendar_id;
  const cal = calendarApi(connection);
  const res = await cal.calendars.insert({
    requestBody: {
      summary: APP_CALENDAR_SUMMARY,
      description: 'Family events from Housemait. Managed by Housemait — you can hide this calendar, but edits here are not synced back.',
    },
  });
  const id = res.data && res.data.id;
  if (!id) throw new Error('Google did not return an app calendar id');
  return id;
}

// Build the Google event resource from a Housemait event. INVERSE of the inbound
// googleEventToTimes: timed events send the absolute UTC instant PLUS an explicit
// IANA timeZone (DST-safe, can't shift); all-day events send date-only with
// Google's EXCLUSIVE end (our stored inclusive end + 1 day). A private extended
// property tags the event as Housemait-sourced so we can recognise our own
// writes and never re-import them.
function buildGoogleEventPayload(event, timeZone = 'Europe/London') {
  const body = {
    summary: event.title || 'Untitled event',
    description: event.description || undefined,
    location: event.location || undefined,
    extendedProperties: { private: { housemaitEventId: String(event.id), source: 'housemait' } },
  };
  if (event.all_day) {
    const startDay = String(event.start_time).slice(0, 10);
    const endInclusive = String(event.end_time || event.start_time).slice(0, 10);
    const d = new Date(`${endInclusive}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1); // inclusive → exclusive for Google
    body.start = { date: startDay };
    body.end = { date: d.toISOString().slice(0, 10) };
  } else {
    body.start = { dateTime: new Date(event.start_time).toISOString(), timeZone };
    body.end = { dateTime: new Date(event.end_time || event.start_time).toISOString(), timeZone };
  }
  return body;
}

// Is this Housemait event eligible to sync OUT? Only events authored in
// Housemait - anything with an external_feed_id was pulled IN (Google/iCal/
// device) and pushing it back would loop. Exported so callers can pre-filter.
function isNativeEvent(event) {
  return !!event && !event.external_feed_id && !event.deleted_at;
}

// Create or update a household-native event in the connection's app calendar.
async function pushEventToGoogle(connection, event) {
  const base = {
    connectionId: connection.id,
    householdId: connection.household_id,
    googleCalendarId: connection.app_calendar_id,
    housemaitEventId: event.id,
  };
  if (!writesGloballyEnabled() || !connection.writes_enabled) {
    await db.recordCalendarWriteAudit({ ...base, op: 'create', result: 'blocked', error: 'writes_disabled' });
    return { skipped: 'writes_disabled' };
  }
  if (!isNativeEvent(event)) {
    await db.recordCalendarWriteAudit({ ...base, op: 'create', result: 'skipped', error: 'inbound_event' });
    return { skipped: 'inbound_event' };
  }
  const target = connection.app_calendar_id;
  if (!target) {
    await db.recordCalendarWriteAudit({ ...base, op: 'create', result: 'error', error: 'no_app_calendar' });
    return { skipped: 'no_app_calendar' };
  }

  const existing = await db.getSyncMapping(connection.id, event.id);
  const op = existing ? 'update' : 'create';
  // SINGLE-TARGET ASSERTION: refuse if a stored mapping ever points anywhere but
  // the app calendar. Better to fail loudly than risk a real calendar.
  if (existing && existing.google_calendar_id !== target) {
    await db.recordCalendarWriteAudit({ ...base, op, googleEventId: existing.google_event_id, result: 'blocked', error: 'target_mismatch' });
    throw new Error(`[gcal write] target mismatch: mapping ${existing.google_calendar_id} != app calendar ${target}`);
  }

  const cal = calendarApi(connection);
  const requestBody = buildGoogleEventPayload(event);
  try {
    const res = existing
      ? await cal.events.update({ calendarId: target, eventId: existing.google_event_id, requestBody })
      : await cal.events.insert({ calendarId: target, requestBody });
    const googleEventId = res.data && res.data.id;
    await db.upsertSyncMapping({
      connectionId: connection.id,
      householdId: connection.household_id,
      housemaitEventId: event.id,
      googleCalendarId: target,
      googleEventId,
    });
    await db.recordCalendarWriteAudit({ ...base, op, googleEventId, result: 'ok' });
    return { ok: true, op, googleEventId };
  } catch (err) {
    await db.recordCalendarWriteAudit({ ...base, op, result: 'error', error: err.message });
    throw err;
  }
}

// Mapping-ONLY delete: we only ever delete a Google event we have a mapping for
// (i.e. one WE created). No mapping → do nothing. This is the core guarantee
// that a Housemait bug can't wipe a user's events.
async function deleteEventFromGoogle(connection, housemaitEventId) {
  const base = {
    connectionId: connection.id,
    householdId: connection.household_id,
    googleCalendarId: connection.app_calendar_id,
    housemaitEventId,
    op: 'delete',
  };
  if (!writesGloballyEnabled() || !connection.writes_enabled) {
    await db.recordCalendarWriteAudit({ ...base, result: 'blocked', error: 'writes_disabled' });
    return { skipped: 'writes_disabled' };
  }
  const mapping = await db.getSyncMapping(connection.id, housemaitEventId);
  if (!mapping) return { skipped: 'no_mapping' }; // never delete-by-absence

  const target = connection.app_calendar_id;
  if (mapping.google_calendar_id !== target) {
    await db.recordCalendarWriteAudit({ ...base, googleEventId: mapping.google_event_id, result: 'blocked', error: 'target_mismatch' });
    throw new Error('[gcal delete] target mismatch: refusing to delete outside the app calendar');
  }
  const cal = calendarApi(connection);
  try {
    await cal.events.delete({ calendarId: target, eventId: mapping.google_event_id });
  } catch (err) {
    // Already gone on Google's side is success (idempotent).
    const gone = err?.code === 404 || err?.code === 410 || /\b(404|410)\b/.test(err?.message || '');
    if (!gone) {
      await db.recordCalendarWriteAudit({ ...base, googleEventId: mapping.google_event_id, result: 'error', error: err.message });
      throw err;
    }
  }
  await db.deleteSyncMapping(connection.id, housemaitEventId);
  await db.recordCalendarWriteAudit({ ...base, googleEventId: mapping.google_event_id, result: 'ok' });
  return { ok: true };
}

// Delete the whole "Housemait" secondary calendar (removes ONLY events we put
// there — app.created cannot touch any other calendar). Used on disconnect.
async function deleteAppCalendar(connection) {
  if (!connection.app_calendar_id) return { skipped: 'no_app_calendar' };
  const cal = calendarApi(connection);
  try {
    await cal.calendars.delete({ calendarId: connection.app_calendar_id });
  } catch (err) {
    const gone = err?.code === 404 || err?.code === 410 || /\b(404|410)\b/.test(err?.message || '');
    if (!gone) throw err;
  }
  return { ok: true };
}

module.exports = {
  oauthClientForConnection,
  calendarApi,
  listCalendars,
  googleEventToTimes,
  pullCalendarChanges,
  refreshGoogleFeed,
  WRITE_SCOPE,
  writesGloballyEnabled,
  ensureAppCalendar,
  buildGoogleEventPayload,
  isNativeEvent,
  pushEventToGoogle,
  deleteEventFromGoogle,
  deleteAppCalendar,
};
