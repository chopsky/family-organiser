// Lazy-load googleapis (it's ~800ms to require) to keep server startup fast
let _google = null;
function getGoogle() {
  if (!_google) _google = require('googleapis').google;
  return _google;
}

const CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
const API_URL = process.env.API_URL || 'http://localhost:3000';
const REDIRECT_URI = `${API_URL}/api/calendar/connect/google/callback`;
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

function createOAuth2Client() {
  return new (getGoogle()).auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

function createCalendarClient(accessToken) {
  const auth = createOAuth2Client();
  auth.setCredentials({ access_token: accessToken });
  return getGoogle().calendar({ version: 'v3', auth });
}

function toGoogleEvent(event) {
  return {
    summary: event.title,
    description: event.description,
    location: event.location,
    start: event.all_day
      ? { date: event.start_time.split('T')[0] }
      : { dateTime: event.start_time },
    end: event.all_day
      ? { date: event.end_time.split('T')[0] }
      : { dateTime: event.end_time },
  };
}

function toCurataEvent(googleEvent) {
  const isAllDay = !!googleEvent.start.date;
  return {
    title: googleEvent.summary || '',
    description: googleEvent.description || '',
    location: googleEvent.location || '',
    start_time: isAllDay ? googleEvent.start.date : googleEvent.start.dateTime,
    end_time: isAllDay ? googleEvent.end.date : googleEvent.end.dateTime,
    all_day: isAllDay,
  };
}

/**
 * Generate the Google OAuth2 consent URL.
 */
function getAuthUrl(userId, householdId) {
  const oauth2Client = createOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state: JSON.stringify({ userId, householdId }),
    prompt: 'consent',
  });
}

/**
 * Exchange an authorization code for tokens.
 */
async function handleCallback(code) {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
  };
}

/**
 * Push a Curata event to Google Calendar.
 */
async function pushEvent(connection, event, action) {
  const calendar = createCalendarClient(connection.access_token);
  const calendarId = 'primary';

  if (action === 'create') {
    const result = await calendar.events.insert({
      calendarId,
      requestBody: toGoogleEvent(event),
    });
    return { externalEventId: result.data.id };
  }

  if (action === 'update') {
    const syncMapping = event.sync_mappings?.find(
      (m) => m.provider === 'google' && m.connection_id === connection.id
    );
    if (!syncMapping) {
      throw new Error('No sync mapping found for this event');
    }
    await calendar.events.update({
      calendarId,
      eventId: syncMapping.external_event_id,
      requestBody: toGoogleEvent(event),
    });
    return { externalEventId: syncMapping.external_event_id };
  }

  if (action === 'delete') {
    const syncMapping = event.sync_mappings?.find(
      (m) => m.provider === 'google' && m.connection_id === connection.id
    );
    if (!syncMapping) {
      throw new Error('No sync mapping found for this event');
    }
    await calendar.events.delete({
      calendarId,
      eventId: syncMapping.external_event_id,
    });
    return { externalEventId: syncMapping.external_event_id };
  }

  throw new Error(`Unknown action: ${action}`);
}

/**
 * Fetch changed events from Google Calendar since the last sync.
 */
/**
 * List all calendars visible to the authenticated user.
 */
async function listCalendars(connection) {
  const calendar = createCalendarClient(connection.access_token);
  const result = await calendar.calendarList.list();
  const items = result.data.items || [];

  return items.map((cal) => {
    let suggestedCategory = 'general';
    if (cal.id.includes('#contacts@group.v.calendar.google.com')) {
      suggestedCategory = 'birthday';
    } else if (
      cal.id.includes('#holiday@group.v.calendar.google.com') ||
      /^en\.[a-z]{2,3}(\.)?#/.test(cal.id)
    ) {
      suggestedCategory = 'public_holiday';
    }
    return { id: cal.id, displayName: cal.summary || '', suggestedCategory };
  });
}

async function pullChanges(connection, calendarId) {
  const calendar = createCalendarClient(connection.access_token);

  const updatedMin = connection.last_synced_at
    ? new Date(connection.last_synced_at).toISOString()
    : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const result = await calendar.events.list({
    calendarId: calendarId || 'primary',
    updatedMin,
    singleEvents: true,
    orderBy: 'updated',
  });

  const events = result.data.items || [];

  return events.map((googleEvent) => {
    const isCancelled = googleEvent.status === 'cancelled';
    return {
      externalEventId: googleEvent.id,
      action: isCancelled ? 'delete' : 'upsert',
      eventData: isCancelled ? null : toCurataEvent(googleEvent),
      etag: googleEvent.etag,
    };
  });
}

/**
 * Fetch all events from a Google Calendar (paginated).
 * Limits to the last 6 months and next 12 months.
 */
async function pullAllEvents(connection, calendarId) {
  const calendar = createCalendarClient(connection.access_token);

  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setMonth(timeMin.getMonth() - 6);
  const timeMax = new Date(now);
  timeMax.setMonth(timeMax.getMonth() + 12);

  const allEvents = [];
  let pageToken = undefined;

  do {
    const result = await calendar.events.list({
      calendarId: calendarId || 'primary',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      pageToken,
    });

    const events = result.data.items || [];
    for (const googleEvent of events) {
      if (googleEvent.status === 'cancelled') continue;
      allEvents.push({
        externalEventId: googleEvent.id,
        action: 'upsert',
        eventData: toCurataEvent(googleEvent),
      });
    }

    pageToken = result.data.nextPageToken;
  } while (pageToken);

  return allEvents;
}

/**
 * Refresh the OAuth2 access token using the stored refresh token.
 */
async function refreshToken(connection) {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: connection.refresh_token });
  const { credentials } = await oauth2Client.refreshAccessToken();
  return {
    access_token: credentials.access_token,
    token_expires_at: new Date(credentials.expiry_date).toISOString(),
  };
}

/**
 * Register a webhook for push notifications on calendar changes.
 */
async function registerWebhook(connection, callbackUrl) {
  const calendar = createCalendarClient(connection.access_token);
  const channelId = `curata-${connection.id}-${Date.now()}`;

  const result = await calendar.events.watch({
    calendarId: 'primary',
    requestBody: {
      id: channelId,
      type: 'web_hook',
      address: callbackUrl || `${API_URL}/api/calendar/webhooks/google`,
    },
  });

  return {
    channelId: result.data.id,
    resourceId: result.data.resourceId,
    expiration: result.data.expiration,
  };
}

module.exports = {
  getAuthUrl,
  handleCallback,
  pushEvent,
  pullChanges,
  pullAllEvents,
  listCalendars,
  refreshToken,
  registerWebhook,
};
