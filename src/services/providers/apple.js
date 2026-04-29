// Apple/CalDAV provider — reduced to read-only utilities + cleanup helper.
//
// Two-way sync was removed in favour of read-only inbound iCal feeds
// (see src/services/externalFeed.js + the external_calendar_feeds
// table). The OAuth/CalDAV push, pull, listCalendars, validateCredentials,
// initial-import paths are all gone. What remains:
//
//   - parseVEvent / expandRecurrence: re-used by externalFeed.js for the
//     inbound iCal feed parser. They could move to a shared utility file;
//     leaving them here for now since they're battle-tested.
//   - deleteEventsBatch: used by the disconnect-cleanup endpoint on the
//     off-chance any future user is mid-migration with leftover
//     sync_mappings pointing at events Housemait once pushed into their
//     Apple Calendar.

// Lazy-load tsdav via dynamic import — it's ESM-only and can't use require()
let _DAVClient = null;
async function getDAVClient() {
  if (!_DAVClient) {
    const tsdav = await import('tsdav');
    _DAVClient = tsdav.DAVClient;
  }
  return _DAVClient;
}

const { rrulestr } = require('rrule');

const CALDAV_SERVER_URL = 'https://caldav.icloud.com';

/**
 * Parse a VEVENT from iCal data into a Anora event object.
 * Extracts the VEVENT block first to avoid matching properties from
 * VTIMEZONE or other components (which have their own DTSTART etc.).
 */
