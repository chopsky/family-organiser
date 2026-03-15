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
 * Build a VCALENDAR/VEVENT string from a Curata event.
 */
function buildVEvent(event, uid) {
  const dtstart = formatDate(event.start_time, event.all_day);
  const dtend = formatDate(event.end_time, event.all_day);
  const valueParam = event.all_day ? ';VALUE=DATE' : '';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Curata//Calendar//EN',
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
 * Parse a VEVENT from iCal data into a Curata event object.
 */
function parseVEvent(icalData) {
  const getValue = (key) => {
    const regex = new RegExp(`^${key}[^:]*:(.*)$`, 'm');
    const match = icalData.match(regex);
    return match ? match[1].trim() : '';
  };

  const dtstart = getValue('DTSTART');
  const dtend = getValue('DTEND');
  const allDay = dtstart.length === 8;

  const parseICalDate = (value) => {
    if (value.length === 8) {
      // DATE format: YYYYMMDD
      const year = value.substring(0, 4);
      const month = value.substring(4, 6);
      const day = value.substring(6, 8);
      return `${year}-${month}-${day}`;
    }
    // DATETIME format: YYYYMMDDTHHMMSSZ
    const year = value.substring(0, 4);
    const month = value.substring(4, 6);
    const day = value.substring(6, 8);
    const hour = value.substring(9, 11);
    const min = value.substring(11, 13);
    const sec = value.substring(13, 15);
    return `${year}-${month}-${day}T${hour}:${min}:${sec}Z`;
  };

  return {
    title: getValue('SUMMARY'),
    description: getValue('DESCRIPTION'),
    location: getValue('LOCATION'),
    start_time: parseICalDate(dtstart),
    end_time: dtend ? parseICalDate(dtend) : parseICalDate(dtstart),
    all_day: allDay,
  };
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
 * Push a Curata event to Apple Calendar via CalDAV.
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
async function pullChanges(connection) {
  const client = await connect(connection);
  const calendars = await client.fetchCalendars();
  const calendar = findCalendar(calendars, connection);

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
    const existing = existingByExternalId.get(externalEventId);
    const currentEtag = obj.etag;

    if (!existing) {
      // New event not in our mappings
      changes.push({
        externalEventId,
        action: 'upsert',
        eventData: parseVEvent(icalData),
        etag: currentEtag,
      });
    } else if (existing.etag !== currentEtag) {
      // Etag changed — event was modified
      changes.push({
        externalEventId,
        action: 'upsert',
        eventData: parseVEvent(icalData),
        etag: currentEtag,
      });
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

    await client.login();
    const calendars = await client.fetchCalendars();

    return {
      valid: true,
      calendars: calendars.map((cal) => ({
        url: cal.url,
        displayName: cal.displayName || cal.url,
      })),
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message || 'Failed to connect to Apple CalDAV',
    };
  }
}

module.exports = {
  connect,
  pushEvent,
  pullChanges,
  refreshToken,
  validateCredentials,
  buildVEvent,
};
