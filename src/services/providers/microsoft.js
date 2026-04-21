const axios = require('axios');

// Lazy-load microsoft-graph-client to keep server startup fast
let _GraphClient = null;
function getGraphClient() {
  if (!_GraphClient) _GraphClient = require('@microsoft/microsoft-graph-client').Client;
  return _GraphClient;
}

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const API_URL = process.env.API_URL || 'http://localhost:3000';

const TOKEN_ENDPOINT =
  'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const AUTHORIZE_ENDPOINT =
  'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const REDIRECT_URI = `${API_URL}/api/calendar/connect/microsoft/callback`;
const SCOPES = 'Calendars.ReadWrite offline_access';

function getClient(accessToken) {
  return getGraphClient().init({
    authProvider: (done) => done(null, accessToken),
  });
}

/**
 * Generate the Microsoft OAuth2 consent URL.
 */
function getAuthUrl(userId, householdId) {
  const params = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    state: JSON.stringify({ userId, householdId }),
  });

  return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

/**
 * Exchange an authorization code for access and refresh tokens.
 */
async function handleCallback(code) {
  const { data } = await axios.post(
    TOKEN_ENDPOINT,
    new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      client_secret: MICROSOFT_CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
      scope: SCOPES,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
  };
}

/**
 * Convert a Anora event into the Microsoft Graph event format.
 */
function toMicrosoftEvent(event) {
  return {
    subject: event.title,
    body: { contentType: 'text', content: event.description || '' },
    start: { dateTime: event.start_time, timeZone: 'UTC' },
    end: { dateTime: event.end_time, timeZone: 'UTC' },
    location: { displayName: event.location || '' },
    isAllDay: event.all_day || false,
  };
}

/**
 * Push a Anora event to Outlook Calendar.
 *
 * @param {object} connection  - Calendar connection with access_token
 * @param {object} event       - Anora event object
 * @param {'create'|'update'|'delete'} action
 * @returns {object|undefined} For 'create', returns { externalEventId }
 */
async function pushEvent(connection, event, action) {
  const client = getClient(connection.access_token);

  if (action === 'create') {
    const result = await client.api('/me/events').post(toMicrosoftEvent(event));
    return { externalEventId: result.id };
  }

  if (action === 'update') {
    const { externalEventId } = event;
    await client
      .api(`/me/events/${externalEventId}`)
      .patch(toMicrosoftEvent(event));
    return;
  }

  if (action === 'delete') {
    const { externalEventId } = event;
    await client.api(`/me/events/${externalEventId}`).delete();
    
  }
}

/**
 * Pull changed events from Outlook using a delta query.
 *
 * @param {object} connection - Calendar connection with access_token and optional deltaLink
 * @returns {Array<{ externalEventId: string, action: string, eventData: object|null, etag: string|null }>}
 */
async function pullChanges(connection, calendarId) {
  const client = getClient(connection.access_token);

  const basePath = calendarId
    ? `/me/calendars/${calendarId}/calendarView/delta`
    : '/me/calendarView/delta';

  let url;
  if (connection.deltaLink) {
    url = connection.deltaLink;
  } else {
    const now = new Date();
    const startDateTime = now.toISOString();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 30);
    const endDateTime = endDate.toISOString();

    url = `${basePath}?startDateTime=${encodeURIComponent(
      startDateTime
    )}&endDateTime=${encodeURIComponent(endDateTime)}`;
  }

  const changes = [];
  let response = await client.api(url).get();

  while (response) {
    for (const item of response.value || []) {
      if (item['@removed']) {
        changes.push({
          externalEventId: item.id,
          action: 'delete',
          eventData: null,
          etag: null,
        });
      } else {
        changes.push({
          externalEventId: item.id,
          action: 'upsert',
          eventData: {
            title: item.subject,
            description: item.body?.content || '',
            start_time: item.start?.dateTime,
            end_time: item.end?.dateTime,
            location: item.location?.displayName || '',
            all_day: item.isAllDay || false,
          },
          etag: item['@odata.etag'] || null,
        });
      }
    }

    if (response['@odata.nextLink']) {
      response = await client.api(response['@odata.nextLink']).get();
    } else {
      break;
    }
  }

  // Microsoft Graph uses its own delta-link mechanism (connection.deltaLink)
  // rather than a CalDAV-style sync token. Return null so the Apple-specific
  // sync_token field on the subscription row is left untouched.
  return { changes, syncToken: null };
}

