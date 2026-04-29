const axios = require('axios');
const db = require('../db/queries');
const cache = require('./cache');
const { parseVEvent, expandRecurrence } = require('./providers/apple');

const FETCH_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024; // 25 MB — sane upper bound for iCal feeds

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
 * GET the iCal feed and return the response body as text.
 *
 * Bounded by a 30s timeout and a 25MB max-content-length so a malicious
 * or runaway feed can't tie up a worker or blow memory. The Accept
 * header advertises text/calendar but we don't reject other types —
 * some servers serve text/plain or octet-stream for .ics files.
 */
async function fetchFeed(feedUrl) {
  const url = normaliseFeedUrl(feedUrl);
  const response = await axios.get(url, {
    timeout: FETCH_TIMEOUT_MS,
    maxContentLength: MAX_RESPONSE_BYTES,
    maxBodyLength: MAX_RESPONSE_BYTES,
    responseType: 'text',
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
 *      ending less than 7 days ago survive — protects against feed
 *      providers that occasionally serve a partial response).
 *
 * Returns a stats object the caller can show / log.
 */
async function refreshFeed(feed) {
  const stats = { fetched: 0, created: 0, updated: 0, deleted: 0, skipped_recent_delete: 0 };

  let icalText;
  try {
    icalText = await fetchFeed(feed.feed_url);
  } catch (err) {
    await db.recordExternalFeedFailure(feed.id, err.message || String(err));
    throw err;
  }

  const vevents = extractVEvents(icalText);
  const rawRecords = [];
  for (const v of vevents) {
    try {
      rawRecords.push(...vEventToRecords(v));
    } catch (err) {
      console.warn(`[external-feed ${feed.id}] failed to parse a VEVENT:`, err.message);
    }
  }

  // Dedupe by external_uid — feeds occasionally contain the same UID
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
  // an update vs a create (purely for the stats counters — the actual
  // write uses batched upsert and doesn't care).
  const existing = await db.getExternalFeedEvents(feed.id);
  const existingByUid = new Map(existing.map((e) => [e.external_uid, e]));

  // Build the row payload up-front so the batched upsert is a single
  // round-trip. Doing this per-row used to be the bottleneck — Apple
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
      color: feed.color || 'sky',
      source_user_id: feed.user_id,
      external_feed_id: feed.id,
      external_uid: rec.external_uid,
      visibility: 'family',
    };
  });

  // Defensive: duplicate-uid pairs within a single INSERT batch make
  // Postgres throw "duplicate key violates unique constraint" rather
  // than letting ON CONFLICT resolve them — ON CONFLICT only handles
  // row-vs-table conflicts, not row-vs-row within the same statement.
  // The dedup-by-uid step above should make this impossible, but guard
  // anyway and surface a useful error if a quirky feed slips through.
  const seenUids = new Set();
  for (const r of rows) {
    if (seenUids.has(r.external_uid)) {
      throw new Error(
        `Internal: duplicate external_uid "${r.external_uid}" in upsert batch — ` +
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
  // per chunk is a comfortable default — well below the ~10MB ceiling
  // even with verbose descriptions, and small enough that retries are
  // cheap if a chunk fails.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.batchUpsertExternalFeedEvents(rows.slice(i, i + CHUNK));
  }

  // Anything still in existingByUid wasn't in this pull = candidate
  // delete. Apply the 7-day guard: if the event ended less than 7 days
  // ago (or is in the future), skip — protects against a feed provider
  // serving a partial response. Then batch-soft-delete the rest in one
  // round-trip.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const toDelete = [];
  for (const stale of existingByUid.values()) {
    const eventEnd = new Date(stale.end_time || stale.start_time);
    if (eventEnd > sevenDaysAgo) {
      stats.skipped_recent_delete += 1;
      continue;
    }
    toDelete.push(stale.id);
  }
  if (toDelete.length > 0) {
    // Same chunk size as upsert for consistency.
    for (let i = 0; i < toDelete.length; i += CHUNK) {
      await db.batchSoftDeleteCalendarEvents(toDelete.slice(i, i + CHUNK), feed.household_id);
    }
    stats.deleted = toDelete.length;
  }

  await db.recordExternalFeedSuccess(feed.id);

  // Invalidate the month-of-events cache so the calendar view picks up
  // newly-pulled events on the next read. Without this, the local API's
  // in-memory cache happily serves the pre-feed-pull view for up to its
  // TTL — meaning users hit Refresh, the count goes up, but the calendar
  // still looks empty until restart. Mirrors the pattern used by the
  // calendar mutation routes (create/update/delete event).
  cache.invalidatePattern(`cal-month:${feed.household_id}:`);
  cache.invalidatePattern(`cal-events:${feed.household_id}:`);

  return stats;
}

module.exports = {
  normaliseFeedUrl,
  fetchFeed,
  extractVEvents,
  vEventToRecords,
  refreshFeed,
};