function parseVEvent(icalData) {
  // Extract just the VEVENT block to avoid matching VTIMEZONE properties
  const veventMatch = icalData.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/);
  const veventBlock = veventMatch ? veventMatch[0] : icalData;

  // Unfold iCal line continuations (RFC 5545: lines folded with CRLF + space/tab)
  const unfolded = veventBlock.replace(/\r?\n[ \t]/g, '');

  const getValue = (key) => {
    const regex = new RegExp(`^${key}[^:]*:(.*)$`, 'm');
    const match = unfolded.match(regex);
    return match ? match[1].trim() : '';
  };

  // Extract TZID from DTSTART/DTEND if present
  const getTzid = (key) => {
    const regex = new RegExp(`^${key};[^:]*TZID=([^;:]+)`, 'm');
    const match = unfolded.match(regex);
    return match ? match[1].trim() : null;
  };

  const dtstart = getValue('DTSTART');
  const dtend = getValue('DTEND');
  const startTzid = getTzid('DTSTART');
  const endTzid = getTzid('DTEND');
  const allDay = dtstart.length === 8;

  /**
   * Convert a local datetime string + timezone into a UTC ISO string.
   * E.g. "20260329T100000" with TZID "Europe/London" → "2026-03-29T09:00:00Z"
   * because BST (UTC+1) is in effect on that date.
   *
   * Uses a two-pass iterative approach to correctly handle DST transitions
   * and month-boundary crossings.
   */
  const localToUtc = (value, tzid) => {
    const year = parseInt(value.substring(0, 4));
    const month = parseInt(value.substring(4, 6)) - 1;
    const day = parseInt(value.substring(6, 8));
    const hour = parseInt(value.substring(9, 11));
    const min = parseInt(value.substring(11, 13));
    const sec = parseInt(value.substring(13, 15));

    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tzid,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      });

      // Helper: extract full date/time from formatter parts and compute offset in ms
      const getOffsetMs = (utcInstant) => {
        const parts = formatter.formatToParts(utcInstant);
        const tzYear = parseInt(parts.find(p => p.type === 'year').value);
        const tzMonth = parseInt(parts.find(p => p.type === 'month').value) - 1;
        const tzDay = parseInt(parts.find(p => p.type === 'day').value);
        let tzHour = parseInt(parts.find(p => p.type === 'hour').value);
        // Intl hour12:false gives 24 for midnight in some engines
        if (tzHour === 24) tzHour = 0;
        const tzMin = parseInt(parts.find(p => p.type === 'minute').value);
        const tzSec = parseInt(parts.find(p => p.type === 'second').value);
        // What the timezone thinks this instant is (as a UTC-equivalent timestamp)
        const tzAsUtc = Date.UTC(tzYear, tzMonth, tzDay, tzHour, tzMin, tzSec);
        // Offset = tzLocal - utc  (positive means timezone is ahead of UTC)
        return tzAsUtc - utcInstant.getTime();
      };

      // Pass 1: assume local time IS UTC, find approximate offset
      const guess1 = new Date(Date.UTC(year, month, day, hour, min, sec));
      const offset1 = getOffsetMs(guess1);

      // Pass 2: subtract offset to get better UTC guess, recalculate offset
      // This handles DST boundaries where pass 1's offset was for wrong side of transition
      const guess2 = new Date(Date.UTC(year, month, day, hour, min, sec) - offset1);
      const offset2 = getOffsetMs(guess2);

      // Use the second (refined) offset for the final conversion
      const utcDate = new Date(Date.UTC(year, month, day, hour, min, sec) - offset2);
      return utcDate.toISOString().replace('.000Z', 'Z');
    } catch {
      // If timezone conversion fails, fall back to treating as UTC
      return `${value.substring(0, 4)}-${value.substring(4, 6)}-${value.substring(6, 8)}T${value.substring(9, 11)}:${value.substring(11, 13)}:${value.substring(13, 15)}Z`;
    }
  };

  const parseICalDate = (value, tzid) => {
    if (value.length === 8) {
      // DATE format: YYYYMMDD
      const year = value.substring(0, 4);
      const month = value.substring(4, 6);
      const day = value.substring(6, 8);
      return `${year}-${month}-${day}`;
    }
    // If value already ends with Z, it's already UTC
    if (value.endsWith('Z')) {
      const year = value.substring(0, 4);
      const month = value.substring(4, 6);
      const day = value.substring(6, 8);
      const hour = value.substring(9, 11);
      const min = value.substring(11, 13);
      const sec = value.substring(13, 15);
      return `${year}-${month}-${day}T${hour}:${min}:${sec}Z`;
    }
    // If we have a TZID, convert local time to UTC
    if (tzid) {
      return localToUtc(value, tzid);
    }
    // No Z and no TZID — treat as UTC (legacy fallback)
    const year = value.substring(0, 4);
    const month = value.substring(4, 6);
    const day = value.substring(6, 8);
    const hour = value.substring(9, 11);
    const min = value.substring(11, 13);
    const sec = value.substring(13, 15);
    return `${year}-${month}-${day}T${hour}:${min}:${sec}Z`;
  };

  let endTime = dtend ? parseICalDate(dtend, endTzid || startTzid) : parseICalDate(dtstart, startTzid);

  // iCalendar all-day events use an exclusive end date (DTEND is the day AFTER the event).
  // Subtract one day so the app doesn't show the event bleeding into the next day.
  // Defensive: if DTEND was actually inclusive (a non-compliant source — including
  // our own historical pushes before the buildVEvent fix), subtracting would land
  // BEFORE start_time. In that case the source clearly wasn't using exclusive end —
  // fall back to treating DTEND as the same day as start (single-day event). Keeps
  // the pull idempotent for legacy Apple-stored events that still have the old
  // non-compliant DTEND. Multi-day non-compliant events are still off by one and
  // need to be re-pushed; they'll self-heal next time the user touches them.
  if (allDay && dtend && dtend.length === 8) {
    const d = new Date(endTime + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const subtracted = `${y}-${m}-${dd}`;
    const startDay = parseICalDate(dtstart, startTzid).slice(0, 10);
    endTime = subtracted < startDay ? startDay : subtracted;
  }

  return {
    title: getValue('SUMMARY'),
    description: getValue('DESCRIPTION'),
    location: getValue('LOCATION'),
    start_time: parseICalDate(dtstart, startTzid),
    end_time: endTime,
    all_day: allDay,
    rrule: getValue('RRULE') || null,
    _rawDtstart: dtstart,
    _startTzid: startTzid || null,
  };
}

/**
 * Convert a local date/time in a specific timezone to a UTC ISO string.
 * Used by expandRecurrence to individually convert each occurrence,
 * so DST is correctly applied per-date (e.g. GMT vs BST).
 */
