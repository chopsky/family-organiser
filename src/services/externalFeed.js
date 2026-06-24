const axios = require('axios');
const db = require('../db/queries');
const cache = require('./cache');
const { parseVEvent, expandRecurrence } = require('./providers/apple');
const { ssrfSafeAgents, assertFetchableUrl } = require('../utils/ssrf-guard');

const FETCH_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024; // 25 MB - sane upper bound for iCal feeds

/**
 * Normalise a user-pasted feed URL.
 *
 * Apple Calendar shares webcal:// links by default. For HTTP fetching we
 * need https://. Some sources tolerate either, but axios doesn't speak
 * webcal at all, so we rewrite at ingestion time. http:// is preserved
 * (rare but legitimate for self-hosted feeds).
 */
function normaliseFeedUrl(raw) {
  const trimmed = (raw || '').trim();
  if (trimmed.toLowerCase().startsWith('webcal://')) {
    return 'https://' + trimmed.slice('webcal://'.length);
  }
  return trimmed;
}

/**
 * Detect the URLs people ACTUALLY paste when they meant the iCal address -
 * the provider's web-app page, embed link, or site URL. Returning the
 * specific mistake lets the add-feed route reject with "here's what to copy
 * instead" rather than a generic failure after the pull 404s.
 * Returns a user-facing message, or null when the URL looks plausible.
 */
function classifyFeedUrlMistake(rawUrl) {
  let u;
  try {
    u = new URL(normaliseFeedUrl(rawUrl));
  } catch {
    return null; // not a URL at all - the route's protocol check reports that
  }
  const host = u.hostname.toLowerCase();
  const path = u.pathname;

  if (host === 'calendar.google.com') {
    if (path.startsWith('/calendar/embed')) {
      return "That's Google's embed link (for websites), not the calendar's address. In Google Calendar settings, scroll to \"Integrate calendar\" and copy \"Secret address in iCal format\" instead.";
    }
    // The web app / settings UI lives under /calendar/r or /calendar/u/<n>/r.
    if (/^\/calendar(\/u\/\d+)?\/r(\/|$)/.test(path)) {
      return "That's the Google Calendar page URL, not the calendar's address. On that settings page, scroll to \"Integrate calendar\" and copy \"Secret address in iCal format\".";
    }
    return null; // /calendar/ical/... is the real thing
  }
  if (host === 'outlook.live.com' || host === 'outlook.office.com' || host === 'outlook.office365.com') {
    // Published feeds live under /owa/calendar/.../calendar.ics; anything
    // under /calendar that isn't an .ics is the web app itself.
    if (path.startsWith('/calendar') && !/\.ics$/i.test(path)) {
      return "That's the Outlook web page URL, not a calendar address. In Outlook: Settings → Calendar → Shared calendars → \"Publish a calendar\" → pick \"Can view all details\" → Publish, then copy the ICS link it shows.";
    }
    return null;
  }
  if (host === 'icloud.com' || host === 'www.icloud.com') {
    return "That's the iCloud website URL, not a calendar address. In iCloud Calendar, click the share icon next to the calendar, tick \"Public Calendar\", and copy the webcal:// link it shows.";
  }
  return null;
}

/**
 * Turn an initial-pull failure into actionable guidance where the URL shape
 * tells us what went wrong. Returns { message, permanent } - permanent=true
 * means the URL will NEVER work as pasted (wrong address kind), so the
 * caller should drop the feed row instead of leaving a forever-failing
 * subscription behind.
 */
function friendlyPullError(rawUrl, errMessage) {
  const msg = errMessage || 'Could not fetch the calendar.';
  const url = normaliseFeedUrl(rawUrl);
  // Google's PUBLIC address only resolves when the calendar is made public -
  // people copy it because it sits right above the secret one. Only the
  // auth/not-found statuses mean "wrong address kind"; 429/408 etc. are
  // transient and must NOT delete a working feed on a rate-limited first pull.
  if (/calendar\.google\.com\/calendar\/ical\/.+\/public\/basic\.ics/i.test(url) && /HTTP (401|403|404|410)\b/.test(msg)) {
    return {
      message: 'This is Google\'s "Public address", which only works if the calendar is made public. Copy the "Secret address in iCal format" instead - it\'s just below it on the same settings page and needs no other changes.',
      permanent: true,
    };
  }
  if (/not an iCalendar document/i.test(msg)) {
    // An .ics-looking path serving HTML is usually a TRANSIENT challenge/
    // maintenance page in front of a real feed - keep the row and let the
    // cron retry. A non-.ics path serving HTML is a pasted page URL.
    if (/\.ics(\?|$)/i.test(url)) {
      return { message: msg, permanent: false };
    }
    return {
      message: 'That address returns a web page, not calendar data. Make sure you copied the calendar\'s iCal/ICS address - for Google it\'s "Secret address in iCal format" under Integrate calendar; for Outlook it\'s the ICS link under "Publish a calendar".',
      permanent: true,
    };
  }
  return { message: msg, permanent: false };
}

