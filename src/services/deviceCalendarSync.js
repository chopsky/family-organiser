/**
 * Device calendar sync (EventKit) - server side.
 *
 * The iOS app reads the user's SELECTED device calendars via a read-only
 * EventKit bridge and uploads window snapshots here. Device calendars are
 * modelled as external_calendar_feeds rows with source='device', and their
 * events flow through the same calendar_events columns as URL feeds
 * (external_feed_id + external_uid, cascade on unlink) - so rendering,
 * colours, unlink and the outbound-feed exclusion all come for free.
 *
 * Safety properties this module enforces:
 *   - ECHO GUARD: events whose UID carries the Housemait outbound prefix are
 *     dropped, so a phone subscribed to Housemait's own feed can never
 *     re-import Housemait events as "external" copies.
 *   - REPLACE-WINDOW, HASH-SKIPPED: an unchanged calendar is a no-op (no
 *     delete+insert churn); a changed one atomically replaces only its own
 *     window of rows.
 *   - HOUSEHOLD DEDUPE: an event already present under ANOTHER link in the
 *     household (two parents syncing the same shared calendar, or a device
 *     calendar overlapping a URL feed) is skipped - oldest link wins.
 *   - SELF-HEALING RECONNECT: device calendar ids are device-local, so a new
 *     phone "adopts" the user's existing link by display-name match instead
 *     of duplicating it.
 */

const db = require('../db/queries');

// Must match the UID prefix the outbound feed emits (routes/calendar.js).
const HOUSEMAIT_UID_PREFIX = 'housemait-';

const MAX_EVENTS_PER_CALENDAR = 2000;
const MAX_TEXT = 300;

const trim = (v, n = MAX_TEXT) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const isIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/**
 * Validate + bound a raw event payload from the device. Returns the kept
 * events plus counts of what was dropped, so the route can log truncation
 * rather than silently swallowing it.
 */
function sanitizeEvents(rawEvents) {
  const all = Array.isArray(rawEvents) ? rawEvents : [];
  let echoDropped = 0;
  let invalidDropped = 0;
  const seen = new Set();
  const events = [];
  for (const e of all) {
    const uid = trim(e?.uid, 400);
    if (!uid || !isIso(e?.start)) { invalidDropped += 1; continue; }
    if (uid.startsWith(HOUSEMAIT_UID_PREFIX)) { echoDropped += 1; continue; }
    if (seen.has(uid)) { invalidDropped += 1; continue; } // in-batch dupe
    seen.add(uid);
    events.push({
      uid,
      title: trim(e.title) || 'Untitled event',
      start: new Date(e.start).toISOString(),
      end: isIso(e.end) ? new Date(e.end).toISOString() : new Date(e.start).toISOString(),
      allDay: !!e.allDay,
      location: trim(e.location) || null,
    });
    if (events.length >= MAX_EVENTS_PER_CALENDAR) break;
  }
  const truncated = Math.max(0, all.length - invalidDropped - echoDropped - events.length);
  return { events, echoDropped, invalidDropped, truncated };
}

/** Map sanitized events onto calendar_events rows (mirrors the URL-feed mapping). */
function buildEventRows(link, events) {
  return events.map((e) => ({
    household_id: link.household_id,
    title: e.title,
    description: null,
    start_time: e.start,
    end_time: e.end,
    all_day: e.allDay,
    location: e.location,
    color: link.color || 'sky',
    source_user_id: link.device_owner_user_id,
    external_feed_id: link.id,
    external_uid: e.uid,
    visibility: 'family',
  }));
}

/**
 * Find-or-create the link row for one device calendar, adopting a stale link
 * from a previous phone when the calendar name matches.
 *
 * `siblingCalendarIds` are the OTHER device calendar ids in the same sync
 * request. The name-adopt path must never grab a link that belongs to one of
 * those: two same-named calendars from different accounts (iCloud "Home" +
 * Google "Home") would otherwise collapse into one link and thrash it on
 * every sync, whichever order they're processed in.
 */
