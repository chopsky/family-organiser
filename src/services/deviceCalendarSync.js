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
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

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
    // All-day events arrive as device-LOCAL date-only strings (the bridge
    // formats them in the phone's timezone), because a UTC timestamp shifts
    // them across midnight outside UTC - "12 June" became 11 June for the
    // whole of British Summer Time. Pin them to the app's all-day convention:
    // the date portion of the stored string IS the display day, with the end
    // inclusive so multi-day banners span correctly.
    let start;
    let end;
    if (e.allDay && DATE_ONLY.test(e.start)) {
      // Year sanity: a device formatter that slipped off the Gregorian
      // calendar (Buddhist 2569, Japanese era 0008) produces a date the
      // regex accepts but that would persist centuries away under a stable
      // UID. Better to drop the event than store a corrupt row.
      const year = Number(e.start.slice(0, 4));
      if (year < 1900 || year > 2200) { invalidDropped += 1; continue; }
      start = `${e.start}T00:00:00.000Z`;
      end = DATE_ONLY.test(e.end) ? `${e.end}T23:59:59.000Z` : `${e.start}T23:59:59.000Z`;
    } else {
      start = new Date(e.start).toISOString();
      end = isIso(e.end) ? new Date(e.end).toISOString() : start;
    }
    events.push({
      uid,
      title: trim(e.title) || 'Untitled event',
      start,
      end,
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

  // TOMBSTONED link (removed from the web): tell the phone to drop this
  // calendar from its local selection instead of resurrecting it. The quiet
  // sync right after a web removal still contains the calendar - it must NOT
  // re-enable. Only an EXPLICIT picker save (calendar.reenable === true) can
  // turn a tombstoned link back on, because by then the client has already
  // dropped the id and a re-tick is a deliberate user choice.
  if (link.sync_enabled === false) {
    if (calendar.reenable === true) {
      await db.updateDeviceCalendarLink(link.id, { sync_enabled: true });
      link.sync_enabled = true;
    } else {
      // Sweep any leftover events. A sync that was already in flight when
      // the web removal landed can re-insert the full event set AFTER the
      // removal deleted it - those rows would be stranded forever (the
      // phone drops the calendar from its selection, so no later sync
      // touches them, and synced events are read-only everywhere else).
      // Idempotent, and self-heals previously stranded rows.
      await db.deleteEventsForFeed(link.id);
      return { ok: false, linkId: link.id, disabled: true };
    }
  }

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
  const claimedRows = await db.findHouseholdUidsUnderOtherFeeds(householdId, lookupUids, link.id);
  const claimed = new Set(claimedRows.map((r) => r.uid));
  const fresh = events.filter((e) => !claimed.has(e.uid) && !claimed.has(bare(e.uid)));
  const dedupedInHousehold = events.length - fresh.length;

  // Migration aid: when the duplicates live under a URL-FEED link, the user
  // is subscribed to this calendar twice (the old copy-a-URL flow + device
  // sync). Surface those feeds so the app can offer one-tap removal of the
  // obsolete subscription. Device-vs-device overlap (two parents, one shared
  // calendar) is normal and intentionally NOT surfaced.
  const overlappingFeeds = [];
  const overlapFeedIds = [...new Set(claimedRows.map((r) => r.feedId))];
  for (const feedId of overlapFeedIds.slice(0, 5)) {
    const feed = await db.getExternalFeedById(feedId);
    if (feed && feed.source !== 'device') {
      overlappingFeeds.push({ id: feed.id, displayName: feed.display_name });
    }
  }

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
    overlappingFeeds,
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
