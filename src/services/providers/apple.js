// Lazy-load tsdav via dynamic import — it's ESM-only and can't use require()
let _DAVClient = null;
async function getDAVClient() {
  if (!_DAVClient) {
    const tsdav = await import('tsdav');
    _DAVClient = tsdav.DAVClient;
  }
  return _DAVClient;
}

const { randomUUID } = require('crypto');
const { RRule, rrulestr } = require('rrule');

const CALDAV_SERVER_URL = 'https://caldav.icloud.com';

/**
 * Format a date string to iCal format.
 * All-day events use DATE format (YYYYMMDD).
 * Timed events use DATETIME format (YYYYMMDDTHHMMSSZ).
 */
function formatDate(dateString, allDay) {
  const date = new Date(dateString);
  if (allDay) {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
  }
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Build a VCALENDAR/VEVENT string from a Anora event.
 */
function buildVEvent(event, uid) {
  const dtstart = formatDate(event.start_time, event.all_day);
  const dtend = formatDate(event.end_time, event.all_day);
  const valueParam = event.all_day ? ';VALUE=DATE' : '';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Anora//Calendar//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART${valueParam}:${dtstart}`,
    `DTEND${valueParam}:${dtend}`,
    `SUMMARY:${event.title || ''}`,
    `DESCRIPTION:${event.description || ''}`,
    `LOCATION:${event.location || ''}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.join('\r\n');
}

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
    } catch (e) {
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
  if (allDay && dtend && dtend.length === 8) {
    const d = new Date(endTime + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    endTime = `${y}-${m}-${dd}`;
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

    // Parse the original local start time components
    let startHour = 0, startMin = 0, startSec = 0;
    let durationMs;

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

    // Timed event — parse local time from raw DTSTART
    startHour = parseInt(rawDt.substring(9, 11));
    startMin = parseInt(rawDt.substring(11, 13));
    startSec = parseInt(rawDt.substring(13, 15));

    // Calculate duration from the already-converted UTC times
    const startMs = new Date(eventData.start_time).getTime();
    const endMs = new Date(eventData.end_time).getTime();
    durationMs = endMs - startMs;

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
 * Push a Anora event to Apple Calendar via CalDAV.
 */
async function pushEvent(connection, event, action) {
  const client = await connect(connection);
  const calendars = await client.fetchCalendars();
  const calendar = findCalendar(calendars, connection);

  if (!calendar) {
    throw new Error('No calendar found on Apple account');
  }

  if (action === 'create') {
    const uid = randomUUID();
    const icalData = buildVEvent(event, uid);
    const filename = `${uid}.ics`;

    const result = await client.createCalendarObject({
      calendar,
      filename,
      iCalString: icalData,
    });

    return {
      externalEventId: uid,
      etag: result?.etag || null,
    };
  }

  if (action === 'update') {
    const syncMapping = event.sync_mappings?.find(
      (m) => m.provider === 'apple' && m.connection_id === connection.id
    );
    if (!syncMapping) {
      throw new Error('No sync mapping found for this event');
    }

    const uid = syncMapping.external_event_id;
    const icalData = buildVEvent(event, uid);
    const calendarObjectUrl = `${calendar.url}${uid}.ics`;

    const result = await client.updateCalendarObject({
      calendarObject: {
        url: calendarObjectUrl,
        data: icalData,
        etag: syncMapping.etag || undefined,
      },
    });

    return {
      externalEventId: uid,
      etag: result?.etag || null,
    };
  }

  if (action === 'delete') {
    const syncMapping = event.sync_mappings?.find(
      (m) => m.provider === 'apple' && m.connection_id === connection.id
    );
    if (!syncMapping) {
      throw new Error('No sync mapping found for this event');
    }

    const uid = syncMapping.external_event_id;
    const calendarObjectUrl = `${calendar.url}${uid}.ics`;

    await client.deleteCalendarObject({
      calendarObject: {
        url: calendarObjectUrl,
        etag: syncMapping.etag || undefined,
      },
    });

    return { externalEventId: uid };
  }

  throw new Error(`Unknown action: ${action}`);
}

/**
 * Fetch changed events from Apple Calendar via CalDAV.
 * Compares etags with stored sync mappings to detect changes.
 * Used for polling (every 15 mins) since CalDAV has no webhooks.
 */
async function pullChanges(connection, calendarUrl) {
  const client = await connect(connection);

  let calendar;
  if (calendarUrl) {
    calendar = { url: calendarUrl };
  } else {
    const calendars = await client.fetchCalendars();
    calendar = findCalendar(calendars, connection);
  }

  if (!calendar) {
    throw new Error('No calendar found on Apple account');
  }

  const calendarObjects = await client.fetchCalendarObjects({
    calendar,
  });

  const existingMappings = connection.sync_mappings || [];
  const existingByExternalId = new Map(
    existingMappings.map((m) => [m.external_event_id, m])
  );

  const changes = [];
  const seenExternalIds = new Set();

  for (const obj of calendarObjects) {
    const icalData = obj.data;
    if (!icalData) continue;

    const uidMatch = icalData.match(/^UID[^:]*:(.*)$/m);
    const externalEventId = uidMatch ? uidMatch[1].trim() : null;
    if (!externalEventId) continue;

    seenExternalIds.add(externalEventId);
    const currentEtag = obj.etag;
    const eventData = parseVEvent(icalData);

    // Expand recurring events
    const expanded = expandRecurrence(eventData, externalEventId);
    if (expanded && expanded.length > 0) {
      for (const instance of expanded) {
        seenExternalIds.add(instance.externalEventId);
        const existingInstance = existingByExternalId.get(instance.externalEventId);
        if (!existingInstance || existingInstance.etag !== currentEtag) {
          changes.push({
            externalEventId: instance.externalEventId,
            action: 'upsert',
            eventData: instance.eventData,
            etag: currentEtag,
          });
        }
      }
    } else {
      // Non-recurring event
      const existing = existingByExternalId.get(externalEventId);
      if (!existing) {
        changes.push({
          externalEventId,
          action: 'upsert',
          eventData: {
            title: eventData.title,
            description: eventData.description,
            location: eventData.location,
            start_time: eventData.start_time,
            end_time: eventData.end_time,
            all_day: eventData.all_day,
          },
          etag: currentEtag,
        });
      } else if (existing.etag !== currentEtag) {
        changes.push({
          externalEventId,
          action: 'upsert',
          eventData: {
            title: eventData.title,
            description: eventData.description,
            location: eventData.location,
            start_time: eventData.start_time,
            end_time: eventData.end_time,
            all_day: eventData.all_day,
          },
          etag: currentEtag,
        });
      }
    }
  }

  // Detect deletions: mappings that no longer appear in the calendar
  for (const mapping of existingMappings) {
    if (!seenExternalIds.has(mapping.external_event_id)) {
      changes.push({
        externalEventId: mapping.external_event_id,
        action: 'delete',
        eventData: null,
        etag: null,
      });
    }
  }

  return changes;
}

/**
 * List all calendars on the Apple CalDAV account.
 * Returns an array of { id, displayName, suggestedCategory }.
 */
async function listCalendars(connection) {
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

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Connection to Apple CalDAV timed out. Please try again.')), 20000)
  );
  await Promise.race([client.login(), timeout]);
  const calendars = await Promise.race([client.fetchCalendars(), timeout]);

  // Filter out Reminders (VTODO) calendars — only include event (VEVENT) calendars
  return calendars
    .filter((cal) => {
      const comps = cal.components || [];
      // If components are declared, only include calendars that support VEVENT
      if (comps.length > 0) return comps.includes('VEVENT');
      // Exclude by name as a fallback
      return !/reminder/i.test(cal.displayName || '');
    })
    .map((cal) => {
      const displayName = cal.displayName || cal.url;
      let suggestedCategory = 'general';
      if (/birthday/i.test(displayName)) {
        suggestedCategory = 'birthday';
      } else if (/holiday/i.test(displayName)) {
        suggestedCategory = 'public_holiday';
      }
      return { id: cal.url, displayName, suggestedCategory };
    });
}

/**
 * No-op for CalDAV — app-specific passwords don't expire.
 */
async function refreshToken(_connection) {
  return null;
}

/**
 * Validate Apple CalDAV credentials by attempting to connect and fetch calendars.
 */
async function validateCredentials(email, appPassword) {
  try {
    const DAVClient = await getDAVClient();
    const client = new DAVClient({
      serverUrl: CALDAV_SERVER_URL,
      credentials: {
        username: email,
        password: appPassword,
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });

    // Timeout after 20s to avoid hanging indefinitely
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Connection to Apple CalDAV timed out. Please try again.')), 20000)
    );
    await Promise.race([client.login(), timeout]);
    const calendars = await Promise.race([client.fetchCalendars(), timeout]);

    return {
      valid: true,
      calendars: calendars.map((cal) => ({
        url: cal.url,
        displayName: cal.displayName || cal.url,
      })),
    };
  } catch (error) {
    console.error('Apple CalDAV validateCredentials error:', error.message);
    return {
      valid: false,
      error: error.message || 'Failed to connect to Apple CalDAV',
    };
  }
}

/**
 * Fetch ALL events from a specific Apple calendar and return them as upserts.
 * Unlike pullChanges, this does not compare against existing mappings —
 * every event is returned as an 'upsert' for the caller to reconcile.
 */
async function pullAllEvents(connection, calendarUrl) {
  const client = await connect(connection);

  let calendar;
  if (calendarUrl) {
    calendar = { url: calendarUrl };
  } else {
    const calendars = await client.fetchCalendars();
    calendar = findCalendar(calendars, connection);
  }

  if (!calendar) {
    throw new Error('No calendar found on Apple account');
  }

  const calendarObjects = await client.fetchCalendarObjects({ calendar });

  const events = [];

  for (const obj of calendarObjects) {
    const icalData = obj.data;
    if (!icalData) continue;

    const uidMatch = icalData.match(/^UID[^:]*:(.*)$/m);
    const externalEventId = uidMatch ? uidMatch[1].trim() : null;
    if (!externalEventId) continue;

    const eventData = parseVEvent(icalData);

    // Expand recurring events into individual instances
    const expanded = expandRecurrence(eventData, externalEventId);
    if (expanded && expanded.length > 0) {
      for (const instance of expanded) {
        events.push({
          externalEventId: instance.externalEventId,
          action: 'upsert',
          eventData: instance.eventData,
          etag: obj.etag,
        });
      }
    } else {
      // Non-recurring event or expansion failed — import as single event
      events.push({
        externalEventId,
        action: 'upsert',
        eventData: {
          title: eventData.title,
          description: eventData.description,
          location: eventData.location,
          start_time: eventData.start_time,
          end_time: eventData.end_time,
          all_day: eventData.all_day,
        },
        etag: obj.etag,
      });
    }
  }

  return events;
}

module.exports = {
  connect,
  pushEvent,
  pullChanges,
  refreshToken,
  validateCredentials,
  buildVEvent,
  listCalendars,
  pullAllEvents,
};