/**
 * GET the iCal feed and return the response body as text.
 *
 * Bounded by a 30s timeout and a 25MB max-content-length so a malicious
 * or runaway feed can't tie up a worker or blow memory. The Accept
 * header advertises text/calendar but we don't reject other types -
 * some servers serve text/plain or octet-stream for .ics files.
 */
async function fetchFeed(feedUrl) {
  const url = normaliseFeedUrl(feedUrl);
  // SSRF guard: reject non-http(s) / credentialed / literal-private URLs up
  // front, and route the request through agents whose DNS lookup refuses to
  // connect to private/loopback/link-local addresses (incl. on redirects).
  assertFetchableUrl(url);
  const { httpAgent, httpsAgent } = ssrfSafeAgents();
  const response = await axios.get(url, {
    timeout: FETCH_TIMEOUT_MS,
    maxContentLength: MAX_RESPONSE_BYTES,
    maxBodyLength: MAX_RESPONSE_BYTES,
    responseType: 'text',
    httpAgent,
    httpsAgent,
    // A few redirects are fine for real feeds; each hop re-resolves through
    // the SSRF-safe lookup above, so it can't be bounced to an internal host.
    maxRedirects: 3,
    headers: {
      Accept: 'text/calendar, text/plain, */*',
      // Identify ourselves so feed providers can attribute traffic.
      'User-Agent': 'Housemait-CalendarFeed/1.0 (+https://housemait.com)',
    },
    // Don't auto-throw on 4xx so the caller gets a useful status code.
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Feed returned HTTP ${response.status}`);
  }
  return typeof response.data === 'string' ? response.data : String(response.data);
}

/**
 * Pull every VEVENT block out of the iCal text. Returns an array of
 * raw VEVENT strings (each still in BEGIN:VEVENT...END:VEVENT form so
 * parseVEvent can take them as-is).
 */
function extractVEvents(icalText) {
  if (!icalText || typeof icalText !== 'string') return [];
  const matches = icalText.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g);
  return matches || [];
}

/**
 * Convert a single iCal VEVENT into one or more event records ready to
 * upsert. Recurring events (those with an RRULE) get expanded into per-
 * occurrence records via the existing apple.js helper, which gives us
 * dated externalEventIds (`<uid>_2026-04-30` etc.) so each instance
 * upserts independently. Non-recurring events return a single record.
 */
function vEventToRecords(vevent) {
  const uidMatch = vevent.match(/^UID[^:]*:(.*)$/m);
  const externalEventId = uidMatch ? uidMatch[1].trim() : null;
  if (!externalEventId) return [];

  const eventData = parseVEvent(vevent);
  const expanded = expandRecurrence(eventData, externalEventId);

  if (expanded && expanded.length > 0) {
    return expanded.map((instance) => ({
      external_uid: instance.externalEventId,
      ...instance.eventData,
    }));
  }
  return [{
    external_uid: externalEventId,
    title: eventData.title,
    description: eventData.description,
    location: eventData.location,
    start_time: eventData.start_time,
    end_time: eventData.end_time,
    all_day: eventData.all_day,
  }];
}

/**
 * Pull a feed and reconcile its events against the rows currently in
 * Housemait for this feed.
 *
 * Strategy:
 *   1. Fetch + parse + expand → record set keyed by external_uid
 *   2. Load existing events for this feed (uid → row)
 *   3. Upsert anything in the new set
 *   4. Soft-delete anything in the old set that's no longer in the feed,
 *      with the same 7-day guard processChange already uses (events
 *      ending less than 7 days ago survive - protects against feed
 *      providers that occasionally serve a partial response).
 *
 * Returns a stats object the caller can show / log.
 */
async function refreshFeed(feed) {
  const stats = { fetched: 0, created: 0, updated: 0, deleted: 0, skipped_recent_delete: 0 };

  let icalText;
  try {
    icalText = await fetchFeed(feed.feed_url);
    // Providers serve HTML login/challenge/maintenance pages with HTTP 200
    // (Cloudflare, lapsed O365 auth). Parsed as iCal that reads as "the feed
    // now has zero events" and would wipe every synced copy - so a body
    // without a VCALENDAR envelope is a fetch FAILURE, not an empty feed.
    if (!/BEGIN:VCALENDAR/i.test(icalText)) {
      throw new Error('Feed response is not an iCalendar document');
    }
  } catch (err) {
    await db.recordExternalFeedFailure(feed.id, err.message || String(err));
    throw err;
  }

  const vevents = extractVEvents(icalText);
  const rawRecords = [];
  // UIDs of VEVENTs our parser choked on: the provider still publishes
  // them, so their existing rows must NOT be treated as stale and deleted.
  const unparseableUids = [];
  for (const v of vevents) {
    try {
      rawRecords.push(...vEventToRecords(v));
    } catch (err) {
      const uid = (v.match(/^UID[^:]*:(.*)$/m) || [])[1];
      if (uid && uid.trim()) unparseableUids.push(uid.trim());
      console.warn(`[external-feed ${feed.id}] failed to parse a VEVENT:`, err.message);
    }
  }

  // Dedupe by external_uid - feeds occasionally contain the same UID
  // more than once (EXCEPTION events, duplicate VEVENTs from poorly-
  // behaved exporters). Without this, two records with the same UID
  // would race the upsert and double-count in stats. Last-write-wins:
  // later records replace earlier ones, which is what we want for
  // RECURRENCE-ID exception entries that follow the master.
  const recordsByUid = new Map();
  for (const r of rawRecords) {
    if (r.external_uid) recordsByUid.set(r.external_uid, r);
  }
  const records = Array.from(recordsByUid.values());
  stats.fetched = records.length;

  // Load existing events keyed by external_uid so we can tell what's
  // an update vs a create (purely for the stats counters - the actual
  // write uses batched upsert and doesn't care).
  const existing = await db.getExternalFeedEvents(feed.id);
  const existingByUid = new Map(existing.map((e) => [e.external_uid, e]));

  // Attribution: a synced calendar inherits its owner member's colour and is
  // assigned to them (or a neutral "Shared" colour with no assignee when the
  // feed has no owner). Resolved once per refresh.
  const attr = await db.getFeedAttribution(feed);

  // Build the row payload up-front so the batched upsert is a single
  // round-trip. Doing this per-row used to be the bottleneck - Apple
  // iCloud Family calendars expand into 5k–20k rows once recurrence is
  // applied across the 18-month window, and one HTTP call per row made
  // refreshes take minutes. One bulk call brings it back to seconds.
  const rows = records.map((rec) => {
    if (existingByUid.has(rec.external_uid)) {
      existingByUid.delete(rec.external_uid);
      stats.updated += 1;
    } else {
      stats.created += 1;
    }
    return {
      household_id: feed.household_id,
      title: rec.title || 'Untitled event',
      description: rec.description || null,
      start_time: rec.start_time,
      end_time: rec.end_time || rec.start_time,
      all_day: !!rec.all_day,
      location: rec.location || null,
      color: attr.color,
      assigned_to_ids: attr.assignedIds,
      assigned_to_names: attr.assignedNames,
      source_user_id: feed.user_id,
      external_feed_id: feed.id,
      external_uid: rec.external_uid,
      visibility: 'family',
    };
  });

  // Defensive: duplicate-uid pairs within a single INSERT batch make
  // Postgres throw "duplicate key violates unique constraint" rather
  // than letting ON CONFLICT resolve them - ON CONFLICT only handles
  // row-vs-table conflicts, not row-vs-row within the same statement.
  // The dedup-by-uid step above should make this impossible, but guard
  // anyway and surface a useful error if a quirky feed slips through.
  const seenUids = new Set();
  for (const r of rows) {
    if (seenUids.has(r.external_uid)) {
      throw new Error(
        `Internal: duplicate external_uid "${r.external_uid}" in upsert batch - ` +
        `dedup logic missed it. Feed=${feed.id}`
      );
    }
    seenUids.add(r.external_uid);
  }

  console.log(
    `[external-feed ${feed.id}] preparing ${rows.length} rows ` +
    `(raw=${rawRecords.length}, deduped=${records.length})`
  );

  // Chunk to stay well under Supabase's request payload cap. 500 rows
  // per chunk is a comfortable default - well below the ~10MB ceiling
  // even with verbose descriptions, and small enough that retries are
  // cheap if a chunk fails.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.batchUpsertExternalFeedEvents(rows.slice(i, i + CHUNK));
  }

  // Anything still in existingByUid wasn't in this pull = candidate delete.
  // Deletions MUST propagate - including FUTURE ones: when a school removes a
  // cancelled fixture from its published feed, the event has to disappear
  // here too. (The old guard skipped anything ending "less than 7 days ago
  // or in the future", so future cancellations never propagated and families
  // could turn up to cancelled events.) The failure that guard existed for
  // is a provider serving a PARTIAL response, so detect that directly with a
  // TWO-CYCLE confirmation: a pull that lost more than half the held events
  // (or all of them) has its deletes withheld, and they only apply when the
  // NEXT pull returns the same shrunken size - a transient partial response
  // doesn't repeat at an identical size, a real shrink does. The pending
  // size rides on last_error (visible in sync health) so a one-shot bad
  // pull can never wipe a feed, while legitimate mass removals settle on
  // the following refresh instead of deadlocking forever.
  const heldBefore = stats.updated + existingByUid.size;
  const prevPartial = typeof feed.last_error === 'string'
    ? feed.last_error.match(/^partial-pull:(\d+)\b/)
    : null;
  // Small tolerance so an actively-edited feed whose count drifts a row or
  // two between refreshes still confirms instead of re-arming forever.
  const prevCount = prevPartial ? Number(prevPartial[1]) : null;
  const shrinkConfirmed = prevCount !== null
    && Math.abs(prevCount - rows.length) <= Math.max(2, Math.ceil(prevCount * 0.05));
  const looksShrunk = existingByUid.size > 0
    && (rows.length === 0 || rows.length < heldBefore * 0.5);
  const looksPartial = looksShrunk && !shrinkConfirmed;
  const isUnparseable = (extUid) => unparseableUids.some(
    (u) => extUid === u || extUid.startsWith(`${u}_`)
  );
  const toDelete = [];
  if (looksPartial) {
    stats.skipped_recent_delete = existingByUid.size;
    console.warn(
      `[external-feed ${feed.id}] pull looks partial (${rows.length} fetched vs ${heldBefore} held) - withholding ${existingByUid.size} deletes until confirmed`
    );
  } else {
    for (const stale of existingByUid.values()) {
      // Still published, we just couldn't parse it - keep its row.
      if (unparseableUids.length > 0 && isUnparseable(stale.external_uid)) {
        stats.skipped_recent_delete += 1;
        continue;
      }
      toDelete.push(stale.id);
    }
  }
  if (toDelete.length > 0) {
    // Same chunk size as upsert for consistency.
    for (let i = 0; i < toDelete.length; i += CHUNK) {
      await db.batchSoftDeleteCalendarEvents(toDelete.slice(i, i + CHUNK), feed.household_id);
    }
    stats.deleted = toDelete.length;
  }

  if (looksPartial) {
    // Not a success (would clear the pending marker) and not a failure
    // (the upserts landed): stamp last_synced_at + the marker the next
    // refresh checks to confirm or discard the shrink.
    await db.recordExternalFeedPartial(
      feed.id,
      `partial-pull:${rows.length} (provider returned ${rows.length} of ${heldBefore} held events - deletions withheld until the next refresh confirms)`
    );
  } else {
    await db.recordExternalFeedSuccess(feed.id);
  }

  // Invalidate the month-of-events cache so the calendar view picks up
  // newly-pulled events on the next read. Without this, the local API's
  // in-memory cache happily serves the pre-feed-pull view for up to its
  // TTL - meaning users hit Refresh, the count goes up, but the calendar
  // still looks empty until restart. Mirrors the pattern used by the
  // calendar mutation routes (create/update/delete event).
  cache.invalidatePattern(`cal-month:${feed.household_id}:`);
  cache.invalidatePattern(`cal-events:${feed.household_id}:`);

  return stats;
}

module.exports = {
  normaliseFeedUrl,
  classifyFeedUrlMistake,
  friendlyPullError,
  fetchFeed,
  extractVEvents,
  vEventToRecords,
  refreshFeed,
};