async function adoptOrCreateLink({ householdId, userId, deviceCalendarId, name, color, siblingCalendarIds = [] }) {
  const displayName = trim(name) || 'Device calendar';
  const exact = await db.findDeviceCalendarLink(householdId, userId, deviceCalendarId);
  if (exact) {
    if (exact.display_name !== displayName) {
      await db.updateDeviceCalendarLink(exact.id, { display_name: displayName });
      exact.display_name = displayName;
    }
    return exact;
  }
  const stale = await db.findDeviceLinkByOwnerAndName(householdId, userId, displayName);
  if (stale && !siblingCalendarIds.includes(stale.device_calendar_id)) {
    // New phone / reinstall: same person, same calendar name, new device-local
    // id. Adopt the existing row so its events + colour + history carry over.
    await db.updateDeviceCalendarLink(stale.id, {
      device_calendar_id: deviceCalendarId,
      feed_url: `device://${userId}/${deviceCalendarId}`,
    });
    return { ...stale, device_calendar_id: deviceCalendarId };
  }
  return db.createExternalFeed({
    household_id: householdId,
    user_id: userId,
    device_owner_user_id: userId,
    source: 'device',
    device_calendar_id: deviceCalendarId,
    feed_url: `device://${userId}/${deviceCalendarId}`,
    display_name: displayName,
    color: trim(color, 40) || 'sky',
  });
}

/**
 * Apply one device calendar's snapshot. Returns a per-calendar status the
 * route reports back to the app.
 */
async function syncDeviceCalendar({ householdId, userId, calendar, siblingCalendarIds = [] }) {
  const { deviceCalendarId, name, color, hash, windowStart, windowEnd } = calendar || {};
  if (!trim(deviceCalendarId, 400)) return { ok: false, error: 'deviceCalendarId is required' };
  if (!isIso(windowStart) || !isIso(windowEnd)) return { ok: false, error: 'windowStart/windowEnd must be ISO dates' };

  const link = await adoptOrCreateLink({
    householdId, userId, deviceCalendarId: trim(deviceCalendarId, 400), name, color, siblingCalendarIds,
  });

  const payloadHash = trim(hash, 128) || null;
  if (payloadHash && link.last_sync_hash === payloadHash) {
    await db.updateDeviceCalendarLink(link.id, { last_synced_at: new Date().toISOString() });
    return { ok: true, linkId: link.id, skipped: true };
  }

  // Bandwidth protocol: the client may send only the hash (no events array)
  // when it believes the server already has this payload. If the hashes
  // DON'T match (new/adopted link, or a dedupe-coupled calendar whose hash
  // we deliberately didn't store), ask for the full payload - NEVER treat a
  // missing events array as "the calendar is now empty".
  if (!Array.isArray(calendar.events)) {
    return { ok: false, linkId: link.id, needsEvents: true };
  }

  const { events, echoDropped, invalidDropped, truncated } = sanitizeEvents(calendar.events);

  // Household dedupe: skip events already present under a DIFFERENT link.
  // Device UIDs are `<seriesId>#<occurrenceISO>`; URL-feed rows store the
  // bare iCal UID (one-offs) or `<uid>_<date>` (recurring expansion). We
  // match both the full device uid (device-vs-device, two parents syncing
  // the same shared calendar) and the bare seriesId (device-vs-URL-feed
  // one-off events). Recurring URL-feed occurrences can still slip through -
  // the overlap-replace prompt steers users off duplicate sources.
  const bare = (uid) => uid.split('#')[0];
  const lookupUids = [...new Set(events.flatMap((e) => [e.uid, bare(e.uid)]))];
  const claimed = new Set(await db.findHouseholdUidsUnderOtherFeeds(householdId, lookupUids, link.id));
  const fresh = events.filter((e) => !claimed.has(e.uid) && !claimed.has(bare(e.uid)));
  const dedupedInHousehold = events.length - fresh.length;

  await db.replaceFeedEventsInWindow(link.id, windowStart, windowEnd, buildEventRows(link, fresh));
  await db.updateDeviceCalendarLink(link.id, {
    // When the dedupe dropped anything, DON'T store the hash: the dropped
    // events' presence depends on ANOTHER link's rows, which can disappear
    // (unlink cascades). A stored hash would make this calendar skip forever
    // while those events are missing; a null hash re-evaluates every sync.
    last_sync_hash: dedupedInHousehold > 0 ? null : payloadHash,
    last_synced_at: new Date().toISOString(),
    last_error: null,
    consecutive_failures: 0,
  });

  return {
    ok: true,
    linkId: link.id,
    applied: fresh.length,
    dedupedInHousehold,
    echoDropped,
    invalidDropped,
    truncated,
  };
}

module.exports = {
  HOUSEMAIT_UID_PREFIX,
  MAX_EVENTS_PER_CALENDAR,
  sanitizeEvents,
  buildEventRows,
  adoptOrCreateLink,
  syncDeviceCalendar,
};
