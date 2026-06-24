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

module.exports = {
  oauthClientForConnection,
  calendarApi,
  listCalendars,
  googleEventToTimes,
  pullCalendarChanges,
  refreshGoogleFeed,
};