function localDateToUtc(year, month, day, hour, min, sec, tzid) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tzid,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });

    const getOffsetMs = (utcInstant) => {
      const parts = formatter.formatToParts(utcInstant);
      const tzYear = parseInt(parts.find(p => p.type === 'year').value);
      const tzMonth = parseInt(parts.find(p => p.type === 'month').value) - 1;
      const tzDay = parseInt(parts.find(p => p.type === 'day').value);
      let tzHour = parseInt(parts.find(p => p.type === 'hour').value);
      if (tzHour === 24) tzHour = 0;
      const tzMin = parseInt(parts.find(p => p.type === 'minute').value);
      const tzSec = parseInt(parts.find(p => p.type === 'second').value);
      const tzAsUtc = Date.UTC(tzYear, tzMonth, tzDay, tzHour, tzMin, tzSec);
      return tzAsUtc - utcInstant.getTime();
    };

    const guess1 = new Date(Date.UTC(year, month, day, hour, min, sec));
    const offset1 = getOffsetMs(guess1);
    const guess2 = new Date(Date.UTC(year, month, day, hour, min, sec) - offset1);
    const offset2 = getOffsetMs(guess2);
    return new Date(Date.UTC(year, month, day, hour, min, sec) - offset2);
  } catch {
    return new Date(Date.UTC(year, month, day, hour, min, sec));
  }
}

/**
 * Expand a recurring event into individual instances.
 * Returns an array of eventData objects (one per occurrence).
 * Window: 6 months in past → 12 months in future (matches Google/Microsoft).
 *
 * KEY: Expansion happens in *local time* (the event's original timezone) so that:
 *  1. RRULE UNTIL boundaries are evaluated correctly (UNTIL is local)
 *  2. Each occurrence is then individually converted to UTC, so DST changes
 *     (e.g. GMT → BST) are applied per-date rather than using a fixed offset.
 */
function expandRecurrence(eventData, externalEventId) {
  if (!eventData.rrule) return null;

  try {
    const windowStart = new Date();
    windowStart.setMonth(windowStart.getMonth() - 6);
    const windowEnd = new Date();
    windowEnd.setMonth(windowEnd.getMonth() + 12);

    const rawDt = eventData._rawDtstart;
    const tzid = eventData._startTzid;

    if (eventData.all_day || rawDt.length === 8) {
      // All-day event — expand with raw date, no timezone conversion needed
      const rule = rrulestr(`DTSTART:${rawDt}\nRRULE:${eventData.rrule}`);
      const occurrences = rule.between(windowStart, windowEnd, true);

      return occurrences.map((occDate) => ({
        externalEventId: `${externalEventId}_${occDate.toISOString().split('T')[0]}`,
        eventData: {
          title: eventData.title,
          description: eventData.description,
          location: eventData.location,
          start_time: occDate.toISOString().split('T')[0],
          end_time: occDate.toISOString().split('T')[0],
          all_day: true,
        },
      }));
    }

    // Timed event — calculate duration from the already-converted UTC times
    const startMs = new Date(eventData.start_time).getTime();
    const endMs = new Date(eventData.end_time).getTime();
    const durationMs = endMs - startMs;

    if (tzid && !rawDt.endsWith('Z')) {
      // ── DST-aware expansion ──
      // Expand in LOCAL time so UNTIL boundaries and occurrence dates are correct,
      // then convert each occurrence individually to UTC.
      // Use raw local DTSTART (without Z) so rrule treats it as local.
      const rule = rrulestr(`DTSTART:${rawDt}\nRRULE:${eventData.rrule}`, { tzid });
      const occurrences = rule.between(windowStart, windowEnd, true);

      return occurrences.map((occDate) => {
        // rrule gives us a Date object — extract the local time components it represents
        // For rrule with tzid, the occurrence dates represent local times
        const occYear = occDate.getUTCFullYear();
        const occMonth = occDate.getUTCMonth();
        const occDay = occDate.getUTCDate();
        const occHour = occDate.getUTCHours();
        const occMin = occDate.getUTCMinutes();
        const occSec = occDate.getUTCSeconds();

        // Convert this local time to UTC using the timezone (DST-aware per-date)
        const utcStart = localDateToUtc(occYear, occMonth, occDay, occHour, occMin, occSec, tzid);
        const utcEnd = new Date(utcStart.getTime() + durationMs);

        const dateStr = `${occYear}-${String(occMonth + 1).padStart(2, '0')}-${String(occDay).padStart(2, '0')}`;

        return {
          externalEventId: `${externalEventId}_${dateStr}`,
          eventData: {
            title: eventData.title,
            description: eventData.description,
            location: eventData.location,
            start_time: utcStart.toISOString().replace('.000Z', 'Z'),
            end_time: utcEnd.toISOString().replace('.000Z', 'Z'),
            all_day: false,
          },
        };
      });
    }

    // ── No timezone (already UTC) — use existing approach ──
    const dtStartStr = rawDt.endsWith('Z') ? rawDt : eventData.start_time.replace(/[-:]/g, '');
    const rule = rrulestr(`DTSTART:${dtStartStr}\nRRULE:${eventData.rrule}`);
    const occurrences = rule.between(windowStart, windowEnd, true);

    return occurrences.map((occDate) => {
      const occEnd = new Date(occDate.getTime() + durationMs);
      return {
        externalEventId: `${externalEventId}_${occDate.toISOString().split('T')[0]}`,
        eventData: {
          title: eventData.title,
          description: eventData.description,
          location: eventData.location,
          start_time: occDate.toISOString().replace('.000Z', 'Z'),
          end_time: occEnd.toISOString().replace('.000Z', 'Z'),
          all_day: false,
        },
      };
    });
  } catch (err) {
    console.error('Failed to expand RRULE for event:', externalEventId, err.message);
    return null;
  }
}