/**
 * List all calendars for the connected Microsoft account.
 *
 * @param {object} connection - Calendar connection with access_token
 * @returns {Array<{ id: string, displayName: string, suggestedCategory: string }>}
 */
async function listCalendars(connection) {
  const { data } = await axios.get(
    'https://graph.microsoft.com/v1.0/me/calendars',
    {
      headers: { Authorization: `Bearer ${connection.access_token}` },
    }
  );

  return (data.value || []).map((cal) => {
    const name = cal.name || '';
    let suggestedCategory = 'general';

    if (
      name === 'Birthday calendar' ||
      /birthday/i.test(name)
    ) {
      suggestedCategory = 'birthday';
    } else if (
      name === 'Holidays' ||
      /holiday/i.test(name)
    ) {
      suggestedCategory = 'public_holiday';
    }

    return {
      id: cal.id,
      displayName: name,
      suggestedCategory,
    };
  });
}

/**
 * Pull all events from a specific calendar using calendarView (non-delta).
 * Fetches events from 6 months ago to 12 months from now.
 *
 * @param {object} connection - Calendar connection with access_token
 * @param {string} [calendarId] - Calendar ID; omit for default calendar
 * @returns {Array<{ externalEventId: string, action: string, eventData: object }>}
 */
async function pullAllEvents(connection, calendarId) {
  const client = getClient(connection.access_token);

  const now = new Date();
  const startDate = new Date(now);
  startDate.setMonth(startDate.getMonth() - 6);
  const endDate = new Date(now);
  endDate.setMonth(endDate.getMonth() + 12);

  const startDateTime = startDate.toISOString();
  const endDateTime = endDate.toISOString();

  const basePath = calendarId
    ? `/me/calendars/${calendarId}/calendarView`
    : '/me/calendarView';

  const url = `${basePath}?startDateTime=${encodeURIComponent(
    startDateTime
  )}&endDateTime=${encodeURIComponent(endDateTime)}`;

  const events = [];
  let response = await client.api(url).get();

  while (response) {
    for (const item of response.value || []) {
      events.push({
        externalEventId: item.id,
        action: 'upsert',
        eventData: {
          title: item.subject,
          description: item.body?.content || '',
          start_time: item.start?.dateTime,
          end_time: item.end?.dateTime,
          location: item.location?.displayName || '',
          all_day: item.isAllDay || false,
        },
      });
    }

    if (response['@odata.nextLink']) {
      response = await client.api(response['@odata.nextLink']).get();
    } else {
      break;
    }
  }

  return events;
}

/**
 * Refresh an expired OAuth2 access token.
 *
 * @param {object} connection - Calendar connection with refresh_token
 * @returns {{ access_token: string, token_expires_at: Date }}
 */
async function refreshToken(connection) {
  const { data } = await axios.post(
    TOKEN_ENDPOINT,
    new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      client_secret: MICROSOFT_CLIENT_SECRET,
      refresh_token: connection.refresh_token,
      grant_type: 'refresh_token',
      scope: SCOPES,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  return {
    access_token: data.access_token,
    token_expires_at: new Date(Date.now() + data.expires_in * 1000),
  };
}

/**
 * Register a Microsoft Graph webhook subscription for calendar changes.
 *
 * @param {object} connection  - Calendar connection with access_token
 * @param {string} callbackUrl - (unused, uses default API_URL-based callback)
 * @returns {object} The created subscription
 */
async function registerWebhook(connection, callbackUrl) {
  const client = getClient(connection.access_token);

  const expirationDateTime = new Date();
  expirationDateTime.setDate(expirationDateTime.getDate() + 3);

  const subscription = await client.api('/subscriptions').post({
    changeType: 'created,updated,deleted',
    notificationUrl: `${API_URL}/api/calendar/webhooks/microsoft`,
    resource: '/me/events',
    expirationDateTime: expirationDateTime.toISOString(),
  });

  return subscription;
}

module.exports = {
  getAuthUrl,
  handleCallback,
  pushEvent,
  pullChanges,
  listCalendars,
  pullAllEvents,
  refreshToken,
  registerWebhook,
};