/**
 * Create and return a DAVClient connected to Apple's CalDAV server.
 */
async function connect(connection) {
  const DAVClient = await getDAVClient();
  const client = new DAVClient({
    serverUrl: CALDAV_SERVER_URL,
    credentials: {
      username: connection.caldav_username,
      password: connection.access_token,
    },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });

  await client.login();
  return client;
}

/**
 * Find the target calendar from the user's calendars.
 * Uses external_calendar_id if set, otherwise defaults to the first calendar.
 */
function findCalendar(calendars, connection) {
  if (connection.external_calendar_id) {
    const match = calendars.find(
      (cal) => cal.url === connection.external_calendar_id
    );
    if (match) return match;
  }
  return calendars[0];
}

/**
 * Bulk-delete events from Apple/CalDAV during a connection cleanup.
 *
 * Called from the disconnect-with-cleanup flow. Connects once, fetches
 * the target calendar once, then issues a DELETE per sync mapping.
 *
 * 404 from the server means the event is already gone — counted as a
 * success because the end state is what the user wanted. Other errors
 * count as failures and are reported back so the UI can warn the user
 * that some orphans may remain.
 *
 * Returns: { succeeded: number, failed: number, errors: [{uid, message}] }
 */
async function deleteEventsBatch(connection, syncMappings) {
  const result = { succeeded: 0, failed: 0, errors: [] };
  if (!syncMappings || syncMappings.length === 0) return result;

  let client;
  let calendar;
  try {
    client = await connect(connection);
    const calendars = await client.fetchCalendars();
    calendar = findCalendar(calendars, connection);
    if (!calendar) throw new Error('No calendar found on Apple account');
  } catch (err) {
    return {
      succeeded: 0,
      failed: syncMappings.length,
      errors: [{ code: 'CONNECTION_FAILED', message: err.message || String(err) }],
    };
  }

  for (const mapping of syncMappings) {
    const uid = mapping.external_event_id;
    const calendarObjectUrl = `${calendar.url}${uid}.ics`;
    try {
      await client.deleteCalendarObject({
        calendarObject: {
          url: calendarObjectUrl,
          etag: mapping.external_etag || undefined,
        },
      });
      result.succeeded++;
    } catch (err) {
      const status = err?.response?.status || err?.status;
      if (status === 404) {
        // Already gone on the server — desired state achieved.
        result.succeeded++;
      } else {
        result.failed++;
        result.errors.push({ uid, message: err.message || String(err) });
        console.warn(`[apple cleanup] Failed to delete ${uid}:`, err.message || err);
      }
    }
  }

  return result;
}

module.exports = {
  parseVEvent,
  expandRecurrence,
  deleteEventsBatch,
};
